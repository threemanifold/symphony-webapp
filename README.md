# symphony-webapp

Template for small web-app experiments driven by Symphony / Codex.

## Layout

```
apps/
  backend/    Python 3.13 + FastAPI + uv. ruff + mypy strict + pytest.
  frontend/   React 19 + TypeScript + Vite + Vitest + ESLint.
.codex/
  skills/     commit, push, pull, land
  scripts/    run-tests.sh, commit-and-push.sh, open-pr.sh,
              linear-workpad.sh, linear-state.sh
.github/
  workflows/  ci.yml — runs backend + frontend checks on PR.
```

## Prerequisites

- Node 22+, pnpm 10
- Python 3.13, [uv](https://docs.astral.sh/uv/)

## First-time setup

```sh
pnpm install
uv sync --directory apps/backend --all-groups
```

## Dev

```sh
pnpm dev:frontend   # vite dev server
pnpm dev:backend    # uvicorn --reload on http://127.0.0.1:8000
```

## Test

Single command runs both suites with terse output (used by Codex):

```sh
pnpm test            # ./.codex/scripts/run-tests.sh
```

Or per-side:

```sh
pnpm test:frontend
pnpm test:backend
```

## Lint / format

```sh
pnpm lint            # tsc + eslint (frontend); add ruff/mypy via uv for backend
pnpm lint:fix
```

Backend ruff/mypy:

```sh
uv run --directory apps/backend ruff check .
uv run --directory apps/backend mypy .
```

## How it pairs with Symphony

This repo only ships the agent-side pieces (`.codex/skills/`, `.codex/scripts/`).
The Symphony orchestrator's `WORKFLOW.md` clones this repo into a workspace and
launches Codex inside it; the agent then invokes the scripts and skills above.
