from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


def test_health() -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_does_not_serve_static_chat_page() -> None:
    resp = client.get("/")
    assert resp.status_code == 404


def test_chat_single_turn_history() -> None:
    resp = client.post(
        "/chat", json={"messages": [{"role": "user", "content": "hello"}]}
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "response": "hello, this is symphony",
        "message": {"role": "assistant", "content": "hello, this is symphony"},
    }


def test_chat_multi_turn_history_uses_latest_user_message() -> None:
    resp = client.post(
        "/chat",
        json={
            "messages": [
                {"role": "user", "content": "hello"},
                {"role": "assistant", "content": "hello, this is symphony"},
                {"role": "user", "content": "what did I just say?"},
            ]
        },
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "response": "what did I just say?, this is symphony",
        "message": {
            "role": "assistant",
            "content": "what did I just say?, this is symphony",
        },
    }


def test_chat_rejects_no_valid_latest_user_message() -> None:
    resp = client.post(
        "/chat",
        json={
            "messages": [
                {"role": "system", "content": "Be terse."},
                {"role": "assistant", "content": "Ready."},
                {"role": "user", "content": "   "},
            ]
        },
    )

    assert resp.status_code == 400
    assert resp.json() == {
        "detail": "Chat history must include a non-empty latest user message."
    }
