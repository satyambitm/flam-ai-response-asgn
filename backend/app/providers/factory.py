import logging
from dataclasses import dataclass

from app.api.schemas import ProviderOption
from app.config import ProviderName, Settings
from app.core.errors import AppError, ErrorKind
from app.providers.base import Provider
from app.providers.gemini import GeminiProvider
from app.providers.groq import GroqProvider
from app.providers.mock import Fault, MockProvider
from app.providers.openai import OpenAIProvider
from app.themes.base import Theme

log = logging.getLogger("app.providers")

_ADAPTERS = {"gemini": GeminiProvider, "groq": GroqProvider, "openai": OpenAIProvider}
TITLES: dict[ProviderName, str] = {"gemini": "Gemini", "groq": "Groq", "openai": "OpenAI", "mock": "Mock"}


@dataclass(frozen=True)
class Providers:
    chain: list[Provider]  # LLM_PROVIDER then LLM_FALLBACK: used when a request names no provider
    available: dict[str, Provider]  # every provider with a key, chain order first; selectable per request


def build_providers(settings: Settings) -> Providers:
    """Built once at startup so SDK clients are reused.

    A missing primary key is a startup error; a missing fallback key just disables the fallback.
    Any other provider whose key is set is built too, so a request can pick it.
    """
    if settings.llm_provider == "mock":
        return Providers(chain=[], available={})
    primary = _build(settings, settings.llm_provider)
    if primary is None:
        raise RuntimeError(
            f"LLM_PROVIDER={settings.llm_provider} but {settings.llm_provider.upper()}_API_KEY is not set"
        )
    chain = [primary]
    fallback = settings.llm_fallback
    if fallback and fallback not in ("mock", settings.llm_provider):
        if p := _build(settings, fallback):
            chain.append(p)
        else:
            log.warning("fallback %s disabled: %s_API_KEY is not set", fallback, fallback.upper())
    available = {p.name: p for p in chain}
    for name in _ADAPTERS:
        if name not in available and (p := _build(settings, name)):
            available[name] = p
    return Providers(chain=chain, available=available)


def _build(settings: Settings, name: ProviderName) -> Provider | None:
    key = getattr(settings, f"{name}_api_key")
    if key is None or not key.get_secret_value():
        return None
    return _ADAPTERS[name](key.get_secret_value(), getattr(settings, f"{name}_model"))


def options(settings: Settings, providers: Providers) -> list[ProviderOption]:
    """What GET /providers lists: the configured providers (the mock alone in mock mode), default first."""
    pairs = (
        [("mock", MockProvider(Fault.OK, {}).model)]
        if settings.llm_provider == "mock"
        else [(p.name, p.model) for p in providers.available.values()]
    )
    return [ProviderOption(id=n, title=TITLES[n], model=m) for n, m in pairs]


def chain_for(
    settings: Settings, providers: Providers, theme: Theme, fault: Fault | None, provider: ProviderName | None
) -> list[Provider]:
    """Faults always route to the mock, and only when enabled; nothing else can reach it per request.

    A chosen provider goes first and the configured chain stays behind it as fallback.
    """
    if fault and settings.allow_faults:
        return [MockProvider(fault, theme.example)]
    if settings.llm_provider == "mock":
        if provider not in (None, "mock"):
            raise _unavailable(provider)
        return [MockProvider(Fault.OK, theme.example)]
    if provider is None:
        return providers.chain
    chosen = providers.available.get(provider)
    if chosen is None:
        raise _unavailable(provider)
    return [chosen, *(p for p in providers.chain if p is not chosen)]


def _unavailable(provider: str) -> AppError:
    return AppError(ErrorKind.INPUT, f"The {TITLES.get(provider, provider)} provider isn't available on this server.")
