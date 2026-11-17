from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.errors import ErrorKind


class ErrorBody(BaseModel):
    kind: ErrorKind
    message: str
    retryable: bool
    retryAfter: int | None = None


class ErrorEnvelope(BaseModel):
    ok: Literal[False] = False
    error: ErrorBody


class Meta(BaseModel):
    attempts: int
    provider: str
    model: str
    latencyMs: int
    repaired: bool


class SuccessEnvelope(BaseModel):
    ok: Literal[True] = True
    data: Any
    meta: Meta


class Health(BaseModel):
    ok: Literal[True] = True
