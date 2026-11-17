import logging

from app.config import ProviderName, Settings
from app.providers.base import Provider
from app.providers.gemini import GeminiProvider
from app.providers.groq import GroqProvider
from app.providers.mock import Fault, MockProvider
from app.providers.openai import OpenAIProvider
from app.themes.base import Theme

log = logging.getLogger("app.providers")

_ADAPTERS = {"gemini": GeminiProvider, "groq": GroqProvider, "openai": OpenAIProvider}


def build_providers(settings: Settings) -> list[Provider]:
    """The real primary + fallback chain, built once at startup so SDK clients are reused.

    A missing primary key is a startup error; a missing fallback key just disables the fallback.
    """
    if settings.llm_provider == "mock":
        return []
    chain = [_build(settings, settings.llm_provider, required=True)]
    fallback = settings.llm_fallback
    if fallback and fallback not in ("mock", settings.llm_provider):
        chain.append(_build(settings, fallback, required=False))
    return [p for p in chain if p is not None]


def _build(settings: Settings, name: ProviderName, *, required: bool) -> Provider | None:
    key = getattr(settings, f"{name}_api_key")
    if key is None or not key.get_secret_value():
        if required:
            raise RuntimeError(f"LLM_PROVIDER={name} but {name.upper()}_API_KEY is not set")
        log.warning("fallback %s disabled: %s_API_KEY is not set", name, name.upper())
        return None
    return _ADAPTERS[name](key.get_secret_value(), getattr(settings, f"{name}_model"))


def chain_for(settings: Settings, providers: list[Provider], theme: Theme, fault: Fault | None) -> list[Provider]:
    """Faults always route to the mock, and only when enabled; nothing else can reach it per request."""
    if fault and settings.allow_faults:
        return [MockProvider(fault, theme.example)]
    if settings.llm_provider == "mock":
        return [MockProvider(Fault.OK, theme.example)]
    return providers
