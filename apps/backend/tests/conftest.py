from collections.abc import Generator
from unittest.mock import MagicMock, patch

import pytest


@pytest.fixture(autouse=True)
def mock_anthropic_client() -> Generator[MagicMock, None, None]:
    mock_text = MagicMock()
    mock_text.text = "mocked assistant reply"
    mock_response = MagicMock()
    mock_response.content = [mock_text]
    mock_client = MagicMock()
    mock_client.messages.create.return_value = mock_response

    with patch("backend.main._anthropic_client", mock_client):
        yield mock_client
