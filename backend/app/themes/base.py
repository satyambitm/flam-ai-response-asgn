from dataclasses import dataclass
from typing import Any, ClassVar, Protocol
from uuid import uuid4

from pydantic import BaseModel


@dataclass(frozen=True)
class Prompt:
    system: str
    user: str


class Theme(Protocol):
    """A plugin: everything theme-specific on the backend. The core never imports a concrete theme."""

    id: ClassVar[str]
    title: ClassVar[str]
    input_hint: ClassVar[str]
    max_input_chars: ClassVar[int]
    Schema: ClassVar[type[BaseModel]]
    # A valid output. Shown to the model as a shape example and served by the mock provider.
    example: ClassVar[dict[str, Any]]

    def build_prompt(self, user_input: str) -> Prompt: ...
    def normalize(self, data: BaseModel) -> BaseModel: ...
    def is_empty(self, data: BaseModel) -> bool: ...


def new_id() -> str:
    return uuid4().hex[:8]
