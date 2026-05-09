from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="symphony-webapp backend")


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    return ChatResponse(response=f"{request.message}, this is symphony")
