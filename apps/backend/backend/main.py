from collections.abc import AsyncIterator, Generator
from contextlib import asynccontextmanager, contextmanager
from datetime import UTC, datetime
import json
import logging
import os
from pathlib import Path
import sqlite3
from typing import Literal
from uuid import uuid4

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

_ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
if not _ANTHROPIC_API_KEY:
    logger.error(
        "ANTHROPIC_API_KEY environment variable is not set. "
        "The /chat endpoint will return HTTP 500 until it is provided."
    )

_anthropic_client: anthropic.Anthropic | None = (
    anthropic.Anthropic(api_key=_ANTHROPIC_API_KEY) if _ANTHROPIC_API_KEY else None
)
_async_anthropic_client: anthropic.AsyncAnthropic | None = (
    anthropic.AsyncAnthropic(api_key=_ANTHROPIC_API_KEY) if _ANTHROPIC_API_KEY else None
)

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


@app.post("/chat")
async def chat(
    request: ChatRequest, db_path: str = Depends(get_db_path)
) -> StreamingResponse:
    content = request.message.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message must not be blank.")

    if _async_anthropic_client is None:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not configured. Unable to process chat messages.",
        )

    with open_db(db_path) as conn:
        conversation = get_conversation_or_404(conn, request.conversation_id)
        prior_messages = list_messages(conn, conversation.id)

    now = utc_now()
    user_msg_id = str(uuid4())
    api_messages: list[anthropic.types.MessageParam] = [
        {"role": msg.role, "content": msg.content} for msg in prior_messages
    ]
    api_messages.append({"role": "user", "content": content})

    async def stream_tokens() -> AsyncIterator[str]:
        chunks: list[str] = []
        try:
            async with _async_anthropic_client.messages.stream(
                model="claude-sonnet-4-6",
                max_tokens=8096,
                messages=api_messages,
            ) as stream:
                async for text in stream.text_stream:
                    chunks.append(text)
                    yield f"data: {json.dumps(text)}\n\n"
        except anthropic.APIStatusError as exc:
            if exc.status_code == 429:
                error_msg = "Rate limit exceeded — please retry shortly"
            elif exc.status_code >= 500:
                error_msg = "AI service unavailable"
            else:
                error_msg = f"AI request failed ({exc.status_code})"
            yield f"data: [ERROR] {error_msg}\n\n"
            return
        except anthropic.APIConnectionError:
            yield "data: [ERROR] Connection to AI service failed\n\n"
            return
        except Exception as exc:
            yield f"data: [ERROR] {exc}\n\n"
            return

        assistant_content = "".join(chunks)
        assistant_msg_id = str(uuid4())
        assistant_created_at = utc_now()
        title = (
            title_from_message(content)
            if conversation.title == DEFAULT_TITLE
            else conversation.title
        )
        with open_db(db_path) as conn:
            conn.executemany(
                """
                INSERT INTO messages (id, conversation_id, role, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (user_msg_id, conversation.id, "user", content, now),
                    (
                        assistant_msg_id,
                        conversation.id,
                        "assistant",
                        assistant_content,
                        assistant_created_at,
                    ),
                ],
            )
            conn.execute(
                "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
                (title, assistant_created_at, conversation.id),
            )

        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_tokens(), media_type="text/event-stream")
