# Chat App Current State

This repository currently contains a working two-service chat app:

- `apps/frontend` is a React 19 + Vite + TypeScript single-page chat UI.
- `apps/backend` is a FastAPI service with a SQLite-backed conversation store.
- The frontend talks to the backend through relative HTTP routes, so local development expects the frontend and backend dev servers to be run together or proxied by the deployment environment.

## User Experience

The app opens to a split chat layout:

- a left sidebar titled `Symphony Chat`;
- a `New chat` action;
- a sidebar search field that filters conversations by title in the browser;
- a selectable conversation list with timestamps and delete buttons;
- a main conversation thread;
- a disabled message composer until a conversation is selected.

On startup, the frontend fetches `/conversations`, restores the last selected conversation from `localStorage` when possible, then fetches `/conversations/{conversation_id}` for the selected thread. Sending a message optimistically adds the user message and an empty assistant bubble, then fills the assistant bubble as server-sent events arrive from `/chat`.

## Backend API

The FastAPI backend exposes:

- `GET /health` for a basic health check;
- `GET /conversations` with optional `q` search across conversation titles and message content;
- `POST /conversations` to create an empty conversation;
- `GET /conversations/{conversation_id}` to fetch a conversation and its messages;
- `DELETE /conversations/{conversation_id}` to delete a conversation and cascade its messages;
- `POST /chat` to send a user message and stream an assistant response as `text/event-stream`.

The default runtime database is `apps/backend/data/chat.db`. Tests switch the app to an in-memory SQLite database or a temporary file path so they do not create the runtime database.

## AI Provider Behavior

Chat responses are backed by Anthropic through `anthropic.AsyncAnthropic`. The configured model is `claude-sonnet-4-6` with `max_tokens=8096`.

`POST /chat` builds the provider message list from all prior persisted messages in the selected conversation plus the new user message. During a successful stream, response tokens are emitted as SSE `data: <json string>` events. When the provider stream completes, the backend persists the user message and assistant reply, updates the conversation timestamp, and renames a default `New chat` conversation to the first user message truncated to 60 characters.

If `ANTHROPIC_API_KEY` is missing, `/chat` returns HTTP 500 before streaming. Provider rate limits, provider 5xx errors, connection errors, and unexpected stream exceptions are converted into SSE `[ERROR]` events; those failed attempts are not persisted.

## Persistence

Persistence is intentionally small and local:

- SQLite tables are created at app startup if needed.
- `conversations` store `id`, `title`, `created_at`, and `updated_at`.
- `messages` store `id`, `conversation_id`, `role`, `content`, and `created_at`.
- message rows are ordered by `created_at ASC`;
- conversation rows are listed by `updated_at DESC`;
- deleting a conversation cascades message deletion through the foreign key.

There is no user/account model, authentication, authorization, remote database, migration system, or per-user data isolation in the current implementation.

## Validation Coverage

The current automated coverage includes:

- backend unit/API tests for health, conversation create/list/get/delete, search, blank/missing conversation errors, Anthropic error handling, missing API key handling, and SQLite durability;
- frontend component tests for conversation loading, sidebar selection, search, new chat creation, streaming send behavior, error rendering, and a persistent multi-conversation flow;
- Playwright walkthrough specs for create/delete, multi-chat lifecycle, conversation search, mocked Claude-style responses, and incremental streaming.

The canonical validation command is:

```sh
./.codex/scripts/run-tests.sh
```

## Notable Gaps

- There is no authentication or multi-user separation.
- There is no production deployment configuration documented in this repo.
- There is no database migration layer; schema creation is direct `CREATE TABLE IF NOT EXISTS`.
- Conversation search in the frontend only filters already loaded conversation titles; backend search also supports message content but is not currently wired into the UI search field.
- The UI is functional and responsive, but intentionally minimal.
