from fastapi import APIRouter


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_unknown_route_is_enveloped(client):
    r = client.get("/nope")
    assert r.status_code == 404
    assert r.json()["ok"] is False
    assert r.json()["error"]["kind"] == "input"


def test_unhandled_exception_is_enveloped_with_cors(client):
    boom = APIRouter()

    @boom.get("/boom")
    def _boom():
        raise RuntimeError("secret detail")

    client.app.include_router(boom)
    r = client.get("/boom", headers={"Origin": "http://localhost:5173"})
    assert r.status_code == 500
    body = r.json()
    assert body["error"] == {
        "kind": "internal",
        "message": "Something went wrong on our side.",
        "retryable": True,
        "retryAfter": None,
    }
    assert "secret" not in r.text
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_rejects_unknown_origin(client):
    r = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers
