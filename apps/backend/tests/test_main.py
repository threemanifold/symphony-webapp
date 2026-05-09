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


def test_chat_normal_input() -> None:
    resp = client.post("/chat", json={"message": "hello"})
    assert resp.status_code == 200
    assert resp.json() == {"response": "hello, this is symphony"}


def test_chat_empty_string() -> None:
    resp = client.post("/chat", json={"message": ""})
    assert resp.status_code == 200
    assert resp.json() == {"response": ", this is symphony"}


def test_chat_very_long_string() -> None:
    message = "symphony" * 10_000

    resp = client.post("/chat", json={"message": message})

    assert resp.status_code == 200
    assert resp.json() == {"response": f"{message}, this is symphony"}
