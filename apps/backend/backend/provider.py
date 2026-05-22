"""Anthropic provider integration for the backend.

This module owns the Anthropic SDK client lifecycle, provider request
construction, streaming, and the mapping of provider errors to
user-facing messages. FastAPI route handlers in :mod:`backend.main`
should call into the helpers exposed here so that provider or transport
changes stay isolated from the HTTP layer.
"""

from collections.abc import AsyncIterator
from dataclasses import dataclass
import logging
import os

import anthropic

from backend.persistence import Message

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-sonnet-4-6"
DEFAULT_MAX_TOKENS = 8096


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


@dataclass(frozen=True)
class TextDelta:
    """A streamed chunk of assistant text from the provider."""

    text: str


@dataclass(frozen=True)
class ProviderError:
    """A terminal stream event carrying a user-facing error message."""

    user_message: str


StreamEvent = TextDelta | ProviderError


def get_async_client() -> anthropic.AsyncAnthropic | None:
    """Return the module-level async Anthropic client (or ``None`` when unset).

    Tests patch ``backend.provider._async_anthropic_client`` directly to
    swap in fakes; reading through this accessor keeps the lookup late so
    those patches take effect.
    """
    return _async_anthropic_client


def build_provider_messages(
    prior_messages: list[Message], user_content: str
) -> list[anthropic.types.MessageParam]:
    """Build the Anthropic ``messages`` payload from history + the new turn."""
    api_messages: list[anthropic.types.MessageParam] = [
        {"role": msg.role, "content": msg.content} for msg in prior_messages
    ]
    api_messages.append({"role": "user", "content": user_content})
    return api_messages


def map_provider_error(exc: BaseException) -> str:
    """Map a provider exception to a user-facing error string."""
    if isinstance(exc, anthropic.APIStatusError):
        if exc.status_code == 429:
            return "Rate limit exceeded — please retry shortly"
        if exc.status_code >= 500:
            return "AI service unavailable"
        return f"AI request failed ({exc.status_code})"
    if isinstance(exc, anthropic.APIConnectionError):
        return "Connection to AI service failed"
    return str(exc)


async def stream_chat_events(
    api_messages: list[anthropic.types.MessageParam],
) -> AsyncIterator[StreamEvent]:
    """Stream assistant text chunks from the provider.

    Yields :class:`TextDelta` for each text chunk. If the provider raises
    an error during streaming, a single terminal :class:`ProviderError`
    event is yielded with a user-facing message and the iterator ends.
    Callers therefore do not need to know about the SDK's exception
    hierarchy.

    Raises :class:`RuntimeError` if the async client is not configured;
    callers should check :func:`get_async_client` before invoking this
    helper.
    """
    client = _async_anthropic_client
    if client is None:
        raise RuntimeError(
            "ANTHROPIC_API_KEY is not configured. Unable to process chat messages."
        )
    try:
        async with client.messages.stream(
            model=DEFAULT_MODEL,
            max_tokens=DEFAULT_MAX_TOKENS,
            messages=api_messages,
        ) as stream:
            async for text in stream.text_stream:
                yield TextDelta(text=text)
    except (anthropic.APIStatusError, anthropic.APIConnectionError) as exc:
        yield ProviderError(user_message=map_provider_error(exc))
    except Exception as exc:  # pragma: no cover - defensive fallback
        yield ProviderError(user_message=map_provider_error(exc))
