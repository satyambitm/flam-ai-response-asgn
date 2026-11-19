import json

import pytest

from app.providers.base import Completion, ProviderError
from app.providers.factory import Providers
from app.providers.mock import Fault
from app.themes.registry import THEMES

EXPECTED_STATUS = {
    Fault.OK: 200,
    Fault.FENCED: 200,
    Fault.PROSE: 200,
    Fault.BAD_THEN_OK: 200,
    Fault.TRUNCATED: 502,
    Fault.WRONG_SHAPE: 502,
    Fault.EMPTY: 422,
    Fault.ERROR_500: 502,
    Fault.RATE_429: 429,
}


def post(client, fault: Fault | None = None, **body):
    headers = {"X-Fault": fault.value} if fault else {}
    return client.post("/generate", json={"themeId": "echo", "input": "notes"} | body, headers=headers)


@pytest.mark.parametrize(("fault", "status"), EXPECTED_STATUS.items())
def test_every_fault_returns_an_envelope(client, fault, status):
    r = post(client, fault)
    assert r.status_code == status
    body = r.json()
    if status == 200:
        assert body["ok"] is True and body["data"]["items"]
        assert body["meta"]["provider"] == "mock"
    else:
        assert body["ok"] is False and {"kind", "message", "retryable"} <= body["error"].keys()


def test_429_sets_retry_after(client):
    r = post(client, Fault.RATE_429)
    assert r.json()["error"]["retryAfter"] == 7 and r.headers["retry-after"] == "7"


def test_unknown_theme(client):
    r = post(client, themeId="nope")
    assert r.status_code == 422 and r.json()["error"]["kind"] == "input"


@pytest.mark.parametrize(
    "body",
    [{"themeId": "echo"}, {"input": "x"}, {"themeId": "echo", "input": 5}, {"themeId": "echo", "input": "x" * 20_001}],
)
def test_bad_request_body_is_input_envelope(client, body):
    r = client.post("/generate", json=body)
    assert r.status_code == 422
    assert r.json()["error"]["kind"] == "input" and r.json()["error"]["retryable"] is False


def test_non_json_body(client):
    r = client.post("/generate", content="not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["error"]["kind"] == "input"


def test_unknown_fault_is_input_error(client):
    r = client.post("/generate", json={"themeId": "echo", "input": "x"}, headers={"X-Fault": "nope"})
    assert r.status_code == 422 and r.json()["error"]["kind"] == "input"


def test_faults_ignored_when_disabled(make_client):
    r = post(make_client(allow_faults=False), Fault.ERROR_500)
    assert r.status_code == 200 and r.json()["meta"]["model"] == "mock-ok"


def test_rate_limit(make_client):
    client = make_client(rate_limit_per_min=2)
    assert [post(client).status_code for _ in range(3)] == [200, 200, 429]
    err = post(client).json()["error"]
    assert err["kind"] == "rate_limited" and 0 < err["retryAfter"] <= 60


def test_cors_preflight_allows_fault_header(client):
    r = client.options(
        "/generate",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-fault",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_openapi_exposes_theme_and_envelope_schemas(client):
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    expected = {"EchoData", "EchoItem", "SuccessEnvelope", "ErrorEnvelope", "GenerateRequest", "Fault", "ProvidersInfo"}
    assert expected <= schemas.keys()


# --- provider choice, with the SDK adapters swapped for stubs on a real (non-mock) config ---


class Stub:
    def __init__(self, name: str, model: str, *, down: bool = False):
        self.name, self.model, self.down, self.calls = name, model, down, 0

    async def generate(self, **_) -> Completion:
        self.calls += 1
        if self.down:
            raise ProviderError("down", status=503)
        return Completion(json.dumps(THEMES["echo"].example))


KEYS = {"groq_api_key": "sk-groq-secret", "gemini_api_key": "sk-gemini-secret", "openai_api_key": ""}


@pytest.fixture
def real(make_client):
    """groq -> gemini chain; openai has no key, so it isn't selectable."""
    client = make_client(llm_provider="groq", llm_fallback="gemini", **KEYS)
    groq, gemini = Stub("groq", "g-model"), Stub("gemini", "m-model")
    client.app.state.providers = Providers(chain=[groq, gemini], available={"groq": groq, "gemini": gemini})
    return client, groq, gemini


def test_providers_lists_mock_alone_in_mock_mode(client):
    assert client.get("/providers").json() == {
        "default": "mock",
        "options": [{"id": "mock", "title": "Mock", "model": "mock-ok"}],
    }


def test_providers_lists_keyed_providers_and_no_secrets(make_client):
    r = make_client(llm_provider="groq", llm_fallback="gemini", **KEYS).get("/providers")
    body = r.json()
    assert body["default"] == "groq"
    assert [(o["id"], o["title"]) for o in body["options"]] == [("groq", "Groq"), ("gemini", "Gemini")]
    assert "secret" not in r.text


def test_chosen_provider_answers(real):
    client, groq, gemini = real
    r = post(client, providerId="gemini")
    assert r.status_code == 200 and r.json()["meta"]["provider"] == "gemini"
    assert (groq.calls, gemini.calls) == (0, 1)


def test_no_choice_uses_the_default(real):
    client, groq, gemini = real
    assert post(client).json()["meta"]["provider"] == "groq" and gemini.calls == 0


def test_chosen_provider_down_falls_back_to_the_chain(real):
    client, groq, gemini = real
    gemini.down = True
    r = post(client, providerId="gemini")
    assert r.status_code == 200 and r.json()["meta"]["provider"] == "groq"
    assert (gemini.calls, groq.calls) == (1, 1)


@pytest.mark.parametrize(
    ("provider", "message"), [("openai", "OpenAI provider isn't available"), ("nope", "providerId")]
)
def test_unavailable_or_unknown_provider_is_input_error(real, provider, message):
    r = post(real[0], providerId=provider)
    err = r.json()["error"]
    assert r.status_code == 422 and err["kind"] == "input" and message in err["message"]
