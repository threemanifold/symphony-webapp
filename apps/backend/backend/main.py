from collections.abc import AsyncIterator, Generator
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Response, status
from pydantic import BaseModel, Field

ChatRole = Literal["user", "assistant"]
DEFAULT_TITLE = "New chat"
DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "chat.db"


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI) -> AsyncIterator[None]:
    create_all(fastapi_app.state.db_path)
    yield


app = FastAPI(title="symphony-webapp backend", lifespan=lifespan)
app.state.db_path = str(DEFAULT_DB_PATH)


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


class ConversationDetail(BaseModel):
    conversation: ConversationSummary
    messages: list[Message]


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]


class ConversationCreateRequest(BaseModel):
    title: str | None = None


class ChatRequest(BaseModel):
    conversation_id: str
    message: str = Field(min_length=1)


class ChatResponse(BaseModel):
    conversation: ConversationSummary
    messages: list[Message]
    reply: Message


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def get_memory_connection() -> sqlite3.Connection:
    conn = getattr(app.state, "memory_connection", None)
    if conn is None:
        conn = sqlite3.connect(":memory:", check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        app.state.memory_connection = conn
    return conn


def create_all(db_path: str | Path) -> None:
    path = str(db_path)
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)

    conn = get_memory_connection() if path == ":memory:" else sqlite3.connect(path)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(
            """
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
        )
        conn.commit()
    finally:
        if path != ":memory:":
            conn.close()


def get_db_path() -> str:
    return str(app.state.db_path)


@contextmanager
def open_db(db_path: str) -> Generator[sqlite3.Connection]:
    conn = (
        get_memory_connection() if db_path == ":memory:" else sqlite3.connect(db_path)
    )
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        if db_path != ":memory:":
            conn.close()


def row_to_conversation(row: sqlite3.Row) -> ConversationSummary:
    return ConversationSummary(
        id=row["id"],
        title=row["title"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def row_to_message(row: sqlite3.Row) -> Message:
    return Message(
        id=row["id"],
        conversation_id=row["conversation_id"],
        role=row["role"],
        content=row["content"],
        created_at=row["created_at"],
    )


def normalize_title(title: str | None) -> str:
    if title is None or not title.strip():
        return DEFAULT_TITLE
    return title.strip()


def title_from_message(message: str) -> str:
    title = " ".join(message.strip().split())
    return title[:60] if title else DEFAULT_TITLE


def get_conversation_or_404(
    conn: sqlite3.Connection, conversation_id: str
) -> ConversationSummary:
    row = conn.execute(
        """
        SELECT id, title, created_at, updated_at
        FROM conversations
        WHERE id = ?
        """,
        (conversation_id,),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return row_to_conversation(row)


def list_messages(conn: sqlite3.Connection, conversation_id: str) -> list[Message]:
    rows = conn.execute(
        """
        SELECT id, conversation_id, role, content, created_at
        FROM messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC
        """,
        (conversation_id,),
    ).fetchall()
    return [row_to_message(row) for row in rows]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/conversations", response_model=ConversationListResponse)
def list_conversations(
    q: str | None = None, db_path: str = Depends(get_db_path)
) -> ConversationListResponse:
    query = q.strip().lower() if q else ""
    with open_db(db_path) as conn:
        if query:
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
                (query, query),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, title, created_at, updated_at
                FROM conversations
                ORDER BY updated_at DESC
                """
            ).fetchall()
    return ConversationListResponse(
        conversations=[row_to_conversation(row) for row in rows]
    )


@app.post(
    "/conversations",
    response_model=ConversationDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_conversation(
    request: ConversationCreateRequest | None = None,
    db_path: str = Depends(get_db_path),
) -> ConversationDetail:
    now = utc_now()
    conversation = ConversationSummary(
        id=str(uuid4()),
        title=normalize_title(request.title if request else None),
        created_at=now,
        updated_at=now,
    )
    with open_db(db_path) as conn:
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
    return ConversationDetail(conversation=conversation, messages=[])


@app.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str, db_path: str = Depends(get_db_path)
) -> ConversationDetail:
    with open_db(db_path) as conn:
        conversation = get_conversation_or_404(conn, conversation_id)
        messages = list_messages(conn, conversation_id)
    return ConversationDetail(conversation=conversation, messages=messages)


@app.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: str, db_path: str = Depends(get_db_path)
) -> Response:
    with open_db(db_path) as conn:
        get_conversation_or_404(conn, conversation_id)
        conn.execute("DELETE FROM conversations WHERE id = ?", (conversation_id,))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest, db_path: str = Depends(get_db_path)) -> ChatResponse:
    content = request.message.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message must not be blank.")

    with open_db(db_path) as conn:
        conversation = get_conversation_or_404(conn, request.conversation_id)
        now = utc_now()
        user_message = Message(
            id=str(uuid4()),
            conversation_id=conversation.id,
            role="user",
            content=content,
            created_at=now,
        )
        assistant_content = f"{content}, this is symphony"
        assistant_message = Message(
            id=str(uuid4()),
            conversation_id=conversation.id,
            role="assistant",
            content=assistant_content,
            created_at=utc_now(),
        )
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
        title = (
            title_from_message(content)
            if conversation.title == DEFAULT_TITLE
            else conversation.title
        )
        conn.execute(
            """
            UPDATE conversations
            SET title = ?, updated_at = ?
            WHERE id = ?
            """,
            (title, assistant_message.created_at, conversation.id),
        )
        updated_conversation = get_conversation_or_404(conn, conversation.id)
        messages = list_messages(conn, conversation.id)

    return ChatResponse(
        conversation=updated_conversation,
        messages=messages,
        reply=assistant_message,
    )
