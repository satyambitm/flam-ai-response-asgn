"""Adapter behavior with the SDK network layer faked out: success path, request shape, exception mapping."""

from types import SimpleNamespace

import groq
import httpx
import openai
import pytest
from google.genai import errors as gerrors

from app.config import Settings
from app.core.errors import AppError, ErrorKind
from app.providers.base import MAX_OUTPUT_TOKENS, ProviderError, Usage
from app.providers.factory import build_providers, chain_for
from app.providers.gemini import GeminiProvider
from app.providers.groq import GroqProvider
from app.providers.mock import Fault
from app.providers.openai import OpenAIProvider, to_strict
from app.themes.registry import THEMES

SCHEMA = THEMES["echo"].Schema.model_json_schema()
REQ = httpx.Request("POST", "https://api.example/v1/chat/completions")


class FakeCreate:
    def __init__(self, result):
        self.result, self.kwargs = result, None

    async def __call__(self, **kwargs):
        self.kwargs = kwargs
        if isinstance(self.result, BaseException):
            raise self.result
        return self.result


def chat_provider(cls, result):
    p = cls("test-key", "openai/gpt-oss-20b" if cls is GroqProvider else "gpt-4.1-mini")
    fake = FakeCreate(result)
    p._client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=fake)))
    return p, fake


def completion(text: str | None, usage=None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))], usage=usage)


async def call(p) -> str:
    return (await p.generate(system="sys", user="usr", json_schema=SCHEMA, timeout_s=3)).text


def status_error(sdk, status: int, headers: dict | None = None, body: object = None):
    return sdk.APIStatusError("err", response=httpx.Response(status, headers=headers, request=REQ), body=body)


# --- OpenAI-compatible adapters (groq, openai) ---


@pytest.mark.parametrize("cls", [GroqProvider, OpenAIProvider])
async def test_chat_success_and_request_shape(cls):
    p, fake = chat_provider(cls, completion('{"a": 1}'))
    assert await call(p) == '{"a": 1}'
    assert fake.kwargs["timeout"] == 3
    assert fake.kwargs["max_completion_tokens"] == MAX_OUTPUT_TOKENS
    assert fake.kwargs["messages"][0] == {"role": "system", "content": "sys"}
    assert fake.kwargs["response_format"]["type"] == "json_schema"


@pytest.mark.parametrize("cls", [GroqProvider, OpenAIProvider])
async def test_chat_null_content_is_empty_text(cls):
    p, _ = chat_provider(cls, completion(None))
    assert await call(p) == ""


@pytest.mark.parametrize(("cls", "sdk"), [(GroqProvider, groq), (OpenAIProvider, openai)])
@pytest.mark.parametrize(
    ("make_exc", "status", "timeout", "retry_after", "retryable"),
    [
        (lambda sdk: status_error(sdk, 429, {"retry-after": "12"}), 429, False, 12, True),
        (lambda sdk: status_error(sdk, 503), 503, False, None, True),
        (lambda sdk: status_error(sdk, 401), 401, False, None, False),
        (lambda sdk: sdk.APITimeoutError(request=REQ), None, True, None, True),
        (lambda sdk: sdk.APIConnectionError(request=REQ), None, False, None, True),
    ],
    ids=["429", "503", "401", "timeout", "connection"],
)
async def test_chat_exception_mapping(cls, sdk, make_exc, status, timeout, retry_after, retryable):
    p, _ = chat_provider(cls, make_exc(sdk))
    with pytest.raises(ProviderError) as exc:
        await call(p)
    e = exc.value
    assert (e.status, e.timeout, e.retry_after, e.retryable) == (status, timeout, retry_after, retryable)
    assert "test-key" not in str(e)


async def test_groq_failed_schema_check_returns_output_for_repair():
    body = {"error": {"code": "json_validate_failed", "failed_generation": '{"title": 1}'}}
    p, _ = chat_provider(GroqProvider, status_error(groq, 400, body=body))
    assert await call(p) == '{"title": 1}'


def test_groq_json_object_for_models_without_schema_support():
    assert GroqProvider("k", "llama-3.3-70b-versatile").response_format(SCHEMA) == {"type": "json_object"}


def test_sdk_retries_disabled():
    assert GroqProvider("k", "m")._client.max_retries == 0
    assert OpenAIProvider("k", "m")._client.max_retries == 0


# --- OpenAI strict schema ---


def test_to_strict_closes_objects_and_requires_all_fields():
    strict = to_strict(SCHEMA)
    item = strict["$defs"]["EchoItem"]
    assert item["required"] == ["id", "text"] and item["additionalProperties"] is False
    assert "default" not in item["properties"]["id"]
    assert strict["additionalProperties"] is False
    assert "additionalProperties" not in SCHEMA  # input untouched


def test_to_strict_keeps_a_property_named_default():
    schema = {"type": "object", "properties": {"default": {"type": "string", "default": "x"}}}
    assert to_strict(schema)["properties"] == {"default": {"type": "string"}}


def test_openai_free_form_object_falls_back_to_json_object():
    free = {"type": "object", "additionalProperties": {"type": "string"}}
    assert OpenAIProvider("k", "m").response_format(free) == {"type": "json_object"}


# --- Gemini ---


def gemini_provider(result):
    p = GeminiProvider("test-key", "gemini-test")
    fake = FakeCreate(result)

    async def generate_content(**kwargs):
        return await fake(**kwargs)

    p._client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate_content)))
    return p, fake


async def test_gemini_success_and_config():
    p, fake = gemini_provider(SimpleNamespace(text='{"a": 1}', usage_metadata=None))
    assert await call(p) == '{"a": 1}'
    config = fake.kwargs["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == SCHEMA
    assert config.system_instruction == "sys"
    assert config.max_output_tokens == MAX_OUTPUT_TOKENS
    assert config.http_options.timeout == 10_000  # Gemini's minimum; asyncio.timeout enforces our 3s
    assert config.http_options.retry_options.attempts == 1


@pytest.mark.parametrize(
    ("exc", "status", "timeout", "retry_after", "retryable"),
    [
        (gerrors.ClientError(429, {"error": {"code": 429, "details": [{"retryDelay": "17s"}]}}), 429, False, 17, True),
        (gerrors.ServerError(503, {"error": {"code": 503, "status": "UNAVAILABLE"}}), 503, False, None, True),
        (gerrors.ClientError(400, {"error": {"code": 400, "status": "INVALID_ARGUMENT"}}), 400, False, None, False),
        (httpx.ReadTimeout("slow"), None, True, None, True),
        (httpx.ConnectError("dns"), None, False, None, True),
    ],
    ids=["429", "503", "400", "timeout", "connection"],
)
async def test_gemini_exception_mapping(exc, status, timeout, retry_after, retryable):
    p, _ = gemini_provider(exc)
    with pytest.raises(ProviderError) as info:
        await call(p)
    e = info.value
    assert (e.status, e.timeout, e.retry_after, e.retryable) == (status, timeout, retry_after, retryable)


# --- factory ---


def settings(**kw) -> Settings:
    return Settings(_env_file=None, **kw)


def names(providers) -> list[str]:
    return [p.name for p in providers]


def test_factory_builds_primary_fallback_and_other_keyed_providers():
    built = build_providers(
        settings(llm_provider="groq", llm_fallback="gemini", gemini_api_key="a", groq_api_key="b", openai_api_key="c")
    )
    assert names(built.chain) == ["groq", "gemini"]
    assert list(built.available) == ["groq", "gemini", "openai"]  # chain order first
    assert built.available["groq"] is built.chain[0]  # one client per provider, shared


def test_factory_missing_primary_key_fails_fast():
    with pytest.raises(RuntimeError, match="GEMINI_API_KEY"):
        build_providers(settings(llm_provider="gemini"))


def test_factory_missing_fallback_key_disables_fallback():
    built = build_providers(settings(llm_provider="openai", llm_fallback="groq", openai_api_key="a"))
    assert names(built.chain) == ["openai"] and list(built.available) == ["openai"]


def test_factory_ignores_fallback_equal_to_primary_and_blank():
    assert len(build_providers(settings(llm_provider="groq", llm_fallback="groq", groq_api_key="a")).chain) == 1
    assert len(build_providers(settings(llm_provider="groq", llm_fallback="", groq_api_key="a")).chain) == 1


def test_factory_mock_mode_builds_nothing():
    built = build_providers(settings(llm_provider="mock", groq_api_key="a"))
    assert built.chain == [] and built.available == {}


# --- per-request routing ---

ECHO = THEMES["echo"]
REAL = settings(llm_provider="groq", llm_fallback="gemini", groq_api_key="a", gemini_api_key="b", openai_api_key="c")


def test_no_choice_uses_the_configured_chain():
    built = build_providers(REAL)
    assert chain_for(REAL, built, ECHO, None, None) == built.chain


def test_chosen_provider_goes_first_with_the_chain_behind_it():
    built = build_providers(REAL)
    assert names(chain_for(REAL, built, ECHO, None, "openai")) == ["openai", "groq", "gemini"]
    assert names(chain_for(REAL, built, ECHO, None, "gemini")) == ["gemini", "groq"]  # no duplicate


def test_unconfigured_provider_is_an_input_error():
    s = settings(llm_provider="groq", groq_api_key="a")
    with pytest.raises(AppError) as exc:
        chain_for(s, build_providers(s), ECHO, None, "openai")
    assert exc.value.kind == ErrorKind.INPUT and "OpenAI" in exc.value.message


def test_mock_mode_only_accepts_mock():
    s = settings(llm_provider="mock")
    assert names(chain_for(s, build_providers(s), ECHO, None, "mock")) == ["mock"]
    with pytest.raises(AppError):
        chain_for(s, build_providers(s), ECHO, None, "groq")


def test_fault_overrides_the_chosen_provider():
    s = REAL.model_copy(update={"allow_faults": True})
    chain = chain_for(s, build_providers(s), ECHO, Fault.RATE_429, "openai")
    assert names(chain) == ["mock"] and chain[0].model == "mock-rate_429"


# --- usage ---


@pytest.mark.parametrize("cls", [GroqProvider, OpenAIProvider])
async def test_chat_reports_usage(cls):
    p, _ = chat_provider(cls, completion("{}", SimpleNamespace(prompt_tokens=120, completion_tokens=30)))
    result = await p.generate(system="s", user="u", json_schema=SCHEMA, timeout_s=3)
    assert result.usage == Usage(120, 30)


async def test_gemini_usage_counts_thinking_as_output():
    meta = SimpleNamespace(prompt_token_count=100, candidates_token_count=20, thoughts_token_count=50)
    p, _ = gemini_provider(SimpleNamespace(text="{}", usage_metadata=meta))
    result = await p.generate(system="s", user="u", json_schema=SCHEMA, timeout_s=3)
    assert result.usage == Usage(100, 70)
