"""Shared adapter for OpenAI-compatible SDKs (openai, groq): same client surface, same exception types."""

from types import ModuleType
from typing import Any

from app.providers.base import ProviderError, parse_retry_after


class ChatCompletionsProvider:
    name: str

    def __init__(self, *, client: Any, sdk: ModuleType, model: str):
        self.model = model
        self._client = client  # constructed with max_retries=0
        self._sdk = sdk

    def response_format(self, json_schema: dict[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    async def generate(self, *, system: str, user: str, json_schema: dict[str, Any], timeout_s: float) -> str:
        sdk = self._sdk
        try:
            resp = await self._client.chat.completions.create(
                model=self.model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format=self.response_format(json_schema),
                timeout=timeout_s,
            )
        except sdk.APIStatusError as e:
            failed = _failed_generation(e.body)
            if failed is not None:
                return failed  # server-side schema check failed: still output, so our repair path handles it
            retry_after = parse_retry_after(e.response.headers.get("retry-after"))
            raise ProviderError(f"{self.name}: {e.message[:160]}", status=e.status_code, retry_after=retry_after) from e
        except sdk.APITimeoutError as e:
            raise ProviderError(f"{self.name} timed out", timeout=True) from e
        except sdk.APIError as e:  # connection errors and anything else from the SDK
            raise ProviderError(f"{self.name} transport: {type(e).__name__}") from e
        return resp.choices[0].message.content or ""


def _failed_generation(body: object) -> str | None:
    """Groq returns 400 json_validate_failed with the model's output when it misses the schema."""
    err = body.get("error", body) if isinstance(body, dict) else None
    if isinstance(err, dict) and err.get("code") == "json_validate_failed":
        return str(err.get("failed_generation") or "")
    return None
