import pytest

from app.core.errors import AppError, ErrorKind
from app.themes.registry import THEMES, get_theme


@pytest.mark.parametrize("theme", THEMES.values(), ids=lambda t: t.id)
def test_example_is_valid_and_not_empty(theme):
    data = theme.normalize(theme.Schema.model_validate(theme.example))
    assert not theme.is_empty(data)


@pytest.mark.parametrize("theme", THEMES.values(), ids=lambda t: t.id)
def test_prompt_contains_input(theme):
    assert "hello world" in theme.build_prompt("hello world").user


def test_unknown_theme_is_input_error():
    with pytest.raises(AppError) as exc:
        get_theme("nope")
    assert exc.value.kind is ErrorKind.INPUT


def test_echo_normalize_trims_drops_blanks_and_assigns_ids():
    echo = THEMES["echo"]
    raw = echo.Schema.model_validate(
        {"title": "  ", "items": [{"text": " a "}, {"text": "  "}, {"id": "x", "text": "b"}], "extra": 1}
    )
    data = echo.normalize(raw)
    assert data.title == "Untitled"
    assert [i.text for i in data.items] == ["a", "b"]
    assert len({i.id for i in data.items}) == 2 and all(len(i.id) == 8 for i in data.items)


def test_echo_empty():
    echo = THEMES["echo"]
    assert echo.is_empty(echo.normalize(echo.Schema.model_validate({"title": "t", "items": [{"text": " "}]})))


def test_themes_route(client):
    r = client.get("/themes")
    assert r.status_code == 200
    assert {"id": "echo", "title": "Echo (pipeline test)", "inputHint": THEMES["echo"].input_hint, "maxInputChars": 4000} in r.json()

