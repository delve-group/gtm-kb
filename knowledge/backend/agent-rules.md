---
type: Backend Knowledge
title: Backend Agent Rules
description: Canonical backend TDD, pytest, database, Celery, production config, error-contract, and review-process rules for agents touching backend code.
resource: /backend/agent-rules.md
tags: [backend, agents, tests, errors, config]
status: current
owner: project
source_paths:
  - AGENTS.md
  - backend/CHANGELOG_FRONTEND.md
  - backend/BACKEND_REVIEW_NOTES.md
last_reviewed: 2026-07-21
timestamp: 2026-07-21
---

# Backend Agent Rules

## Backend TDD

- For backend behavior changes, write failing tests before implementation.
- Use red/green slices: add one focused failing test or small failing group, run
  the targeted pytest command, implement the minimum code, then rerun until
  green.
- Prefer Django `TestCase` and DRF `APIClient` for backend API behavior; isolate
  pure logic in service tests.
- Do not finish auth/backend work without running the new targeted tests and
  impacted app tests.

## Backend Test Infra

- Single runner: `pytest` from `backend/` (pytest-django, settings
  `allegrobot.test_settings`). Do not use `manage.py test`.
- Tests run against Postgres with the pgvector image from docker-compose and
  migrations enabled. Never switch tests back to SQLite and never mock the DB.
- Test data comes from factories in `backend/src/testing/factories.py`. Extend
  them there instead of hand-rolling users per test file.
- Tests that hit real external services get `@pytest.mark.integration`
  (deselected by default).
- Celery tasks: test the task function directly; mock `.delay`/`.apply_async`
  in view-level tests. Do not use `CELERY_TASK_ALWAYS_EAGER`.
- Mock only external boundaries: Allegro API, OpenAI, Stripe, email, WebPush,
  time (`freezegun`), and network (`responses`).
- Assert on error `code`, not `message`.
- Coverage target is at least 85% per module (`pytest --cov`).

## Backend Config

- Production config is validated at startup (`PRODUCTION_REQUIRED_ENV` in
  settings). New required env vars go on that list; do not add silent fallbacks
  for prod-critical values.
- Declaring a variable in `.env` or an example file does not inject it into a
  container. Whenever backend settings add or rename an environment variable,
  forward it explicitly through every relevant local and production Compose
  service. Put values needed by both Django and Celery in the shared backend
  environment anchor, and update adjacent services such as the landing proxy
  when they consume the same value.
- Keep the Compose forwarding tests aligned with feature-specific optional
  variables; production-required variables are checked automatically against
  `PRODUCTION_REQUIRED_ENV`.
- `DEBUG` defaults to `False`; dev environments must set it explicitly.
- New Celery tasks inherit global soft/hard time limits (540s/600s). Override
  per task instead of raising the global limits.

## Backend Error Contract

- Client-facing errors are `{code, message}`.
- `code` is stable snake_case with a domain prefix, for example
  `auth.invalid_credentials`.
- `message` is in Polish.
- Contract changes go to
  [Frontend API Contract Changelog](../frontend/api-contract-changelog.md).

## Backend Review Process

- The completed module-by-module review record and its deferred debt live in
  [Backend Review History and Remaining Debt](../plans/backend-review-history.md).
- Treat it as historical context and verify debt against current code before
  acting on it.

# Provenance

Moved from `knowledge/agent-guidance/coding-guidelines.md` on 2026-07-09 so
backend-specific agent rules live with backend knowledge instead of the root
agent guidance index.
