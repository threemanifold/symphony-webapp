from collections.abc import Generator
from pathlib import Path
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.main import app, create_all


@pytest.fixture()
def client() -> Generator[TestClient]:
    previous_db_path = app.state.db_path
    previous_memory_connection = getattr(app.state, "memory_connection", None)
    if previous_memory_connection is not None:
        previous_memory_connection.close()
        delattr(app.state, "memory_connection")

    app.state.db_path = ":memory:"
    create_all(":memory:")
    with TestClient(app) as test_client:
        yield test_client

    memory_connection = getattr(app.state, "memory_connection", None)
    if memory_connection is not None:
        memory_connection.close()
        delattr(app.state, "memory_connection")
    app.state.db_path = previous_db_path


def assert_summary(conversation: dict[str, str], title: str) -> None:
    assert conversation["id"]
    assert conversation["title"] == title
    assert conversation["created_at"]
    assert conversation["updated_at"]


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_root_does_not_serve_static_chat_page(client: TestClient) -> None:
    resp = client.get("/")
    assert resp.status_code == 404


def test_create_list_and_get_conversation(client: TestClient) -> None:
    created = client.post("/conversations", json={"title": "Project notes"})

    assert created.status_code == 201
    created_body = created.json()
    assert_summary(created_body["conversation"], "Project notes")
    assert created_body["messages"] == []

    conversation_id = created_body["conversation"]["id"]
    fetched = client.get(f"/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.json() == created_body

    listed = client.get("/conversations")
    assert listed.status_code == 200
    assert listed.json()["conversations"] == [created_body["conversation"]]


def test_create_conversation_defaults_blank_title(client: TestClient) -> None:
    resp = client.post("/conversations", json={"title": "   "})

    assert resp.status_code == 201
    assert_summary(resp.json()["conversation"], "New chat")


def test_delete_conversation_cascades_messages(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]
    chat = client.post(
        "/chat", json={"conversation_id": conversation_id, "message": "hello"}
    )
    assert chat.status_code == 200
    assert len(chat.json()["messages"]) == 2

    deleted = client.delete(f"/conversations/{conversation_id}")
    assert deleted.status_code == 204
    assert deleted.content == b""

    missing = client.get(f"/conversations/{conversation_id}")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Conversation not found."}


def test_chat_persists_user_message_and_echo_reply(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]

    resp = client.post(
        "/chat",
        json={"conversation_id": conversation_id, "message": "hello"},
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["conversation"]["id"] == conversation_id
    assert body["conversation"]["title"] == "hello"
    assert body["reply"]["role"] == "assistant"
    assert body["reply"]["content"] == "hello, this is symphony"
    assert body["messages"] == [
        {
            "id": body["messages"][0]["id"],
            "conversation_id": conversation_id,
            "role": "user",
            "content": "hello",
            "created_at": body["messages"][0]["created_at"],
        },
        body["reply"],
    ]

    fetched = client.get(f"/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.json()["messages"] == body["messages"]


def test_chat_preserves_custom_title(client: TestClient) -> None:
    conversation_id = client.post(
        "/conversations", json={"title": "Pinned title"}
    ).json()["conversation"]["id"]

    resp = client.post(
        "/chat",
        json={"conversation_id": conversation_id, "message": "hello"},
    )

    assert resp.status_code == 200
    assert resp.json()["conversation"]["title"] == "Pinned title"


def test_chat_moves_conversation_to_top_of_list(client: TestClient) -> None:
    first = client.post("/conversations", json={"title": "First"}).json()[
        "conversation"
    ]["id"]
    second = client.post("/conversations", json={"title": "Second"}).json()[
        "conversation"
    ]["id"]

    resp = client.post("/chat", json={"conversation_id": first, "message": "again"})
    assert resp.status_code == 200

    listed = client.get("/conversations")
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["conversations"]] == [first, second]


def test_missing_conversation_returns_404(client: TestClient) -> None:
    get_resp = client.get("/conversations/missing")
    delete_resp = client.delete("/conversations/missing")
    chat_resp = client.post(
        "/chat", json={"conversation_id": "missing", "message": "hello"}
    )

    assert get_resp.status_code == 404
    assert delete_resp.status_code == 404
    assert chat_resp.status_code == 404
    assert chat_resp.json() == {"detail": "Conversation not found."}


def test_chat_rejects_blank_message(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]

    resp = client.post(
        "/chat", json={"conversation_id": conversation_id, "message": "   "}
    )

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Message must not be blank."}


def test_tests_do_not_create_runtime_database(client: TestClient) -> None:
    assert app.state.db_path == ":memory:"
    assert not Path("data/chat.db").exists()


def test_persistent_conversation_flow_uses_embedded_sqlite(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "persistent-chat.db"
    previous_db_path = app.state.db_path
    app.state.db_path = str(db_path)
    create_all(db_path)

    try:
        with TestClient(app) as first_session:
            created = first_session.post("/conversations")
            assert created.status_code == 201
            first_conversation_id = created.json()["conversation"]["id"]

            first_turn = first_session.post(
                "/chat",
                json={
                    "conversation_id": first_conversation_id,
                    "message": "first durable turn",
                },
            )
            second_turn = first_session.post(
                "/chat",
                json={
                    "conversation_id": first_conversation_id,
                    "message": "second durable turn",
                },
            )

            assert first_turn.status_code == 200
            assert second_turn.status_code == 200
            assert [message["content"] for message in second_turn.json()["messages"]] == [
                "first durable turn",
                "first durable turn, this is symphony",
                "second durable turn",
                "second durable turn, this is symphony",
            ]

        assert db_path.exists()
        with sqlite3.connect(db_path) as conn:
            assert conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'"
            ).fetchone()

        with TestClient(app) as reloaded_session:
            reloaded = reloaded_session.get(
                f"/conversations/{first_conversation_id}"
            )
            assert reloaded.status_code == 200
            assert [message["content"] for message in reloaded.json()["messages"]] == [
                "first durable turn",
                "first durable turn, this is symphony",
                "second durable turn",
                "second durable turn, this is symphony",
            ]

            second_chat = reloaded_session.post(
                "/conversations", json={"title": "Second persisted chat"}
            )
            assert second_chat.status_code == 201
            second_conversation_id = second_chat.json()["conversation"]["id"]
            second_chat_turn = reloaded_session.post(
                "/chat",
                json={
                    "conversation_id": second_conversation_id,
                    "message": "separate thread",
                },
            )
            assert second_chat_turn.status_code == 200

            first_chat_again = reloaded_session.get(
                f"/conversations/{first_conversation_id}"
            )
            second_chat_again = reloaded_session.get(
                f"/conversations/{second_conversation_id}"
            )

            assert [message["content"] for message in first_chat_again.json()["messages"]] == [
                "first durable turn",
                "first durable turn, this is symphony",
                "second durable turn",
                "second durable turn, this is symphony",
            ]
            assert [message["content"] for message in second_chat_again.json()["messages"]] == [
                "separate thread",
                "separate thread, this is symphony",
            ]

            deleted = reloaded_session.delete(
                f"/conversations/{second_conversation_id}"
            )
            assert deleted.status_code == 204
            listed = reloaded_session.get("/conversations")
            assert listed.status_code == 200
            assert [item["id"] for item in listed.json()["conversations"]] == [
                first_conversation_id
            ]
    finally:
        app.state.db_path = previous_db_path
