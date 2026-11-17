import pytest

from app.providers.mock import Fault

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
    assert {"EchoData", "EchoItem", "SuccessEnvelope", "ErrorEnvelope", "GenerateRequest", "Fault"} <= schemas.keys()
