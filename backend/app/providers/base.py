from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Usage:
    """Token counts as reported by the provider (output includes any reasoning/thinking tokens)."""

    input_tokens: int
    output_tokens: int


@dataclass(frozen=True)
class Completion:
    text: str
    usage: Usage | None = None  # None when the provider didn't report it (mock, failed-schema output)


class Provider(Protocol):
    name: str
    model: str

    async def generate(self, *, system: str, user: str, json_schema: dict[str, Any], timeout_s: float) -> str:
        """Return the model's raw text. Raise ProviderError for every provider-side failure."""
        ...


class ProviderError(Exception):
    """A provider-level failure. Adapters map every SDK exception to this; no SDK type leaks out."""

    def __init__(
        self,
        message: str,
        *,
        status: int | None = None,
        retry_after: int | None = None,
        timeout: bool = False,
    ):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after
        self.timeout = timeout

    @property
    def rate_limited(self) -> bool:
        return self.status == 429

    @property
    def retryable(self) -> bool:
        """Worth trying the fallback: timeouts, network errors (no status), 408/429 and 5xx."""
        return self.timeout or self.status is None or self.status in (408, 429) or self.status >= 500


def parse_retry_after(value: str | None) -> int | None:
    try:
        return max(1, round(float(value))) if value else None
    except ValueError:
        return None
