from typing import Literal, Union

from pydantic import BaseModel

from app.core.errors import ErrorKind
from app.themes.registry import THEMES

# Union of every theme's output model, so OpenAPI (and the generated TS types) know each shape.
ThemeData = Union[tuple(t.Schema for t in THEMES.values())]  # type: ignore[valid-type]


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
    data: ThemeData
    meta: Meta


class Health(BaseModel):
    ok: Literal[True] = True


class ThemeInfo(BaseModel):
    id: str
    title: str
    inputHint: str
    maxInputChars: int
