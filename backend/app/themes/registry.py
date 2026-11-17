from app.core.errors import AppError, ErrorKind
from app.themes.base import Theme
from app.themes.echo import EchoTheme

# Adding a theme = one theme module + one entry here.
THEMES: dict[str, Theme] = {t.id: t for t in (EchoTheme(),)}


def get_theme(theme_id: str) -> Theme:
    try:
        return THEMES[theme_id]
    except KeyError:
        raise AppError(ErrorKind.INPUT, f"Unknown theme '{theme_id}'.") from None
