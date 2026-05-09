from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="symphony-webapp backend")


class Greeting(BaseModel):
    message: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/hello/{name}", response_model=Greeting)
def hello(name: str) -> Greeting:
    return Greeting(message=f"Hello, {name}!")
