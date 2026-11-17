import math
import time
from collections import deque

from app.core.errors import AppError, ErrorKind

_WINDOW_S = 60.0
_SWEEP_EVERY = 1000


class RateLimiter:
    """In-memory sliding window per key (client IP). Resets on restart; fine for one instance."""

    def __init__(self, per_minute: int):
        self._limit = per_minute
        self._hits: dict[str, deque[float]] = {}
        self._checks = 0

    def check(self, key: str) -> None:
        now = time.monotonic()
        self._checks += 1
        if self._checks % _SWEEP_EVERY == 0:
            self._hits = {k: q for k, q in self._hits.items() if q and now - q[-1] < _WINDOW_S}

        hits = self._hits.setdefault(key, deque())
        while hits and now - hits[0] >= _WINDOW_S:
            hits.popleft()
        if len(hits) >= self._limit:
            wait = math.ceil(_WINDOW_S - (now - hits[0]))
            raise AppError(ErrorKind.RATE_LIMITED, f"Too many requests. Try again in {wait}s.", retry_after=wait)
        hits.append(now)
