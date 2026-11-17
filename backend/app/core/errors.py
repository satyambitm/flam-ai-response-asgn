from enum import StrEnum


class ErrorKind(StrEnum):
    INPUT = "input"
    RATE_LIMITED = "rate_limited"
    PROVIDER = "provider"
    TIMEOUT = "timeout"
    MALFORMED = "malformed"
    INVALID_SHAPE = "invalid_shape"
    EMPTY = "empty"
    INTERNAL = "internal"


HTTP_STATUS: dict[ErrorKind, int] = {
    ErrorKind.INPUT: 422,
    ErrorKind.RATE_LIMITED: 429,
    ErrorKind.PROVIDER: 502,
    ErrorKind.TIMEOUT: 504,
    ErrorKind.MALFORMED: 502,
    ErrorKind.INVALID_SHAPE: 502,
    ErrorKind.EMPTY: 422,
    ErrorKind.INTERNAL: 500,
}


class AppError(Exception):
    """An expected failure that maps 1:1 to an error envelope."""

    def __init__(self, kind: ErrorKind, message: str, *, retry_after: int | None = None):
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.retry_after = retry_after

    @property
    def status(self) -> int:
        return HTTP_STATUS[self.kind]

    @property
    def retryable(self) -> bool:
        return self.kind is not ErrorKind.INPUT
