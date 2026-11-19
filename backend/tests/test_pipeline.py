import json

import pytest

from app.core import pipeline
from app.core.errors import AppError, ErrorKind
from app.providers.base import Completion, ProviderError, Usage
from app.providers.mock import Fault, MockProvider
from app.themes.registry import THEMES

ECHO = THEMES["echo"]
GOOD = json.dumps(ECHO.example)


class Scripted:
    """Returns (or raises) the scripted items in order and records every call."""

    def __init__(self, *script: str | ProviderError, name: str = "scripted", model: str = "", usage=None):
        self.name, self.model = name, model or f"{name}-model"
        self._usage = usage
        self._script = list(script)
        self.calls: list[dict] = []

    async def generate(self, **kwargs) -> Completion:
        self.calls.append(kwargs)
        item = self._script.pop(0)
        if isinstance(item, ProviderError):
            raise item
        return Completion(item, self._usage)


def mock(fault: Fault) -> MockProvider:
    return MockProvider(fault, ECHO.example, slow_s=0.01)


async def run(chain, text: str = "some notes", *, total_s: float = 30, provider_s: float = 20):
    return await pipeline.generate(ECHO, text, chain, total_s=total_s, provider_s=provider_s)


async def expect_error(kind: ErrorKind, chain, **kwargs) -> AppError:
    with pytest.raises(AppError) as exc:
        await run(chain, **kwargs)
    assert exc.value.kind is kind
    return exc.value


@pytest.mark.parametrize("fault", [Fault.OK, Fault.FENCED, Fault.PROSE, Fault.SLOW])
async def test_usable_output_succeeds_first_try(fault):
    env = await run([mock(fault)])
    assert env.meta.attempts == 1 and not env.meta.repaired
    assert [i.text for i in env.data.items] == ["Buy groceries", "Clean the kitchen"]
    assert all(i.id for i in env.data.items)


async def test_bad_then_ok_is_repaired():
    env = await run([mock(Fault.BAD_THEN_OK)])
    assert env.meta.attempts == 2 and env.meta.repaired


async def test_repair_prompt_carries_bad_output_and_errors():
    p = Scripted('{"title": "x"}', GOOD)
    env = await run([p], text="my notes")
    assert env.meta.repaired
    repair_user = p.calls[1]["user"]
    assert repair_user.startswith("<material>\nmy notes\n</material>")
    assert '{"title": "x"}' in repair_user
    assert "items: Field required" in repair_user
    assert p.calls[0]["system"] == p.calls[1]["system"]


async def test_repair_echo_is_truncated():
    p = Scripted("x" * 10_000, GOOD)
    await run([p])
    assert "x" * 4000 in p.calls[1]["user"] and "x" * 4001 not in p.calls[1]["user"]


async def test_wrong_shape_twice_is_invalid_shape():
    err = await expect_error(ErrorKind.INVALID_SHAPE, [mock(Fault.WRONG_SHAPE)])
    assert err.retryable


async def test_truncated_twice_is_malformed():
    await expect_error(ErrorKind.MALFORMED, [mock(Fault.TRUNCATED)])


async def test_no_repair_when_deadline_is_nearly_spent():
    p = Scripted('{"title": "x"}', GOOD)
    await expect_error(ErrorKind.INVALID_SHAPE, [p], total_s=4)
    assert len(p.calls) == 1


async def test_empty_result():
    await expect_error(ErrorKind.EMPTY, [mock(Fault.EMPTY)])


async def test_timeout():
    await expect_error(ErrorKind.TIMEOUT, [mock(Fault.TIMEOUT)], total_s=0.3, provider_s=0.2)


async def test_slow_primary_times_out_then_fallback_answers():
    env = await run([mock(Fault.TIMEOUT), Scripted(GOOD, name="fallback")], total_s=1, provider_s=0.2)
    assert env.meta.provider == "fallback"


async def test_500_falls_back():
    env = await run([mock(Fault.ERROR_500), Scripted(GOOD, name="fallback")])
    assert env.meta.provider == "fallback" and env.meta.attempts == 1


async def test_500_without_fallback_is_provider_error():
    await expect_error(ErrorKind.PROVIDER, [mock(Fault.ERROR_500)])


async def test_429_everywhere_is_rate_limited_with_max_retry_after():
    second = Scripted(ProviderError("busy", status=429, retry_after=20))
    err = await expect_error(ErrorKind.RATE_LIMITED, [mock(Fault.RATE_429), second])
    assert err.retry_after == 20


async def test_non_retryable_provider_error_skips_fallback():
    fallback = Scripted(GOOD)
    await expect_error(ErrorKind.PROVIDER, [Scripted(ProviderError("bad key", status=401)), fallback])
    assert fallback.calls == []


async def test_bad_output_does_not_trigger_fallback():
    fallback = Scripted(GOOD, name="fallback")
    await expect_error(ErrorKind.INVALID_SHAPE, [mock(Fault.WRONG_SHAPE), fallback])
    assert fallback.calls == []


@pytest.mark.parametrize("text", ["", "   \n "])
async def test_blank_input(text):
    await expect_error(ErrorKind.INPUT, [mock(Fault.OK)], text=text)


async def test_too_long_input():
    err = await expect_error(ErrorKind.INPUT, [mock(Fault.OK)], text="a" * (ECHO.max_input_chars + 1))
    assert not err.retryable


async def test_system_prompt_embeds_schema_and_example():
    p = Scripted(GOOD)
    await run([p])
    system = p.calls[0]["system"]
    assert '"items"' in system and "Buy groceries" in system
    assert p.calls[0]["json_schema"] == ECHO.Schema.model_json_schema()


async def test_usage_is_summed_across_repair_and_priced():
    p = Scripted('{"title": "x"}', GOOD, model="gpt-5.4-mini", usage=Usage(1000, 200))
    u = (await run([p])).meta.usage
    assert (u.inputTokens, u.outputTokens) == (2000, 400)
    assert u.costUsd == pytest.approx((2000 * 0.75 + 400 * 4.50) / 1e6)


async def test_usage_unknown_model_has_tokens_but_no_cost():
    env = await run([Scripted(GOOD, model="some-new-model", usage=Usage(10, 5))])
    assert env.meta.usage.model_dump() == {"inputTokens": 10, "outputTokens": 5, "costUsd": None}


async def test_usage_absent_when_not_reported():
    assert (await run([mock(Fault.OK)])).meta.usage is None
