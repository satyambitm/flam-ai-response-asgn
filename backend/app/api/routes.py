from typing import Annotated

from fastapi import APIRouter, Header, Request

from app.api.schemas import ErrorEnvelope, GenerateRequest, Health, ProvidersInfo, SuccessEnvelope, ThemeInfo
from app.core import pipeline
from app.providers.factory import chain_for, options
from app.providers.mock import Fault
from app.themes.registry import THEMES, get_theme

router = APIRouter()

_ERRORS = {code: {"model": ErrorEnvelope} for code in (422, 429, 500, 502, 504)}


@router.get("/health")
def health() -> Health:
    return Health()


@router.get("/themes")
def themes() -> list[ThemeInfo]:
    return [
        ThemeInfo(id=t.id, title=t.title, inputHint=t.input_hint, maxInputChars=t.max_input_chars)
        for t in THEMES.values()
    ]


@router.get("/providers")
def providers(request: Request) -> ProvidersInfo:
    state = request.app.state
    return ProvidersInfo(default=state.settings.llm_provider, options=options(state.settings, state.providers))


@router.post("/generate", responses=_ERRORS)
async def generate(
    body: GenerateRequest, request: Request, x_fault: Annotated[Fault | None, Header()] = None
) -> SuccessEnvelope:
    state = request.app.state
    state.limiter.check(request.client.host if request.client else "unknown")
    theme = get_theme(body.themeId)
    chain = chain_for(state.settings, state.providers, theme, x_fault, body.providerId)
    return await pipeline.generate(
        theme,
        body.input,
        chain,
        total_s=state.settings.total_timeout_s,
        provider_s=state.settings.provider_timeout_s,
    )
