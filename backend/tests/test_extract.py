from pathlib import Path

import pytest

from app.core.extract import ExtractError, extract_json

FIXTURES = Path(__file__).parent / "fixtures"
EXPECTED = {"title": "Plan", "items": [{"text": "a"}]}


def _fixtures(prefix: str) -> list[Path]:
    return sorted(FIXTURES.glob(f"{prefix}_*.txt"))


@pytest.mark.parametrize("path", _fixtures("ok"), ids=lambda p: p.stem)
def test_extracts_valid_json(path: Path):
    value = extract_json(path.read_text())
    assert isinstance(value, (dict, list))


@pytest.mark.parametrize("path", _fixtures("bad"), ids=lambda p: p.stem)
def test_rejects_unusable_output(path: Path):
    with pytest.raises(ExtractError):
        extract_json(path.read_text())


@pytest.mark.parametrize("name", ["clean", "fenced", "fenced_no_lang", "prose", "prose_with_stray_braces"])
def test_exact_value(name: str):
    assert extract_json((FIXTURES / f"ok_{name}.txt").read_text()) == EXPECTED


def test_braces_and_escaped_quotes_inside_strings():
    value = extract_json((FIXTURES / "ok_braces_in_strings.txt").read_text())
    assert value["title"] == 'Plan } with { braces " and quotes'


def test_array_root():
    assert extract_json((FIXTURES / "ok_array_root.txt").read_text()) == [{"text": "a"}, {"text": "b"}]


def test_error_message_is_short():
    with pytest.raises(ExtractError, match="truncated"):
        extract_json('{"a": [1, 2')
