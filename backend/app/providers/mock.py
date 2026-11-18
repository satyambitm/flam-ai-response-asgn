"""Fault-injection provider. Reproduces every failure mode on demand, at no cost."""

import asyncio
import json
from enum import StrEnum
from typing import Any

from app.providers.base import Completion, ProviderError


class Fault(StrEnum):
    OK = "ok"
    FENCED = "fenced"
    PROSE = "prose"
    TRUNCATED = "truncated"
    WRONG_SHAPE = "wrong_shape"
    EMPTY = "empty"
    SLOW = "slow"
    TIMEOUT = "timeout"
    ERROR_500 = "error_500"
    RATE_429 = "rate_429"
    BAD_THEN_OK = "bad_then_ok"


class MockProvider:
    name = "mock"

    def __init__(self, fault: Fault, example: dict[str, Any], *, slow_s: float = 6.0):
        self.fault = fault
        self.model = f"mock-{fault}"
        self._good = json.dumps(example)
        self._example = example
        self._slow_s = slow_s
        self._calls = 0

    async def generate(self, *, system: str, user: str, json_schema: dict[str, Any], timeout_s: float) -> Completion:
        return Completion(await self._text(timeout_s))

    async def _text(self, timeout_s: float) -> str:
        self._calls += 1
        match self.fault:
            case Fault.OK:
                return self._good
            case Fault.FENCED:
                return f"```json\n{self._good}\n```"
            case Fault.PROSE:
                return f"Sure! Here is your result:\n{self._good}\nLet me know if you need anything else."
            case Fault.TRUNCATED:
                return self._good[: len(self._good) // 2]
            case Fault.WRONG_SHAPE:
                return json.dumps({"result": self._example})
            case Fault.EMPTY:
                return json.dumps(_empty_lists(self._example))
            case Fault.SLOW:
                await asyncio.sleep(self._slow_s)
                return self._good
            case Fault.TIMEOUT:
                await asyncio.sleep(timeout_s + 60)  # cancelled by the caller's timeout
                return self._good
            case Fault.ERROR_500:
                raise ProviderError("mock upstream error", status=500)
            case Fault.RATE_429:
                raise ProviderError("mock rate limit", status=429, retry_after=7)
            case Fault.BAD_THEN_OK:
                return json.dumps({"result": self._example}) if self._calls == 1 else self._good


def _empty_lists(value: Any) -> Any:
    """Same shape, every list emptied: valid for the schema but with no useful content."""
    if isinstance(value, dict):
        return {k: _empty_lists(v) for k, v in value.items()}
    return [] if isinstance(value, list) else value
