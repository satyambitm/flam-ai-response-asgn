from functools import lru_cache
from typing import Literal

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ProviderName = Literal["gemini", "groq", "openai", "mock"]


class Settings(BaseSettings):
    # backend/.env wins over the repo-root .env; real env vars win over both.
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    llm_provider: ProviderName = "mock"
    llm_fallback: ProviderName | None = None

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    groq_api_key: SecretStr | None = None
    groq_model: str = "openai/gpt-oss-120b"
    openai_api_key: SecretStr | None = None
    openai_model: str = "gpt-5.4-mini"

    cors_origins: str = "http://localhost:5173"
    allow_faults: bool = False
    rate_limit_per_min: int = 10
    total_timeout_s: float = 40
    provider_timeout_s: float = 25
    log_level: str = "INFO"

    @field_validator("llm_fallback", mode="before")
    @classmethod
    def _blank_is_none(cls, v: object) -> object:
        return v or None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
