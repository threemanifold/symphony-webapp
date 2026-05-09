from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="symphony-webapp backend")


class Greeting(BaseModel):
    message: str


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    response: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/hello/{name}", response_model=Greeting)
def hello(name: str) -> Greeting:
    return Greeting(message=f"Hello, {name}!")


@app.post("/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    return ChatResponse(response=f"{request.message}, this is symphony")
