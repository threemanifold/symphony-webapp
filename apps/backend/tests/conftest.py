from collections.abc import AsyncIterator, Generator
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

import pytest


async def _async_text_iter(tokens: list[str]) -> AsyncIterator[str]:
    for token in tokens:
        yield token


@pytest.fixture(autouse=True)
def mock_anthropic_client() -> Generator[MagicMock, None, None]:
    @asynccontextmanager
    async def fake_stream(*args: object, **kwargs: object) -> AsyncIterator[MagicMock]:
        mock_stream = MagicMock()
        mock_stream.text_stream = _async_text_iter(["mocked ", "assistant ", "reply"])
        yield mock_stream

    mock_messages = MagicMock()
    mock_messages.stream = fake_stream

    mock_client = MagicMock()
    mock_client.messages = mock_messages

    with patch("backend.main._async_anthropic_client", mock_client):
        yield mock_client
