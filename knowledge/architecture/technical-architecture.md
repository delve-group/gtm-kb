---
type: Architecture
title: Technical Architecture and Operations
description: Canonical repository layout, frontend/backend stack, data invariants, deployment, operations, and coding conventions.
resource: /architecture/technical-architecture.md
tags: [architecture, backend, frontend, operations]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
  - backend/docker-compose.yml
  - backend/docker-compose.prod.yml
  - backend/src/ai_audit/langfuse_client.py
last_reviewed: 2026-07-22
timestamp: 2026-07-22
---

## 17. Technical architecture

### Repository layout

```text
superseller/
  backend/      Django service, async jobs, integrations, AI orchestration
  frontend/     Expo/React Native application for web, iOS, and Android
```

### Frontend stack

- Expo 54 and Expo Router.
- React 19.
- React Native 0.81.
- TypeScript with strict mode.
- Gluestack UI primitives.
- NativeWind/Tailwind utility styling.
- Zustand state stores.
- Supabase client authentication.
- Axios domain clients.
- AI SDK streaming for the simulator.

### Frontend architecture

- `app/` contains thin route wrappers.
- `features/` contains screen-level product domains.
- `api/` contains typed service domains with one operation per file.
- `shared/` contains reusable UI, auth, components, and helpers.
- `store/` contains cross-screen state.
- `i18n/` contains Polish and English copy.
- `auth/` contains account and checkout-related auth flows.

Current feature domains:

- Dashboard.
- Rule management.
- Offers.
- Message center.
- Escalations.
- Post-purchase.
- Analytics.
- Onboarding.
- Settings.

Current client service domains:

- Authentication.
- Allegro.
- Audit.
- Billing.
- Knowledge base.
- Onboarding.
- Post-purchase.
- Rules.
- Simulator.

### Backend stack

- Python 3.12 production image.
- Django 5.
- Django REST Framework.
- PostgreSQL with pgvector.
- Supabase for PostgreSQL and account identity.
- Redis.
- Celery worker and scheduler.
- OpenRouter as the AI gateway.
- GPT-4o-mini as the current reply, classification, segmentation, and learning model.
- OpenAI text-embedding-3-small through the AI gateway.
- Optional local Bielik model through Ollama for privacy auditing.
- Optional Langfuse v4 SDK for AI trace visualization and correlation.
- Stripe for billing and referral rewards.
- Mailjet via Django Anymail for email.
- Expo Push Service and Web Push for push notifications.

### Backend domains

- `authentication` — authenticated profile and staff status.
- `allegro` — account authorization, offers, orders, discussions, tokens, thread snapshots, escalations.
- `autoresponder` — scan scheduling, reply modes, suggestions, conversation state, reply attempts.
- `ai` — shared AI and embedding gateway.
- `ai_audit` — authoritative runs, spans, usage, cost, exports, retention, and
  the optional Langfuse trace projection.
- `billing` — subscriptions, allowances, packs, checkout, payment events.
- `dre` — core and seller rules, learned rules.
- `notifications` — preferences, events, delivery, push endpoints.
- `onboarding` — readiness state, offer sync, product knowledge generation.
- `pii_scrubber` — privacy scanning and masking.
- `postbuy` — paid-order messages and priority templates.
- `rag` — knowledge ingestion, storage, retrieval, confidence.
- `referral` — codes, redemption, qualification, rewards.
- `simulator` — test conversations and saved transcripts.

### Authentication boundaries

- Main API requests use the Supabase bearer token.
- Expired main sessions are refreshed once and the request is retried.
- Allegro authorization also relies on browser-session cookies during connection.
- Allegro access and refresh tokens are stored encrypted.
- Marketplace tokens are refreshed when expired and deleted when refresh fails.
- Allegro account ownership is also stored as a persistent assignment by Allegro account ID; disconnecting OAuth tokens does not release that assignment.
- Allegro account ownership checks are served from the indexed `AllegroAccountConnection` table; legacy token hydration happens through backfill or the owner's status request, not through global token scans during new account connection.
- Allegro browser-session token fallback is allowed only for an unclaimed token or a token owned by the same authenticated user; status and disconnect endpoints must never prefer another user's session token over the authenticated user boundary.
- Web-initiated OAuth flows store the web callback base in signed state, and callback errors are forwarded back to active app screens through same-origin browser messaging/storage; the active hook queues account-assignment errors while the OAuth popup is open, then shows the shared failure modal after the popup closes. Settings and onboarding use the same modal-only error surface, without an inline red alert.
- Customer data is scoped by the authenticated user.

### Scheduled jobs

- Dispatch due automatic-reply scans every minute.
- Return timed-out escalations every minute.
- Refresh cached thread lists every minute.
- Dispatch post-purchase scans every minute.
- Clean expired audit records daily.
- Clean expired exports daily.
- Check mobile-push receipts every five minutes.
- Process referral rewards every six hours.
- Periodic database keepalive.

### Cached and asynchronous behavior

- Conversation-list metadata is cached as thread snapshots.
- Knowledge documents are processed asynchronously.
- Automatic reply and post-purchase scans run in workers.
- Notification deliveries are queued.
- Audit exports are created asynchronously.
- AI audit runs, spans, and usage are accumulated in memory and published as one
  best-effort batch to a dedicated Redis/Celery queue. The existing Celery
  worker consumes both the default and audit queues and persists each batch
  atomically and idempotently so audit storage cannot fail reply delivery.
- The shared OpenRouter gateway emits Langfuse generation and embedding
  observations. Existing audit spans map to Langfuse chains, tools, retrievers,
  and guardrails beneath one detached root trace per message. The generated
  trace ID is persisted locally for correlation. SDK buffering and export are
  independent of the Redis audit-persistence queue.

---

## 18. Core data and invariants

### Account ownership

Business records are scoped to a user. Rules, documents, Allegro sessions, reply configuration, conversations, billing, referrals, and notifications must not leak between users.
An unreleased Allegro account ID can belong to only one app user; support release is required before another user can claim the same marketplace account.
OAuth session cookies are not an ownership boundary: authenticated requests must ignore a session token owned by another user.

### Automatic reply

- One reply configuration per user.
- One runtime state per configuration.
- One conversation cursor per user/thread.
- One suggestion per user/source message.
- A source message should not produce duplicate processing attempts.
- Newer buyer messages invalidate stale outgoing work.

### Escalation

- One escalation record per user/thread.
- Reopening updates the same logical case.
- Open and resolved are the main states.

### Knowledge

- Documents belong to one user.
- A document is global when it has no offer ID.
- Only the latest successful version of a name/scope pair is active.
- Fragments inherit their document scope.
- Offer automatic-reply configuration is unique per user/offer.

### Post-purchase

- One configuration per user.
- One runtime cursor per configuration.
- One sent/attempted post-purchase record per user/order.
- Priority rules are evaluated from highest priority downward.

### Billing

- One entitlement per user.
- Reply limits follow the active billing period.
- Paid packs are counted only in their matching period.
- Payment events update entitlements idempotently.

### Referral

- One referral code per referrer.
- One received referral per referee.
- Rewards are only processed after qualification and the refund window.

---

## 19. Deployment and operations

### Production shape

Frontend and backend are designed as separate deployments.

Frontend:

- Static web export.
- Nginx serves the generated application.
- Single-page routing falls back to the application entry point.
- Public environment values are embedded at build time.

Backend:

- Nginx public entry.
- Gunicorn application server.
- Celery worker.
- Celery scheduler.
- Redis.
- Persistent media and static volumes.
- Scheduled PostgreSQL backups.
- Health-check endpoint at `/healthz/`.
- The container probe connects directly to `127.0.0.1:8000` and does not use
  runtime HTTP proxy variables; its `Host` header still follows
  `HEALTHCHECK_HOST` or the first allowed host.

The deployment files are designed for Coolify and an external Supabase/PostgreSQL service. TLS termination occurs at the platform edge.

### Important environment groups

Frontend:

- Public backend base URL.
- Supabase URL and anonymous key.
- Optional authentication-disable flag for isolated design work.

Backend:

- Django security and allowed-origin settings.
- PostgreSQL connection.
- Supabase URL and service credentials.
- Allegro application credentials and environment.
- OpenRouter keys.
- Optional Langfuse credentials, endpoint, sampling, environment, release, and
  privacy-mode settings. Production permits metadata-only traces.
- Stripe products, prices, webhook, portal, and referral coupons.
- Redis/Celery URLs.
- Notification provider settings.
- Optional Ollama/Bielik settings.
- Public application URLs.

Never place backend service credentials in frontend public variables.

### Local commands

Frontend:

```bash
npm install
npm run start
npm run web
npm run lint
npm run build:web
```

Backend:

```bash
docker compose up -d --build
docker compose exec web python manage.py migrate
docker compose logs -f web celery
```

Actual compose service names can differ between development and production files; verify the active compose file before copying a command.

### CI gates

- Frontend CI runs separately for frontend changes.
- Backend CI runs for backend pull requests into `main`, backend pushes to
  `main`, and manual dispatch. It installs backend runtime/dev requirements,
  uses Python 3.12 with temporary `pgvector/pgvector:pg16` PostgreSQL, and
  runs Ruff linting, Ruff format check, pytest, `makemigrations --check`,
  migration compatibility linting for migrations changed since `origin/main`,
  and `migrate --noinput`.
- GitHub branch protection or a ruleset should require the Backend CI status
  check before merging into `main`.
- Backend deployment is triggered from GitHub Actions after Backend CI passes on
  `main` pushes. Coolify direct auto-deploy/webhook-on-push must stay disabled
  for the backend app, or it will race CI.
- The backend deploy job expects GitHub repository secrets
  `COOLIFY_BACKEND_WEBHOOK` and `COOLIFY_TOKEN`; the backend startup path still
  applies migrations through `RUN_MIGRATIONS=1`.

### Testing reality

- The backend has tests for AI gateway, audit, Allegro, autoresponder, segmentation, billing, rules, notifications, onboarding, privacy masking, post-purchase, referrals, and simulator behavior.
- The frontend currently has no committed feature test files despite conventions recommending React Testing Library.
- Frontend verification relies on lint/type/build checks unless tests are added.
- Per project instruction, do not start the application yourself to test visual changes.

---

## 20. Coding and repository conventions

The canonical frontend coding rules live in `.cursor/rules/rules.md`, with `AGENTS.md` and `CLAUDE.md` pointing to that shared file. Keep those instruction files.

High-level rules:

- React/React Native with strict TypeScript.
- Use `type`, not `interface`, for new TypeScript.
- Arrow functions only.
- No `React.FC`.
- Named exports except route-file defaults.
- Use shared Gluestack primitives.
- Support light and dark themes with tokens.
- Thin routes and feature-based modules.
- One client operation per domain file.
- Use alias imports.
- Keep comments and docstrings minimal and focused on non-obvious reasons.
- Do not run the app to visually test changes.

The existing code predates some of these conventions in places; new work should follow the current rules without broad unrelated rewrites.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
