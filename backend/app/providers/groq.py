from typing import Any

import groq

from app.providers.chat import ChatCompletionsProvider

# Model families on Groq that accept response_format=json_schema; others get json_object.
_JSON_SCHEMA_MODELS = ("openai/gpt-oss", "moonshotai/kimi-k2", "meta-llama/llama-4")


class GroqProvider(ChatCompletionsProvider):
    name = "groq"

    def __init__(self, api_key: str, model: str):
        super().__init__(client=groq.AsyncGroq(api_key=api_key, max_retries=0), sdk=groq, model=model)

    def response_format(self, json_schema: dict[str, Any]) -> dict[str, Any]:
        if self.model.startswith(_JSON_SCHEMA_MODELS):
            return {"type": "json_schema", "json_schema": {"name": "result", "schema": json_schema}}
        return {"type": "json_object"}
