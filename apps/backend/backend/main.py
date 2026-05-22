from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
import json
import logging
import os
from pathlib import Path
from typing import cast
from uuid import uuid4

import anthropic
from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.persistence import (
    ChatRole,
    ChatStore,
    ConversationSummary,
    Message,
)

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

DEFAULT_TITLE = "New chat"
DEFAULT_DB_PATH = Path(__file__).resolve().parents[1] / "data" / "chat.db"

__all__ = [
    "ChatRole",
    "ChatStore",
    "ConversationSummary",
    "Message",
    "app",
]


@asynccontextmanager
async def lifespan(fastapi_app: FastAPI) -> AsyncIterator[None]:
    fastapi_app.state.store.create_all()
    yield


app = FastAPI(title="symphony-webapp backend", lifespan=lifespan)
app.state.store = ChatStore(DEFAULT_DB_PATH)


class ConversationDetail(BaseModel):
    conversation: ConversationSummary
    messages: list[Message]


class ConversationListResponse(BaseModel):
    conversations: list[ConversationSummary]


class ConversationCreateRequest(BaseModel):
    title: str | None = None


class ConversationRenameRequest(BaseModel):
    title: str = Field(min_length=1)


class ChatRequest(BaseModel):
    conversation_id: str
    message: str = Field(min_length=1)


class ChatResponse(BaseModel):
    conversation: ConversationSummary
    messages: list[Message]
    reply: Message


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def get_store() -> ChatStore:
    return cast(ChatStore, app.state.store)


def normalize_title(title: str | None) -> str:
    if title is None or not title.strip():
        return DEFAULT_TITLE
    return title.strip()


def normalize_rename_title(title: str) -> str:
    normalized = title.strip()
    if not normalized:
        raise HTTPException(
            status_code=400, detail="Conversation title must not be blank."
        )
    return normalized


def title_from_message(message: str) -> str:
    title = " ".join(message.strip().split())
    return title[:60] if title else DEFAULT_TITLE


def require_conversation(store: ChatStore, conversation_id: str) -> ConversationSummary:
    conversation = store.get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return conversation


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/conversations", response_model=ConversationListResponse)
def list_conversations(
    q: str | None = None, store: ChatStore = Depends(get_store)
) -> ConversationListResponse:
    return ConversationListResponse(conversations=store.list_conversations(q or ""))


@app.post(
    "/conversations",
    response_model=ConversationDetail,
    status_code=status.HTTP_201_CREATED,
)
def create_conversation(
    request: ConversationCreateRequest | None = None,
    store: ChatStore = Depends(get_store),
) -> ConversationDetail:
    now = utc_now()
    conversation = ConversationSummary(
        id=str(uuid4()),
        title=normalize_title(request.title if request else None),
        created_at=now,
        updated_at=now,
    )
    store.insert_conversation(conversation)
    return ConversationDetail(conversation=conversation, messages=[])


@app.get("/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str, store: ChatStore = Depends(get_store)
) -> ConversationDetail:
    conversation = require_conversation(store, conversation_id)
    messages = store.list_messages(conversation_id)
    return ConversationDetail(conversation=conversation, messages=messages)


@app.patch("/conversations/{conversation_id}", response_model=ConversationDetail)
def rename_conversation(
    conversation_id: str,
    request: ConversationRenameRequest,
    store: ChatStore = Depends(get_store),
) -> ConversationDetail:
    title = normalize_rename_title(request.title)
    updated_at = utc_now()
    updated = store.rename_conversation(conversation_id, title, updated_at)
    if updated is None:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    messages = store.list_messages(conversation_id)
    return ConversationDetail(conversation=updated, messages=messages)


@app.delete("/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(
    conversation_id: str, store: ChatStore = Depends(get_store)
) -> Response:
    if not store.delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/chat")
async def chat(
    request: ChatRequest, store: ChatStore = Depends(get_store)
) -> StreamingResponse:
    content = request.message.strip()
    if not content:
        raise HTTPException(status_code=400, detail="Message must not be blank.")

    if _async_anthropic_client is None:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY is not configured. Unable to process chat messages.",
        )

    conversation = require_conversation(store, request.conversation_id)
    prior_messages = store.list_messages(conversation.id)

    user_created_at = utc_now()
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
        assistant_created_at = utc_now()
        title = (
            title_from_message(content)
            if conversation.title == DEFAULT_TITLE
            else conversation.title
        )

        user_message = Message(
            id=user_msg_id,
            conversation_id=conversation.id,
            role="user",
            content=content,
            created_at=user_created_at,
        )
        assistant_message = Message(
            id=str(uuid4()),
            conversation_id=conversation.id,
            role="assistant",
            content=assistant_content,
            created_at=assistant_created_at,
        )
        store.append_chat_turn(conversation.id, user_message, assistant_message, title)

        yield "data: [DONE]\n\n"

    return StreamingResponse(stream_tokens(), media_type="text/event-stream")
