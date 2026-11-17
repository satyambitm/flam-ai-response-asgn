import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_settings(**overrides) -> Settings:
    base = {"llm_provider": "mock", "allow_faults": True, "rate_limit_per_min": 1000}
    return Settings(_env_file=None, **(base | overrides))


@pytest.fixture
def make_client():
    def _make(**overrides) -> TestClient:
        return TestClient(create_app(make_settings(**overrides)), raise_server_exceptions=False)

    return _make


@pytest.fixture
def client(make_client) -> TestClient:
    return make_client()
