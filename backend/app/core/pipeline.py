"""clean input → prompt → provider chain → extract → guard → validate → (one repair) → normalize → empty check."""

import asyncio
import json
import logging
import time
from collections.abc import Sequence
from typing import Any

from pydantic import BaseModel, ValidationError

from app.api.schemas import Meta, SuccessEnvelope, UsageMeta
from app.core import guard
from app.core.deadline import Deadline
from app.core.errors import AppError, ErrorKind
from app.core.extract import ExtractError, extract_json
from app.core.pricing import cost_usd
from app.providers.base import Completion, Provider, ProviderError
from app.themes.base import Theme

log = logging.getLogger("app.pipeline")

REPAIR_MIN_LEFT_S = 5.0
MAX_REPAIR_ERRORS = 10
MAX_ECHOED_OUTPUT = 4000
BLOCKED_MESSAGE = "That request can't be answered here. Paste study material or name a topic to work on."


class BadOutput(AppError):
    """Output was received but is unusable. `raw` and `problems` are fed back to the model on repair."""

    def __init__(self, kind: ErrorKind, message: str, raw: str, problems: list[str]):
        super().__init__(kind, message)
        self.raw = raw
        self.problems = problems


class _Run:
    """Per-request tally over every model call (repair included), so failures are reported too."""

    def __init__(self) -> None:
        self.attempts = 0
        self.input_tokens = self.output_tokens = 0
        self.cost = 0.0
        self.reported = False  # at least one call reported usage
        self.priced = True  # every call reported usage for a model with a known price

    def add(self, provider: Provider, completion: Completion) -> None:
        if completion.usage is None:
            self.priced = False
            return
        self.reported = True
        self.input_tokens += completion.usage.input_tokens
        self.output_tokens += completion.usage.output_tokens
        cost = cost_usd(provider.model, completion.usage)
        if cost is None:
            self.priced = False
        else:
            self.cost += cost

    def usage(self) -> UsageMeta | None:
        if not self.reported:
            return None
        cost = round(self.cost, 8) if self.priced else None
        return UsageMeta(inputTokens=self.input_tokens, outputTokens=self.output_tokens, costUsd=cost)

    def describe(self) -> str:
        if not self.reported:
            return "tokens=n/a"
        cost = f"${self.cost:.6f}" if self.priced else "n/a"
        return f"tokens={self.input_tokens}in/{self.output_tokens}out cost={cost}"


async def generate(
    theme: Theme, user_input: str, chain: Sequence[Provider], *, total_s: float, provider_s: float
) -> SuccessEnvelope:
    started = time.monotonic()
    run = _Run()
    try:
        envelope = await _generate(theme, user_input, chain, Deadline(total_s), provider_s, run)
    except AppError as err:
        log.info(
            "generate theme=%s failed kind=%s attempts=%d %s %dms",
            theme.id,
            err.kind,
            run.attempts,
            run.describe(),
            _ms(started),
        )
        raise
    m = envelope.meta
    m.latencyMs = _ms(started)
    log.info(
        "generate theme=%s ok provider=%s model=%s attempts=%d repaired=%s %s %dms",
        theme.id,
        m.provider,
        m.model,
        m.attempts,
        m.repaired,
        run.describe(),
        m.latencyMs,
    )
    return envelope


async def _generate(
    theme: Theme, user_input: str, chain: Sequence[Provider], deadline: Deadline, provider_s: float, run: _Run
) -> SuccessEnvelope:
    text = guard.clean(user_input).strip()
    if not text:
        raise AppError(ErrorKind.INPUT, "Please enter some text first.")
    if len(text) > theme.max_input_chars:
        raise AppError(ErrorKind.INPUT, f"Input is too long ({len(text)} of {theme.max_input_chars} characters).")

    if found := guard.flags(text):
        log.warning("input flagged %s; handled as material", ",".join(found))  # the input itself is never logged

    prompt = theme.build_prompt(text)
    schema = theme.Schema.model_json_schema()
    marker = guard.new_marker()
    system = _system_prompt(prompt.system, schema, theme.example, marker)
    user = guard.wrap(prompt.user)

    async def attempt(user: str) -> tuple[BaseModel, Provider]:
        run.attempts += 1
        completion, provider = await _call_chain(chain, system, user, schema, deadline, provider_s)
        run.add(provider, completion)
        value = _extract(completion.text)
        if guard.leaks(guard.strings(value), marker, prompt.system + guard.RULES, text):
            log.warning("output blocked: it recites the instructions (provider=%s)", provider.name)
            raise AppError(ErrorKind.BLOCKED, BLOCKED_MESSAGE)
        value, removed = guard.strip_foreign_links(value, text)
        if removed:
            log.warning("removed %d link(s) the input doesn't contain (provider=%s)", removed, provider.name)
        return _validate(value, completion.text, theme.Schema), provider

    try:
        data, provider = await attempt(user)
        repaired = False
    except BadOutput as bad:
        if deadline.left() <= REPAIR_MIN_LEFT_S:
            raise
        log.info("attempt 1 %s (%s); repairing", bad.kind, bad.problems[0])
        data, provider = await attempt(_repair_prompt(user, bad))
        repaired = True

    data = theme.normalize(data)
    if theme.is_empty(data):
        raise AppError(ErrorKind.EMPTY, "Nothing useful could be generated from that text. Try adding more detail.")
    meta = Meta(
        attempts=run.attempts,
        provider=provider.name,
        model=provider.model,
        latencyMs=0,
        repaired=repaired,
        usage=run.usage(),
    )
    return SuccessEnvelope(data=data, meta=meta)


async def _call_chain(
    chain: Sequence[Provider], system: str, user: str, schema: dict[str, Any], deadline: Deadline, provider_s: float
) -> tuple[Completion, Provider]:
    """Try each provider in order. Fall through only on retryable provider failures."""
    failures: list[ProviderError] = []
    for provider in chain:
        budget = min(provider_s, deadline.left())
        if budget <= 0:
            break
        started = time.monotonic()
        try:
            async with asyncio.timeout(budget):
                completion = await provider.generate(system=system, user=user, json_schema=schema, timeout_s=budget)
            return completion, provider
        except TimeoutError:
            err = ProviderError(f"no response within {budget:.1f}s", timeout=True)
        except ProviderError as e:
            err = e
        log.warning(
            "provider=%s model=%s failed status=%s timeout=%s %dms: %s",
            provider.name,
            provider.model,
            err.status,
            err.timeout,
            _ms(started),
            err,
        )
        failures.append(err)
        if not err.retryable:
            break
    raise _chain_error(failures)


def _chain_error(failures: list[ProviderError]) -> AppError:
    if failures and all(f.rate_limited for f in failures):
        wait = max(f.retry_after or 10 for f in failures)
        return AppError(ErrorKind.RATE_LIMITED, "The AI service is busy. Try again shortly.", retry_after=wait)
    if not failures or failures[-1].timeout:
        return AppError(ErrorKind.TIMEOUT, "The AI took too long to respond. Please try again.")
    return AppError(ErrorKind.PROVIDER, "The AI service is unavailable right now. Please try again.")


def _extract(raw: str) -> Any:
    try:
        return extract_json(raw)
    except ExtractError as e:
        raise BadOutput(ErrorKind.MALFORMED, "The AI returned output that couldn't be read.", raw, [str(e)]) from None


def _validate(value: Any, raw: str, schema: type[BaseModel]) -> BaseModel:
    try:
        return schema.model_validate(value)
    except ValidationError as e:
        raise BadOutput(
            ErrorKind.INVALID_SHAPE, "The AI's answer didn't have the expected structure.", raw, _compact(e)
        ) from None


def _compact(err: ValidationError) -> list[str]:
    errors = err.errors(include_url=False)
    lines = [f"{'.'.join(map(str, e['loc'])) or '<root>'}: {e['msg']}" for e in errors[:MAX_REPAIR_ERRORS]]
    if len(errors) > MAX_REPAIR_ERRORS:
        lines.append(f"...and {len(errors) - MAX_REPAIR_ERRORS} more")
    return lines


def _system_prompt(theme_system: str, schema: dict[str, Any], example: dict[str, Any], marker: str) -> str:
    # The marker leads, so reciting the prompt from the top gives it away; the rules come last, to win.
    return (
        f"Marker: {marker}\n\n"
        f"{theme_system}\n\n"
        "Respond with a single JSON value only: no prose, no markdown fences.\n"
        f"It must match this JSON Schema:\n{json.dumps(schema, separators=(',', ':'))}\n\n"
        f"Example of a valid response:\n{json.dumps(example)}\n\n"
        f"{guard.RULES}"
    )


def _repair_prompt(original_user: str, bad: BadOutput) -> str:
    problems = "\n".join(f"- {p}" for p in bad.problems)
    return (
        f"{original_user}\n\n---\n"
        "Your previous response could not be used.\n"
        f"Previous response:\n{bad.raw[:MAX_ECHOED_OUTPUT]}\n\n"
        f"Problems:\n{problems}\n\n"
        "Return ONLY the corrected JSON matching the schema."
    )


def _ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)
