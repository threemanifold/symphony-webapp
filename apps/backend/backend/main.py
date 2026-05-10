from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="symphony-webapp backend")


ChatRole = Literal["user", "assistant", "system"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    response: str
    message: ChatMessage


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    latest_user_message = next(
        (
            message
            for message in reversed(request.messages)
            if message.role == "user" and message.content.strip()
        ),
        None,
    )
    if latest_user_message is None:
        raise HTTPException(
            status_code=400,
            detail="Chat history must include a non-empty latest user message.",
        )

    assistant_content = f"{latest_user_message.content}, this is symphony"
    return ChatResponse(
        response=assistant_content,
        message=ChatMessage(role="assistant", content=assistant_content),
    )
