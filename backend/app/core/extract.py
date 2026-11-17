"""Lenient JSON extraction from raw model text. Never guesses: truncated JSON fails."""

import json
import re
from typing import Any

_FENCE = re.compile(r"```[a-zA-Z]*\s*\n?(.*?)```", re.DOTALL)
_MAX_CANDIDATES = 20
_PAIRS = {"{": "}", "[": "]"}
_UNCLOSED, _MISMATCH = -1, -2


class ExtractError(ValueError):
    """No usable JSON in the text. The message is short and safe to show the model in a repair prompt."""


def extract_json(text: str) -> Any:
    text = text.strip()
    if not text:
        raise ExtractError("output was empty")

    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Scan top-level candidates only: a fragment nested inside a broken or unclosed
    # outer block is never returned, so truncated output can't half-succeed.
    pos = tries = 0
    while tries < _MAX_CANDIDATES:
        start = next((i for i in range(pos, len(text)) if text[i] in _PAIRS), None)
        if start is None:
            break
        tries += 1
        end = _match_end(text, start)
        if end == _UNCLOSED:
            break
        if end == _MISMATCH:
            pos = start + 1
            continue
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            pos = end + 1
    raise ExtractError("no complete JSON object or array found (output may be truncated)")


def _match_end(text: str, start: int) -> int:
    """Index of the bracket closing text[start], or _UNCLOSED / _MISMATCH. String-aware."""
    stack: list[str] = []
    in_string = escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in _PAIRS:
            stack.append(_PAIRS[ch])
        elif ch in "}]":
            if stack.pop() != ch:
                return _MISMATCH
            if not stack:
                return i
    return _UNCLOSED
