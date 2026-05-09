from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_hello() -> None:
    resp = client.get("/hello/world")
    assert resp.status_code == 200
    assert resp.json() == {"message": "Hello, world!"}
