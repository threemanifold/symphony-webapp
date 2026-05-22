"""SQLite persistence for conversations and chat messages.

This module owns the chat database schema, connection lifecycle, row
mapping, and the higher-level queries used by the FastAPI routes in
``backend.main``. Route handlers should orchestrate request/response
shapes only and call into :class:`ChatStore` for any persistence.
"""

from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
import sqlite3
from typing import Literal

from pydantic import BaseModel

ChatRole = Literal["user", "assistant"]


class ConversationSummary(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str


class Message(BaseModel):
    id: str
    conversation_id: str
    role: ChatRole
    content: str
    created_at: str


_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id)
        REFERENCES conversations(id)
        ON DELETE CASCADE
);
"""


def _row_to_conversation(row: sqlite3.Row) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _row_to_message(row: sqlite3.Row) -> Message:
    return Message(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
    )


class ChatStore:
    """SQLite-backed store for conversations and messages.

    For a ``":memory:"`` database the store keeps a single long-lived
    connection so the schema and data persist across requests inside a
    test. For file-backed databases each operation opens a fresh
    connection, matching the previous behavior of the backend module.
    """

    def __init__(self, db_path: str | Path) -> None:
        self._db_path = str(db_path)
        self._memory_connection: sqlite3.Connection | None = None

    @property
    def db_path(self) -> str:
        return self._db_path

    def close(self) -> None:
        """Close any retained in-memory connection."""
        if self._memory_connection is not None:
            self._memory_connection.close()
            self._memory_connection = None

    def _memory_conn(self) -> sqlite3.Connection:
        if self._memory_connection is None:
            conn = sqlite3.connect(":memory:", check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            self._memory_connection = conn
        return self._memory_connection

    def create_all(self) -> None:
        """Create the conversations/messages tables if they do not exist."""
        if self._db_path != ":memory:":
            Path(self._db_path).parent.mkdir(parents=True, exist_ok=True)

        conn = (
            self._memory_conn()
            if self._db_path == ":memory:"
            else sqlite3.connect(self._db_path)
        )
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.executescript(_SCHEMA)
            conn.commit()
        finally:
            if self._db_path != ":memory:":
                conn.close()

    @contextmanager
    def _connection(self) -> Generator[sqlite3.Connection]:
        conn = (
            self._memory_conn()
            if self._db_path == ":memory:"
            else sqlite3.connect(self._db_path)
        )
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        finally:
            if self._db_path != ":memory:":
                conn.close()

    def list_conversations(self, query: str = "") -> list[ConversationSummary]:
        normalized = query.strip().lower()
        with self._connection() as conn:
            if normalized:
                rows = conn.execute(
                    """
                    SELECT id, title, created_at, updated_at
                    FROM conversations
                    WHERE instr(lower(title), ?) > 0
                        OR EXISTS (
                            SELECT 1
                            FROM messages
                            WHERE messages.conversation_id = conversations.id
                                AND instr(lower(content), ?) > 0
                        )
                    ORDER BY updated_at DESC
                    """,
                    (normalized, normalized),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, title, created_at, updated_at
                    FROM conversations
                    ORDER BY updated_at DESC
                    """
                ).fetchall()
        return [_row_to_conversation(row) for row in rows]

    def get_conversation(self, conversation_id: str) -> ConversationSummary | None:
        with self._connection() as conn:
            row = conn.execute(
                """
                SELECT id, title, created_at, updated_at
                FROM conversations
                WHERE id = ?
                """,
                (conversation_id,),
            ).fetchone()
        return _row_to_conversation(row) if row is not None else None

    def list_messages(self, conversation_id: str) -> list[Message]:
        with self._connection() as conn:
            rows = conn.execute(
                """
                SELECT id, conversation_id, role, content, created_at
                FROM messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC
                """,
                (conversation_id,),
            ).fetchall()
        return [_row_to_message(row) for row in rows]

    def insert_conversation(self, conversation: ConversationSummary) -> None:
        with self._connection() as conn:
            conn.execute(
                """
                INSERT INTO conversations (id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    conversation.id,
                    conversation.title,
                    conversation.created_at,
                    conversation.updated_at,
                ),
            )

    def rename_conversation(
        self, conversation_id: str, title: str, updated_at: str
    ) -> ConversationSummary | None:
        """Rename a conversation and return its refreshed summary.

        Returns ``None`` when the conversation does not exist.
        """
        with self._connection() as conn:
            existing = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
            if existing is None:
                return None
            conn.execute(
                """
                UPDATE conversations
                SET title = ?, updated_at = ?
                WHERE id = ?
                """,
                (title, updated_at, conversation_id),
            )
            refreshed = conn.execute(
                """
                SELECT id, title, created_at, updated_at
                FROM conversations
                WHERE id = ?
                """,
                (conversation_id,),
            ).fetchone()
        return _row_to_conversation(refreshed)

    def delete_conversation(self, conversation_id: str) -> bool:
        """Delete a conversation. Returns ``False`` if it did not exist."""
        with self._connection() as conn:
            existing = conn.execute(
                "SELECT id FROM conversations WHERE id = ?", (conversation_id,)
            ).fetchone()
            if existing is None:
                return False
            conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
        return True

    def append_chat_turn(
        self,
        conversation_id: str,
        user_message: Message,
        assistant_message: Message,
        title: str,
    ) -> None:
        """Atomically append a user/assistant message pair and bump the conversation."""
        with self._connection() as conn:
            conn.executemany(
                """
                INSERT INTO messages (id, conversation_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        user_message.id,
                        user_message.conversation_id,
                        user_message.role,
                        user_message.content,
                        user_message.created_at,
                    ),
                    (
                        assistant_message.id,
                        assistant_message.conversation_id,
                        assistant_message.role,
                        assistant_message.content,
                        assistant_message.created_at,
                    ),
                ],
            )
            conn.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title, assistant_message.created_at, conversation_id),
            )
