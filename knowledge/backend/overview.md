---
type: Backend Module
title: Backend Overview
description: Backend setup, module inventory, environment variables, and PII scrubber operations.
resource: /backend/overview.md
tags: [backend, setup, modules]
status: current
owner: project
source_paths:
  - backend/README.md
  - backend/src/allegrobot/settings.py
  - backend/src/authentication/views.py
  - backend/src/allegro/client.py
  - backend/src/allegro/models.py
  - backend/src/allegro/views/auth.py
  - backend/src/ai_audit/services.py
  - backend/src/ai_audit/tasks.py
  - backend/src/ai_audit/langfuse_client.py
  - backend/src/knowledge_builder/
  - backend/src/ai/realtime/
  - backend/env.example
  - backend/.env.prod.example
last_reviewed: 2026-07-27
timestamp: 2026-07-27
---

# Superseller — Backend

Django-based backend for the Superseller Allegro customer support system. Runs as Docker services for Django, async workers, Postgres, Redis, and local development tooling.

## Quick Start

```bash
cd backend

# Copy env template and fill in your keys
cp .env.example .env

# Build and start all services
docker-compose up -d --build

# Apply database migrations
docker-compose exec web python manage.py migrate

# View logs
docker-compose logs -f web celery
```

## Modules

| Module | Path | Purpose | Docs |
|--------|------|---------|------|
| **Allegro Integration** | `src/allegro/` | OAuth2 auth, persistent account assignment, discussions, offers, orders API | — |
| **DRE (Rules Engine)** | `src/dre/` | Deterministic system prompt assembly with core + user rules | [/backend/dre.md](/backend/dre.md) |
| **PII Scrubber** | `src/pii_scrubber/` | 3-pass PII anonymization (regex → spaCy → Bielik LLM) | [/backend/pii-scrubber.md](/backend/pii-scrubber.md) |
| **RAG Knowledge Base** | `src/rag/` | Document ingestion, embedding, vector retrieval, product KB overrides | [/backend/rag.md](/backend/rag.md) |
| **Knowledge Builder** | `src/knowledge_builder/` | Conversational sessions, append-only consent, safe card revisions/decisions, P0 coverage, readiness, and revocable OpenAI Realtime calls | [/plans/openai-knowledge-builder.md](/plans/openai-knowledge-builder.md) |
| **Autoresponder** | `src/autoresponder/` | Shared single-turn decision engine plus production Allegro transport and side-effect adapter | [/architecture/reply-decision-system.md](/architecture/reply-decision-system.md) |
| **Simulator** | `src/simulator/` | Side-effect-free adapter over the canonical autoresponder decision engine, with optional offer context | — |
| **AI Audit** | `src/ai_audit/` | Technical model-run telemetry separated by `production` and `simulator` execution modes | — |
| **Authentication** | `src/authentication/` | Django/allauth email auth and SimpleJWT API sessions | — |

The decision engine owns sanitization, intent routing, topic and offer policy,
DRE/RAG generation, confidence, escalation classification, and buyer-facing text
formatting. Production remains responsible for polling, subscription limits,
staleness checks, delivery, attempts, cursors, suggestions, escalations, and
notifications. Simulator execution never mutates those business records or
customer usage; it writes only separately labeled technical audit runs.

## Docker Services

| Service | Port | Description |
|---------|------|-------------|
| `web` | 8000 | Django dev server |
| `celery` | — | Celery worker consuming the default and `ai_audit` queues for application jobs and asynchronous audit persistence |
| `postgres` | 5432 | PostgreSQL database with pgvector |
| `pgweb` | 8082 | Browser-based Postgres viewer preconfigured for the Compose database |
| `redis` | 6379 | Message broker + result backend |

## Key Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string. Local Compose points it at the dev Postgres service; production should use the separate Coolify PostgreSQL internal URL on the `coolify` Docker network, e.g. the current `p12rwcamaixpeb9mwf26p7i9` database host. |
| `DEV_SCAN_EMAIL` | Optional, development only | Default account used by `make scan` and `make scan-sync`. When blank, the command infers the user only if exactly one auto-reply configuration is enabled. |
| `JWT_SIGNING_KEY` | Yes in production | Independent SimpleJWT signing secret for API access and refresh tokens. Do not reuse `SECRET_KEY`; rotating this value invalidates existing JWT sessions. |
| `JWT_ACCESS_MINUTES` / `JWT_REFRESH_DAYS` | Optional | Access and refresh token lifetimes. Defaults are 15 minutes and 14 days. |
| `AUTH_REFRESH_COOKIE_*` | Optional | Web refresh-token cookie transport settings. Defaults: name `superseller_refresh`, path `/api/auth/`, blank domain for a host-only cookie, `secure` enabled in production, and SameSite `Lax`. |
| `OPENAI_API_KEY` | Yes | Used by RAG (embeddings + LLM) and intent classification |
| `KNOWLEDGE_BUILDER_REALTIME_ENABLED` | Optional | Enables backend-controlled OpenAI unified-WebRTC call setup; defaults to `false`. |
| `OPENAI_REALTIME_SAFETY_SECRET` | Required when Realtime is enabled | Dedicated secret for pseudonymous Realtime safety identifiers; use at least 32 bytes and do not reuse the Django secret. |
| `OPENAI_REALTIME_TIMEOUT_SECONDS` | Optional | Provider call-setup and hangup timeout; defaults to 5 seconds. |
| `AI_AUDIT_ASYNC_ENABLED` | Optional | Enables best-effort asynchronous audit persistence; defaults to `true`. Audit failures never fail reply processing. |
| `AI_AUDIT_QUEUE_NAME` | Optional | Redis/Celery audit queue consumed by the main Celery worker; defaults to `ai_audit`. |
| `LANGFUSE_ENABLED` | Optional | Enables the Langfuse trace projection; defaults to `false`. It does not replace local `ai_audit` persistence. |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | Required when enabled in production | Langfuse project credentials. |
| `LANGFUSE_BASE_URL` | Optional | Langfuse Cloud or self-hosted API URL; defaults to `https://cloud.langfuse.com`. |
| `LANGFUSE_CAPTURE_CONTENT` | Optional | Allows recursively PII-scrubbed prompt/output capture outside production; a scrubber failure drops content. Production startup requires `false`, and embedding input remains hash-only. |
| `LANGFUSE_PSEUDONYMIZATION_KEY` | Required when enabled in production | Dedicated HMAC secret used for stable, non-raw user and conversation correlation. |
| `LANGFUSE_SAMPLE_RATE` / `LANGFUSE_TRACING_ENVIRONMENT` / `LANGFUSE_RELEASE` | Optional | Trace sampling and deployment labels. When enabled in production, sampling must be greater than `0` and at most `1`. |
| `CELERY_BROKER_URL` | Auto | Set by docker-compose to `redis://redis:6379/0` |
| `OLLAMA_BASE_URL` | No | Bielik PII audit LLM endpoint (defaults to `http://ollama:11434`) |
| `NOTIFICATIONS_ENABLED` | No | Global switch for system notification event and delivery creation; defaults to `true`. |
| `NOTIFICATIONS_APP_BASE_URL` | Required in production | Absolute HTTPS frontend origin used in notification links, e.g. `https://app.example.com`. |
| `MAILJET_API_KEY` / `MAILJET_SECRET_KEY` / `MAILJET_FROM_EMAIL` | Required in production | Mailjet credentials and a verified sender identity. Production always uses the Anymail Mailjet backend and fails startup when these are absent. |
| `MAILJET_CONFIRMATION_TEMPLATE_ID_PL` / `MAILJET_CONFIRMATION_TEMPLATE_ID_EN` | Required in production | Polish and English Mailjet stored transactional templates for auth confirmation emails. Each receives only `confirmation_url`; sending fails closed when the selected ID is blank. |
| `MAILJET_ACCOUNT_DELETION_CONFIRMATION_TEMPLATE_ID_PL` / `MAILJET_ACCOUNT_DELETION_CONFIRMATION_TEMPLATE_ID_EN` | Required in production | Polish and English owner-verification templates. Each receives only `confirmation_url`. |
| `MAILJET_ACCOUNT_DELETION_REQUEST_TEMPLATE_ID_PL` | Required in production | Polish administrator request template. It receives `admin_url`, server-escaped `account_email` and `request_message`, `requested_at`, `confirmed_at`, `source`, and `request_id`. |
| `MAILJET_ACCOUNT_DELETION_COMPLETED_TEMPLATE_ID_PL` / `MAILJET_ACCOUNT_DELETION_COMPLETED_TEMPLATE_ID_EN` | Required in production | Polish and English deletion-completed templates. They receive no merge variables. |
| `ANYMAIL_WEBHOOK_SECRET` | Required in production | Dedicated `username:password` Basic-Auth credential for `/anymail/mailjet/tracking/`; do not reuse application or provider API secrets. |
| `TELEGRAM_ACCESS_TOKEN` / `TELEGRAM_CHAT_ID` | Required in production | Independent operational alert channel for failed or unresolved account-deletion email delivery. Alerts contain request IDs and safe error codes, not recipient addresses or tokens. |
| `ACCOUNT_DELETION_REQUEST_SECRET` | Required in production | Shared server-only secret used by the landing request and confirmation proxies. |
| `ACCOUNT_DELETION_LANDING_URL` | Required in production | Exact public deletion URL used to build one-time confirmation links. |
| `ACCOUNT_DELETION_ADMIN_EMAIL` / `ACCOUNT_DELETION_ADMIN_BASE_URL` | Required in production | Recipient and Django-admin base URL for verified deletion notifications. |
| `WAITLIST_MAILJET_TEMPLATE_ID_PL` / `WAITLIST_MAILJET_TEMPLATE_ID_EN` | Required in production | Localized waitlist join templates. Each receives `discount_percent` and `discount_code`. |
| `MAILJET_CONVERSATION_ESCALATED_TEMPLATE_ID_PL` / `_EN` | Required in production | Localized escalation templates. Each receives `url` and the human-readable `reason`. |
| `MAILJET_USAGE_LIMIT_REACHED_TEMPLATE_ID_PL` / `_EN` | Required in production | Localized usage-limit templates. Each receives `replies_sent`, `reply_limit`, `current_period_end`, and `url`. |
| `EXPO_PUSH_ACCESS_TOKEN` | Optional | Expo Push Service access token when push security is enabled |
| `WEB_PUSH_VAPID_*` | Yes for Web Push | VAPID public/private key and subject for browser push |

See [System Notifications](/backend/notifications.md) for notification event flows,
API contracts, provider setup, and client registration details. Push
clients must register `/api/notifications/push-endpoints/` before push delivery
can occur.

Account-deletion emails persist `pending`, `accepted`, `sent`, `failed`, or
`unknown` provider state in PostgreSQL. Mailjet webhooks establish terminal
delivery state; Celery reconciles stale accepted messages every five minutes,
and failed or unresolved delivery queues a PII-free Telegram alert. See
[Mailjet Delivery Tracking and Alerts](/operations/mailjet-delivery.md).

For self-hosted Langfuse, mandatory event blob storage and the Cloudflare R2
verification procedure are documented in
[Langfuse Self-Hosting and R2](/operations/langfuse-self-hosting.md).

## Allegro OAuth permissions

The production Allegro Developer App must declare these scopes:

| Scope | Superseller usage |
|---|---|
| `allegro:api:profile:read` | Read `GET /me` during OAuth callback to identify the seller and enforce persistent account assignment. |
| `allegro:api:sale:offers:read` | Read the seller's offers and offer details for onboarding, catalog views, and product knowledge. |
| `allegro:api:orders:read` | Read orders and order events for customer context and post-purchase workflows. |
| `allegro:api:messaging` | Read message threads, send replies, and mark threads as read. |

Configure production scopes in the production Allegro application manager and
sandbox scopes separately in its sandbox equivalent. The authorization URL does
not narrow the requested scope, so Allegro grants the scopes declared for that
Developer App. After adding or changing permissions, the seller must complete a
fresh OAuth authorization; existing access tokens do not gain new scopes.
See [Allegro's OAuth scope documentation](https://developer.allegro.pl/tutorials/uwierzytelnianie-i-autoryzacja-zlq9e75GdIR).

## Development message scans

From `backend/`, use the Make targets to bypass the normal polling cooldown
while developing reply behavior:

```bash
make scan                         # queue through Celery
make scan-sync                    # execute inline and show the result
make scan EMAIL=user@example.com  # override the inferred/default account
make scan-logs                    # follow worker logs
```

The underlying `scan_messages_now` Django command refuses to run when
`DJANGO_ENV=production`. Without `EMAIL` or `DEV_SCAN_EMAIL`, it selects the
account only when exactly one enabled auto-reply configuration exists.

## PII Scrubber

The `pii_scrubber` module provides a comprehensive pipeline for removing Personally Identifiable Information (PII) from strings to ensure compliance with privacy regulations before passing data to external services (e.g. LLMs).

### Features
- **Regex Substitution**: Applies fast regex parsing for static patterns (Email, Phone, Postal Codes, URLs)
- **Token Masking**: Replaces sensitive data with placeholder tokens (e.g., `<PESEL>`, `<IMIE_NAZWISKO>`).
- **Context-Aware Deterministic Validation**:
    - `validators.py` contains mathematically strict checksum checks for `PESEL` and `IBAN` (Mod97).
    - `regex_patterns.py` evaluates context bounding boxes around numbers (for example, checking for "PLN" or "zł" to prevent redacting monetary figures, or checking for "account number" when interpreting generic 26-digit strings).
- **Fallback NLP NER**: Uses spaCy Polish embeddings to catch names and complex entities that evade strict formatting regex.
- **Bielik LLM GDPR Audit** (Pass 3): A local Polish-specialized LLM ([SpeakLeash/bielik-4.5b-v3.0-instruct](https://huggingface.co/SpeakLeash/bielik-4.5b-v3.0-instruct)) that reviews already-scrubbed output for remaining PII leaks. Served via [Ollama](https://ollama.com). Falls back to Regex+NLP if Ollama is unavailable.

### Prerequisites — Ollama (for Bielik LLM audit)

**Option A — Docker (recommended for teams):**
```bash
docker compose up
```
This auto-pulls and serves the Bielik model. See `docker-compose.yml`.

**Option B — Local install:**
```bash
# Install Ollama: https://ollama.com/download
ollama pull SpeakLeash/bielik-4.5b-v3.0-instruct:Q8_0
ollama serve
```

The scrubber connects to Ollama at `http://localhost:11434` by default. Override with the `OLLAMA_BASE_URL` environment variable.

### Evaluation Framework

The module includes a deterministic evaluation framework that prevents leakage and ensures the context algorithms aren't over-redacting innocent information (Precision/Recall).

```bash
# Run the evaluation script over the golden testing set
uv run python src/pii_scrubber/evals/evaluate_scrubber.py

# Run against synthetic cases
uv run python src/pii_scrubber/evals/evaluate_scrubber.py --cases synthetic/synthetic.json

# Show all False Negative cases grouped by category after metrics
uv run python src/pii_scrubber/evals/evaluate_scrubber.py --cases synthetic/synthetic.json --show-fn
```

#### CLI Flags

| Flag | Description |
|------|-------------|
| `--cases <path>` | Path to the JSON cases file (default: `pii_golden_cases.json`). Relative paths resolve from the `evals/` directory. |
| `--show-fn` | Print all False Negative cases grouped by PII category after the metrics summary. |
| `--show-fp` | Print all False Positive cases grouped by PII category after the metrics summary. |
| `--show-mismatch` | Print cases where text was strictly scrubbed for safety but replaced with an incorrect categorical token. |

#### Interpreting Results

- **Failures**: Any `Email`, `Phone`, `PESEL`, or `IBAN` that leaks into the output text triggers a `Hard Leakage` failure and an exit code of `1`.
- **Thresholds**: If recall dips below `1.0` for critical IDs, or `< 0.95` for names or addresses, the suite returns an exit code of `1`.
- **See also**: [`evals/HOW_METRICS_WORK.md`](/evals/pii-scrubber-evals.md) for a detailed explanation of TP, FN, FP with examples.

### Generating Synthetic Test Cases

To massively expand the edge-case coverage of the scrubber without needing manual data entry, the evaluation framework includes a synthetic JSON test-case generator powered by OpenAI `gpt-4o`.

**Prerequisites:** You must have an `.env` file or export your `OPENAI_API_KEY`.

```bash
# Generate 500 cases in batches of 50
uv run python scripts/generate_synthetic_evals.py --total 500 --batch-size 50 --out src/pii_scrubber/evals/synthetic_cases.json
```
After generation, you can run the evaluation script targeting the synthetic file by modifying the `cases_file` path in `evaluate_scrubber.py`.


# Provenance

Migrated from legacy path `backend/README.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
Environment-variable notes also reflect active Django settings, auth views, and backend env examples.
