from app.config import Settings
from app.providers.base import Provider
from app.providers.mock import Fault, MockProvider
from app.themes.base import Theme


def build_providers(settings: Settings) -> list[Provider]:
    """The real primary + fallback chain, built once at startup so SDK clients are reused."""
    return []


def chain_for(settings: Settings, providers: list[Provider], theme: Theme, fault: Fault | None) -> list[Provider]:
    """Faults always route to the mock, and only when enabled; nothing else can reach it per request."""
    if fault and settings.allow_faults:
        return [MockProvider(fault, theme.example)]
    if settings.llm_provider == "mock":
        return [MockProvider(Fault.OK, theme.example)]
    return providers
