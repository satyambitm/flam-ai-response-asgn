from fastapi import APIRouter

from app.api.schemas import Health, ThemeInfo
from app.themes.registry import THEMES

router = APIRouter()


@router.get("/health")
def health() -> Health:
    return Health()


@router.get("/themes")
def themes() -> list[ThemeInfo]:
    return [
        ThemeInfo(id=t.id, title=t.title, inputHint=t.input_hint, maxInputChars=t.max_input_chars)
        for t in THEMES.values()
    ]
