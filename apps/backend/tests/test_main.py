from collections.abc import AsyncIterator, Generator
from contextlib import asynccontextmanager
import json
from pathlib import Path
import sqlite3
from typing import Any
from unittest.mock import MagicMock, patch

import anthropic
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.persistence import ChatStore


def consume_sse_chat(
    client: TestClient, conversation_id: str, message: str
) -> tuple[int, dict[str, Any]]:
    """POST /chat, consume the SSE stream, and return (status_code, body_dict).

    body_dict mirrors the old JSON shape: {conversation, messages, reply}.
    On non-200 or error events the dict may be partial; callers should check
    status_code first.
    """
    resp = client.post(
        "/chat",
        json={"conversation_id": conversation_id, "message": message},
        headers={"Accept": "text/event-stream"},
    )
    if resp.status_code != 200:
        # Error raised before streaming (404, 400, 500) — return as-is.
        try:
            return resp.status_code, resp.json()
        except Exception:
            return resp.status_code, {}

    tokens: list[str] = []
    for line in resp.text.splitlines():
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            break
        if data.startswith("[ERROR]"):
            return 500, {"detail": data[7:].strip()}
        tokens.append(json.loads(data))

    assistant_content = "".join(tokens)

    conv_resp = client.get(f"/conversations/{conversation_id}")
    assert conv_resp.status_code == 200
    conv_body = conv_resp.json()
    messages = conv_body["messages"]
    reply = next((m for m in reversed(messages) if m["role"] == "assistant"), None)
    return 200, {
        "conversation": conv_body["conversation"],
        "messages": messages,
        "reply": reply or {"role": "assistant", "content": assistant_content},
    }


@pytest.fixture()
def client() -> Generator[TestClient]:
    previous_store = app.state.store

    test_store = ChatStore(":memory:")
    test_store.create_all()
    app.state.store = test_store
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        test_store.close()
        app.state.store = previous_store


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


def test_rename_conversation_trims_and_persists_title(client: TestClient) -> None:
    created = client.post("/conversations", json={"title": "Original title"}).json()
    conversation_id = created["conversation"]["id"]

    renamed = client.patch(
        f"/conversations/{conversation_id}", json={"title": "  Renamed chat  "}
    )

    assert renamed.status_code == 200
    body = renamed.json()
    assert body["conversation"]["id"] == conversation_id
    assert body["conversation"]["title"] == "Renamed chat"
    assert body["conversation"]["created_at"] == created["conversation"]["created_at"]
    assert body["conversation"]["updated_at"] >= created["conversation"]["updated_at"]
    assert body["messages"] == []

    fetched = client.get(f"/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.json() == body

    listed = client.get("/conversations")
    assert listed.status_code == 200
    assert listed.json()["conversations"] == [body["conversation"]]


def test_rename_conversation_rejects_blank_title(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]

    resp = client.patch(
        f"/conversations/{conversation_id}", json={"title": "   \n\t  "}
    )

    assert resp.status_code == 400
    assert resp.json() == {"detail": "Conversation title must not be blank."}

    fetched = client.get(f"/conversations/{conversation_id}")
    assert fetched.status_code == 200
    assert fetched.json()["conversation"]["title"] == "New chat"


def test_rename_missing_conversation_returns_404(client: TestClient) -> None:
    resp = client.patch("/conversations/missing", json={"title": "Renamed chat"})

    assert resp.status_code == 404
    assert resp.json() == {"detail": "Conversation not found."}


def test_delete_conversation_cascades_messages(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]
    status_code, body = consume_sse_chat(client, conversation_id, "hello")
    assert status_code == 200
    assert len(body["messages"]) == 2

    deleted = client.delete(f"/conversations/{conversation_id}")
    assert deleted.status_code == 204
    assert deleted.content == b""

    missing = client.get(f"/conversations/{conversation_id}")
    assert missing.status_code == 404
    assert missing.json() == {"detail": "Conversation not found."}


def test_chat_persists_user_message_and_assistant_reply(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]

    status_code, body = consume_sse_chat(client, conversation_id, "hello")

    assert status_code == 200
    assert body["conversation"]["id"] == conversation_id
    assert body["conversation"]["title"] == "hello"
    assert body["reply"]["role"] == "assistant"
    assert isinstance(body["reply"]["content"], str)
    assert len(body["reply"]["content"]) > 0
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

    status_code, body = consume_sse_chat(client, conversation_id, "hello")

    assert status_code == 200
    assert body["conversation"]["title"] == "Pinned title"


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


def test_list_conversations_search_matches_title(client: TestClient) -> None:
    first = client.post("/conversations", json={"title": "Project notes"}).json()[
        "conversation"
    ]
    client.post("/conversations", json={"title": "Grocery list"})

    listed = client.get("/conversations?q=Project")

    assert listed.status_code == 200
    assert listed.json()["conversations"] == [first]


def test_list_conversations_search_matches_message_content(client: TestClient) -> None:
    matching = client.post("/conversations", json={"title": "Planning"}).json()[
        "conversation"
    ]
    other = client.post("/conversations", json={"title": "Archived"}).json()[
        "conversation"
    ]
    client.post(
        "/chat",
        json={"conversation_id": matching["id"], "message": "discuss launch timing"},
    )
    client.post(
        "/chat",
        json={"conversation_id": other["id"], "message": "unrelated notes"},
    )

    listed = client.get("/conversations?q=launch")

    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["conversations"]] == [matching["id"]]


def test_list_conversations_search_is_case_insensitive(client: TestClient) -> None:
    created = client.post("/conversations", json={"title": "Release Notes"}).json()[
        "conversation"
    ]

    listed = client.get("/conversations?q=release")

    assert listed.status_code == 200
    assert listed.json()["conversations"] == [created]


def test_list_conversations_search_no_match_returns_empty_list(
    client: TestClient,
) -> None:
    client.post("/conversations", json={"title": "Project notes"})

    listed = client.get("/conversations?q=missing")

    assert listed.status_code == 200
    assert listed.json() == {"conversations": []}


def test_list_conversations_search_returns_unique_updated_order(
    client: TestClient,
) -> None:
    first = client.post("/conversations", json={"title": "First"}).json()[
        "conversation"
    ]
    second = client.post("/conversations", json={"title": "Second"}).json()[
        "conversation"
    ]
    client.post(
        "/chat",
        json={"conversation_id": second["id"], "message": "shared marker"},
    )
    client.post(
        "/chat",
        json={"conversation_id": first["id"], "message": "shared marker one"},
    )
    client.post(
        "/chat",
        json={"conversation_id": first["id"], "message": "shared marker two"},
    )

    listed = client.get("/conversations?q=shared")

    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()["conversations"]] == [
        first["id"],
        second["id"],
    ]


def test_list_conversations_blank_search_preserves_unfiltered_behavior(
    client: TestClient,
) -> None:
    first = client.post("/conversations", json={"title": "First"}).json()[
        "conversation"
    ]
    second = client.post("/conversations", json={"title": "Second"}).json()[
        "conversation"
    ]

    unfiltered = client.get("/conversations")
    blank = client.get("/conversations?q=%20%20%20")

    assert unfiltered.status_code == 200
    assert blank.status_code == 200
    assert unfiltered.json()["conversations"] == [second, first]
    assert blank.json() == unfiltered.json()


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


def _make_error_stream(exc: Exception) -> MagicMock:
    """Return a mock _async_anthropic_client that raises exc when streaming."""

    @asynccontextmanager
    async def fake_stream(*args: object, **kwargs: object) -> AsyncIterator[MagicMock]:
        async def _raise() -> AsyncIterator[str]:
            raise exc
            yield  # make it an async generator

        mock_stream = MagicMock()
        mock_stream.text_stream = _raise()
        yield mock_stream

    mock_messages = MagicMock()
    mock_messages.stream = fake_stream
    mock_client = MagicMock()
    mock_client.messages = mock_messages
    return mock_client


def _sse_error_text(client: TestClient, conversation_id: str, message: str) -> str:
    """Send a chat and return the [ERROR] message text from the SSE stream."""
    resp = client.post(
        "/chat",
        json={"conversation_id": conversation_id, "message": message},
    )
    assert resp.status_code == 200
    for line in resp.text.splitlines():
        if line.startswith("data: [ERROR]"):
            return line[len("data: [ERROR]") :].strip()
    return ""


def test_chat_emits_error_event_on_rate_limit(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]
    exc = anthropic.APIStatusError(
        "rate limited",
        response=MagicMock(status_code=429),
        body={},
    )
    with patch("backend.main._async_anthropic_client", _make_error_stream(exc)):
        error_text = _sse_error_text(client, conversation_id, "hello")
    assert "rate limit" in error_text.lower()


def test_chat_emits_error_event_on_server_error(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]
    exc = anthropic.APIStatusError(
        "server error",
        response=MagicMock(status_code=500),
        body={},
    )
    with patch("backend.main._async_anthropic_client", _make_error_stream(exc)):
        error_text = _sse_error_text(client, conversation_id, "hello")
    assert "unavailable" in error_text.lower()


def test_chat_emits_error_event_on_connection_error(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]
    exc = anthropic.APIConnectionError(request=MagicMock())
    with patch("backend.main._async_anthropic_client", _make_error_stream(exc)):
        error_text = _sse_error_text(client, conversation_id, "hello")
    assert "connection" in error_text.lower()


def test_chat_returns_500_when_api_key_missing(client: TestClient) -> None:
    conversation_id = client.post("/conversations").json()["conversation"]["id"]
    with patch("backend.main._async_anthropic_client", None):
        resp = client.post(
            "/chat",
            json={"conversation_id": conversation_id, "message": "hello"},
        )
    assert resp.status_code == 500
    assert "ANTHROPIC_API_KEY" in resp.json()["detail"]


def test_tests_do_not_create_runtime_database(client: TestClient) -> None:
    assert app.state.store.db_path == ":memory:"
    assert not Path("data/chat.db").exists()


def test_persistent_conversation_flow_uses_embedded_sqlite(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "persistent-chat.db"
    previous_store = app.state.store
    persistent_store = ChatStore(db_path)
    persistent_store.create_all()
    app.state.store = persistent_store

    try:
        with TestClient(app) as first_session:
            created = first_session.post("/conversations")
            assert created.status_code == 201
            first_conversation_id = created.json()["conversation"]["id"]

            first_status, _ = consume_sse_chat(
                first_session, first_conversation_id, "first durable turn"
            )
            second_status, second_body = consume_sse_chat(
                first_session, first_conversation_id, "second durable turn"
            )

            assert first_status == 200
            assert second_status == 200
            second_messages = second_body["messages"]
            assert len(second_messages) == 4
            assert second_messages[0]["content"] == "first durable turn"
            assert second_messages[0]["role"] == "user"
            assert second_messages[1]["role"] == "assistant"
            assert len(second_messages[1]["content"]) > 0
            assert second_messages[2]["content"] == "second durable turn"
            assert second_messages[2]["role"] == "user"
            assert second_messages[3]["role"] == "assistant"
            assert len(second_messages[3]["content"]) > 0

        assert db_path.exists()
        with sqlite3.connect(db_path) as conn:
            assert conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'messages'"
            ).fetchone()

        with TestClient(app) as reloaded_session:
            reloaded = reloaded_session.get(f"/conversations/{first_conversation_id}")
            assert reloaded.status_code == 200
            reloaded_messages = reloaded.json()["messages"]
            assert len(reloaded_messages) == 4
            assert reloaded_messages[0]["content"] == "first durable turn"
            assert reloaded_messages[2]["content"] == "second durable turn"

            second_chat = reloaded_session.post(
                "/conversations", json={"title": "Second persisted chat"}
            )
            assert second_chat.status_code == 201
            second_conversation_id = second_chat.json()["conversation"]["id"]
            second_chat_turn_status, _ = consume_sse_chat(
                reloaded_session, second_conversation_id, "separate thread"
            )
            assert second_chat_turn_status == 200

            first_chat_again = reloaded_session.get(
                f"/conversations/{first_conversation_id}"
            )
            second_chat_again = reloaded_session.get(
                f"/conversations/{second_conversation_id}"
            )

            assert len(first_chat_again.json()["messages"]) == 4
            assert (
                first_chat_again.json()["messages"][0]["content"]
                == "first durable turn"
            )
            assert (
                first_chat_again.json()["messages"][2]["content"]
                == "second durable turn"
            )
            second_chat_messages = second_chat_again.json()["messages"]
            assert len(second_chat_messages) == 2
            assert second_chat_messages[0]["content"] == "separate thread"
            assert second_chat_messages[0]["role"] == "user"
            assert second_chat_messages[1]["role"] == "assistant"

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
        persistent_store.close()
        app.state.store = previous_store
