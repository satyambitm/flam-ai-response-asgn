import copy
from typing import Any

import openai

from app.providers.chat import ChatCompletionsProvider


class OpenAIProvider(ChatCompletionsProvider):
    name = "openai"

    def __init__(self, api_key: str, model: str):
        super().__init__(client=openai.AsyncOpenAI(api_key=api_key, max_retries=0), sdk=openai, model=model)

    def response_format(self, json_schema: dict[str, Any]) -> dict[str, Any]:
        try:
            strict = to_strict(json_schema)
        except ValueError:
            return {"type": "json_object"}
        return {"type": "json_schema", "json_schema": {"name": "result", "schema": strict, "strict": True}}


def to_strict(schema: dict[str, Any]) -> dict[str, Any]:
    """Adapt a Pydantic JSON schema to OpenAI strict mode: every object closed and fully required, no defaults.

    Fields that had defaults become required; the model fills them and our validation accepts that.
    Raises ValueError for shapes strict mode can't express (free-form dicts).
    """
    out = copy.deepcopy(schema)
    _strict_node(out)
    for sub in out.get("$defs", {}).values():
        _strict_node(sub)
    return out


def _strict_node(node: dict[str, Any]) -> None:
    node.pop("default", None)
    if node.get("type") == "object":
        if "properties" not in node:
            raise ValueError("free-form object")
        node["additionalProperties"] = False
        node["required"] = list(node["properties"])
    for sub in node.get("properties", {}).values():
        _strict_node(sub)
    if isinstance(node.get("items"), dict):
        _strict_node(node["items"])
    for key in ("anyOf", "allOf", "oneOf", "prefixItems"):
        for sub in node.get(key, []):
            _strict_node(sub)
