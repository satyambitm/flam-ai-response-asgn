"""Throwaway theme used to exercise the pipeline end to end."""

from pydantic import BaseModel, ConfigDict

from app.themes.base import Prompt, new_id


class EchoItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = ""
    text: str


class EchoData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    items: list[EchoItem]


class EchoTheme:
    id = "echo"
    title = "Echo (pipeline test)"
    input_hint = "Any text. It comes back as a title and a list of key points."
    max_input_chars = 4000
    Schema = EchoData
    example = {"title": "Weekend chores", "items": [{"text": "Buy groceries"}, {"text": "Clean the kitchen"}]}

    def build_prompt(self, user_input: str) -> Prompt:
        return Prompt(
            system="Turn the user's text into a short title and its key points, each under 15 words.",
            user=user_input,
        )

    def normalize(self, data: EchoData) -> EchoData:
        items = [EchoItem(id=new_id(), text=t) for item in data.items if (t := item.text.strip())]
        return EchoData(title=data.title.strip() or "Untitled", items=items)

    def is_empty(self, data: EchoData) -> bool:
        return not data.items
