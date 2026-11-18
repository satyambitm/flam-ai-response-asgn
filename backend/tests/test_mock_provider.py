import asyncio

import pytest

from app.core.extract import ExtractError, extract_json
from app.providers.base import ProviderError, parse_retry_after
from app.providers.mock import Fault, MockProvider

EXAMPLE = {"title": "t", "items": [{"text": "a"}]}


async def call(fault: Fault, *, timeout_s: float = 1.0, provider: MockProvider | None = None) -> str:
    provider = provider or MockProvider(fault, EXAMPLE, slow_s=0.01)
    return (await provider.generate(system="s", user="u", json_schema={}, timeout_s=timeout_s)).text


@pytest.mark.parametrize("fault", [Fault.OK, Fault.FENCED, Fault.PROSE, Fault.SLOW])
async def test_recoverable_text_extracts_to_example(fault):
    assert extract_json(await call(fault)) == EXAMPLE


async def test_truncated_does_not_extract():
    with pytest.raises(ExtractError):
        extract_json(await call(Fault.TRUNCATED))


async def test_wrong_shape_and_empty():
    assert extract_json(await call(Fault.WRONG_SHAPE)) == {"result": EXAMPLE}
    assert extract_json(await call(Fault.EMPTY)) == {"title": "t", "items": []}


async def test_bad_then_ok_recovers_on_second_call():
    p = MockProvider(Fault.BAD_THEN_OK, EXAMPLE)
    assert extract_json(await call(Fault.BAD_THEN_OK, provider=p)) != EXAMPLE
    assert extract_json(await call(Fault.BAD_THEN_OK, provider=p)) == EXAMPLE


async def test_errors():
    with pytest.raises(ProviderError) as e500:
        await call(Fault.ERROR_500)
    assert e500.value.status == 500 and e500.value.retryable
    with pytest.raises(ProviderError) as e429:
        await call(Fault.RATE_429)
    assert e429.value.rate_limited and e429.value.retry_after == 7


async def test_timeout_hangs_past_its_budget():
    with pytest.raises(TimeoutError):
        async with asyncio.timeout(0.05):
            await call(Fault.TIMEOUT, timeout_s=0.01)


@pytest.mark.parametrize(
    ("status", "timeout", "retryable"),
    [
        (None, False, True),
        (None, True, True),
        (408, False, True),
        (429, False, True),
        (503, False, True),
        (400, False, False),
        (401, False, False),
    ],
)
def test_retryable_classification(status, timeout, retryable):
    assert ProviderError("x", status=status, timeout=timeout).retryable is retryable


@pytest.mark.parametrize(("value", "expected"), [(None, None), ("", None), ("3", 3), ("0.2", 1), ("soon", None)])
def test_parse_retry_after(value, expected):
    assert parse_retry_after(value) == expected
