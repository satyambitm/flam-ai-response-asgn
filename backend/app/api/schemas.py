from typing import Literal, Union

from pydantic import BaseModel, Field

from app.core.errors import ErrorKind
from app.themes.registry import THEMES

# Union of every theme's output model, so OpenAPI (and the generated TS types) know each shape.
ThemeData = Union[tuple(t.Schema for t in THEMES.values())]  # type: ignore[valid-type]  # noqa: UP007


class GenerateRequest(BaseModel):
    themeId: str = Field(max_length=64)
    # Hard cap on the body; the per-theme cap (max_input_chars) is checked in the pipeline.
    input: str = Field(max_length=20_000)


class ErrorBody(BaseModel):
    kind: ErrorKind
    message: str
    retryable: bool
    retryAfter: int | None = None


class ErrorEnvelope(BaseModel):
    ok: Literal[False] = False
    error: ErrorBody


class UsageMeta(BaseModel):
    """Summed over every model call in the request, repair attempt included."""

    inputTokens: int
    outputTokens: int
    costUsd: float | None  # None when a model has no known price or a call didn't report usage


class Meta(BaseModel):
    attempts: int
    provider: str
    model: str
    latencyMs: int
    repaired: bool
    usage: UsageMeta | None  # None when no call reported usage (e.g. the mock provider)


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
