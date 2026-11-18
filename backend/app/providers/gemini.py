from typing import Any

from google import genai
from google.genai import errors, types

from app.providers.base import ProviderError, parse_retry_after

# attempts=1 disables both tenacity retries and the SDK's implicit connection-error retry.
_NO_RETRY = types.HttpRetryOptions(attempts=1)
# Gemini rejects deadlines under 10s (400). Our caller's asyncio.timeout still enforces the real budget.
_MIN_SERVER_TIMEOUT_S = 10


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str):
        self.model = model
        self._client = genai.Client(api_key=api_key, http_options=types.HttpOptions(retry_options=_NO_RETRY))

    async def generate(self, *, system: str, user: str, json_schema: dict[str, Any], timeout_s: float) -> str:
        config = types.GenerateContentConfig(
            system_instruction=system,
            response_mime_type="application/json",
            response_json_schema=json_schema,
            http_options=types.HttpOptions(
                timeout=int(max(timeout_s, _MIN_SERVER_TIMEOUT_S) * 1000), retry_options=_NO_RETRY
            ),
        )
        try:
            resp = await self._client.aio.models.generate_content(model=self.model, contents=user, config=config)
        except errors.APIError as e:
            raise ProviderError(
                f"gemini {e.code} {e.status}: {(e.message or '')[:160]}", status=e.code, retry_after=_retry_delay(e)
            ) from e
        except Exception as e:  # transport layer (httpx/aiohttp): timeouts, DNS, resets
            raise ProviderError(f"gemini transport: {type(e).__name__}", timeout=_is_timeout(e)) from e
        return resp.text or ""


def _retry_delay(e: errors.APIError) -> int | None:
    """Gemini puts the 429 wait in error.details[].retryDelay, e.g. "17s"."""
    details = (e.details or {}).get("error", {}).get("details", []) if isinstance(e.details, dict) else []
    delay = next((d.get("retryDelay") for d in details if isinstance(d, dict) and d.get("retryDelay")), None)
    return parse_retry_after(delay.rstrip("s")) if delay else None


def _is_timeout(e: Exception) -> bool:
    return isinstance(e, TimeoutError) or "timeout" in type(e).__name__.lower()
