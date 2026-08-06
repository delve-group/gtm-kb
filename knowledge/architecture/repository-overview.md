---
type: Architecture
title: Repository README Archive
description: Full repository README content preserved as a migrated OKF concept, including waitlist environment additions.
resource: ../../README.md
tags: [architecture, deployment, readme]
status: current
owner: project
source_paths:
  - .github/dependabot.yml
  - README.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Superseller – AI Allegro Customer Support Assistant

Superseller is a multi-tenant SaaS system that automates customer message handling on Allegro using a controlled RAG (Retrieval-Augmented Generation) architecture combined with deterministic business rules.

The system is designed to:

- Automatically respond to customer messages.
- Generate answers strictly based on an approved Knowledge Base.
- Prioritize product-specific rules over global policies.
- Escalate uncertain cases to a human operator.
- Operate in compliance with GDPR and EU AI Act requirements.

This repository is the core backend system responsible for message processing, AI orchestration, knowledge retrieval, decision logic, and audit logging.

---

# 🎯 Core Goal

Build a safe, controllable AI assistant that:

- Replies instantly to Allegro discussions.
- Uses ONLY approved Knowledge Base content.
- Never hallucinates outside defined context.
- Does not leak personal data to LLM providers.
- Can always fall back to a human.

This is not a generic chatbot.  
This is a constrained decision system with AI as a controlled component.

---

# 🧠 High-Level Architecture

Runtime message flow:

1. Message received from Allegro API.
2. PII scrubber (local masking of personal data).
3. Intent classification (rules or lightweight model).
4. Retrieval phase:
   - Product-level Knowledge Base (highest priority).
   - Global Knowledge Base.
5. Confidence scoring.
6. Decision:
   - If confident → generate AI response.
   - If not → escalate to human.
7. Log decision and sources used.
8. Send response via Allegro API (marked as AI-generated).

---

# 🏗 System Components

## 1. Allegro Integration Layer

- OAuth2 authentication
- Webhook / polling for discussions
- Read/write discussions
- Read offers
- Read orders

## 2. Knowledge Base System

### Global Knowledge Base

Uploaded during onboarding:

- PDF / DOCX / TXT
- Manual Q&A entries

Stored as:

- Structured entries
- Chunked text
- Embedded vectors
- Versioned

### Product-Level Overrides

Each offer_id can define:

- Dedicated mini knowledge base
- Custom Q&A
- Policy overrides
- “Disable auto-response” flag

Priority:
Product KB > Global KB

---

## 3. Rules Engine

Deterministic constraints, such as:

- Maximum discount allowed
- Formal tone required
- Must request order number for order-related queries
- Never provide phone number
- Do not negotiate price

Rules override AI generation.

---

## 4. PII Scrubber

Before sending any message to LLM, a 3-pass pipeline removes personal data:

| Pass | Engine                                        | What it catches                                                   |
| ---- | --------------------------------------------- | ----------------------------------------------------------------- |
| 1    | **Regex** + checksum validators               | Emails, phones, PESEL, IBAN, postal codes, URLs, tracking numbers |
| 2    | **spaCy NER** (`pl_core_news_sm`)             | Polish names (including declined forms), addresses, locations     |
| 3    | **Bielik LLM GDPR Audit** (local, via Ollama) | Post-scrub review — catches anything Regex+NLP missed             |

If Bielik detects a leak in the already-scrubbed text, a 3-layer patching chain fixes it automatically.
If Ollama is not running, the pipeline gracefully falls back to Regex+NLP only.

The LLM must never receive raw personal data.

---

## 5. Retrieval-Augmented Generation (RAG)

The model receives:

- Retrieved KB chunks
- Relevant rules
- Cleaned message

The model must:

- Answer strictly from provided context.
- Never invent policies.
- Abstain if insufficient context.

---

## 6. Confidence Scoring

The system must calculate a confidence score based on:

- Retrieval similarity
- Number of consistent KB matches
- Conflict detection
- Intent clarity

If confidence < threshold:
→ Escalate to human
→ Do NOT generate answer

Abstention is safer than hallucination.

---

## 7. Audit Logging

Store:

- Conversation ID
- Used KB entry IDs
- Confidence score
- Decision (auto/escalated)
- Hash of prompt
- Timestamp

Do NOT store unnecessary personal data.

Logs must allow:

- Decision traceability
- Dispute resolution
- Compliance auditing

---

# ⚖ Regulatory Requirements

This system must operate under:

## GDPR (RODO)

- We are a Data Processor.
- Client is Data Controller.
- Data minimization required.
- Mask personal data before LLM usage.
- Configurable retention policy.
- Data deletion capability.

## EU AI Act

- Classified as Limited Risk AI.
- Must disclose AI-generated responses.
- Must allow human escalation.
- Must maintain documentation and monitoring.

Every auto-generated message must include an AI disclosure footer.

---

# 🔒 Non-Negotiable Design Principles

1. Never answer outside Knowledge Base.
2. Never guess.
3. Never expose personal data.
4. Prefer escalation over uncertainty.
5. Product-level overrides always win.
6. Deterministic rules override AI output.
7. Every decision must be auditable.

---

# 🧩 Development Philosophy (Important for AI Coding Agents)

This repository will be primarily developed by AI agents.

The agent must:

- Focus on fast feature delivery.
- Respect defined architecture.
- Never use `any` type (use `unknown` if necessary).
- Always check types strictly.
- Leave every modified file in better condition than before.
- Perform small refactors when safe.
- Avoid overengineering.
- Keep modules decoupled.
- Maintain security-first mindset.

Rule #1:
If you touch a file and it can be improved safely, improve it.

---

# 📂 Project Structure

- `backend/` - Python/Django backend application containing core logic, API endpoints, and Allegro integrations.
  - `src/allegro/` - Allegro API integration (OAuth, discussions, offers, orders).
  - `src/allegrobot/` - Django project configuration (settings, Celery, root URL conf).
  - `src/authentication/` - Supabase JWT authentication backend.
  - `src/dre/` - Deterministic Rules Engine (system prompt assembly). [Docs →](/backend/dre.md)
  - `src/pii_scrubber/` - 3-pass PII anonymization pipeline. [Docs →](/backend/pii-scrubber.md)
  - `src/rag/` - RAG Knowledge Base (document ingestion, embeddings, vector retrieval). [Docs →](/backend/rag.md)
  - `src/simulator/` - Message simulator with intent routing, DRE rules, and RAG integration.
- `frontend/` - React Native (Expo) frontend application using NativeWind/Tailwind for styling.
  - `app/(app)/` - Protected app routes (dashboard, simulator, knowledge base, allegro auth).
  - `components/app/` - Feature views (DashboardView, KnowledgeBaseView, SimulatorView, etc.).
  - `api/` - Typed API service clients (knowledgeBaseService, simulatorService, etc.).
  - `docs/` - Frontend module documentation. [KB Docs →](/architecture/knowledge-confidence.md)

---

# 📦 Suggested Tech Stack (Flexible)

- Backend: Python / Django (Currently implemented, overriding Node.js suggestion)
- API: REST
- DB: PostgreSQL
- Vector DB: pgvector or dedicated vector store
- Queue: Celery / Redis
- LLM Provider: pluggable
- PII Audit LLM: [SpeakLeash/bielik-4.5b-v3.0-instruct](https://huggingface.co/SpeakLeash/bielik-4.5b-v3.0-instruct) via [Ollama](https://ollama.com)
- Hosting: Docker-based deployment

---

# 🐳 Docker Setup

The project includes an Ollama service in `backend/docker-compose.yml` for the Bielik PII auditor:

```bash
cd backend
docker compose up
```

This will:

- Start the Django web server on port `8000`
- Start Ollama on port `11434`
- Auto-download the Bielik model (~5GB, first run only)
- Persist the model in a Docker volume (`ollama_data`)

For **GPU acceleration** (NVIDIA), uncomment the `deploy.resources` block in `docker-compose.yml`.

---

# 🚀 Deployment With Coolify

Production deployment is designed for **two separate Coolify applications**:

- `backend/` as a **Docker Compose** app exposed on `https://api.example.com`
- `frontend/` as a **Dockerfile** app exposed on `https://app.example.com`

Assumptions used by this setup:

- PostgreSQL and Auth stay on **Supabase**
- Ollama/Bielik is **optional** in production and is not part of the main backend stack
- Coolify handles **TLS termination** and public domains

## Deployment Architecture

### Backend

- Django runs behind internal `nginx`
- `nginx` serves `/static/` and `/media/`
- `celery` and `celery-beat` share the same app image
- `redis` stays internal to the stack
- PostgreSQL is a separate Coolify database resource, not part of the backend app compose
- Coolify should route the public backend domain to the `nginx` service on port `80`

### Frontend

- Expo is exported as a static web build during the Docker image build
- `nginx` serves the generated `dist/` output
- SPA routing is handled in `frontend/nginx.conf`, so refreshes on `/dashboard` and `/allegro-auth` continue to work

## Coolify Setup

### 1. PostgreSQL Database

- Type: `Database`
- Engine: `PostgreSQL`
- Recommended image/version: PostgreSQL 16 with `pgvector` support
- Database name: `allegro`
- Username: `allegro`
- Password: generate a strong password in Coolify
- Public access: disabled unless you need to connect from outside the server
- Backups: enable scheduled Coolify database backups

If Coolify's one-click PostgreSQL resource does not let you use a pgvector-capable image, create this as a separate Coolify Docker Compose service instead, using `pgvector/pgvector:pg16`, and attach it to the same destination/network as the backend app.

After creating the database, copy the database's **internal connection URL** from Coolify and use it as the backend app's `DATABASE_URL`. Use the internal URL when the backend app and database are in the same Coolify project/network. Use the public URL only if the app cannot reach the database internally.

The app runs migrations on deploy and includes a migration that creates the `vector` extension, so the database user must be allowed to run:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 2. Backend App

- Type: `Application`
- Build Pack: `Docker Compose`
- Base Directory: `backend`
- Compose File: `docker-compose.prod.yml`
- Public Domain: `https://api.example.com`
- Public Service: `nginx`
- Public Port: `80`

Use `backend/.env.prod.example` as the source of truth for required variables. In Coolify, define them in the UI instead of relying on a committed `.env.prod` file.

Backend production variables:

| Variable                                                                      | Required               | Example / Notes                                                                                                                    |
| ----------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `SECRET_KEY`                                                                  | Yes                    | Long random Django secret                                                                                                          |
| `JWT_SIGNING_KEY`                                                             | Yes                    | Long random SimpleJWT signing secret; keep independent from `SECRET_KEY`                                                           |
| `JWT_ACCESS_MINUTES`                                                          | No                     | Defaults to `15`                                                                                                                   |
| `JWT_REFRESH_DAYS`                                                            | No                     | Defaults to `14`                                                                                                                   |
| `AUTH_REFRESH_COOKIE_NAME`                                                    | No                     | Defaults to `superseller_refresh`                                                                                                  |
| `AUTH_REFRESH_COOKIE_PATH`                                                    | No                     | Defaults to `/api/auth/`                                                                                                           |
| `AUTH_REFRESH_COOKIE_DOMAIN`                                                  | No                     | Usually blank for a host-only API cookie                                                                                           |
| `AUTH_REFRESH_COOKIE_SECURE`                                                  | No                     | Defaults to `True` in production; requires HTTPS                                                                                   |
| `AUTH_REFRESH_COOKIE_SAMESITE`                                                | No                     | Defaults to `Lax`                                                                                                                  |
| `DEBUG`                                                                       | Yes                    | `False`                                                                                                                            |
| `ALLOWED_HOSTS`                                                               | Yes                    | `api.example.com`                                                                                                                  |
| `CORS_ALLOWED_ORIGINS`                                                        | Yes                    | `https://app.example.com`                                                                                                          |
| `CSRF_TRUSTED_ORIGINS`                                                        | Yes                    | `https://api.example.com,https://app.example.com`                                                                                  |
| `FRONTEND_BASE_URL`                                                           | Yes                    | `https://app.example.com`                                                                                                          |
| `DATABASE_URL`                                                                | Yes                    | Coolify PostgreSQL internal URL, e.g. `postgresql://allegro:<password>@<internal-host>:5432/allegro`                               |
| `SUPABASE_URL`                                                                | Yes                    | Self-hosted Supabase Kong URL, e.g. `https://supabase.example.com`                                                                 |
| `SUPABASE_PROJECT_REF`                                                        | No                     | Dev/legacy Supabase Cloud fallback                                                                                                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                                   | Yes                    | Backend-only secret                                                                                                                |
| `MAILJET_API_KEY`                                                             | Yes                    | Mailjet API key for auth/account and notification emails                                                                           |
| `MAILJET_SECRET_KEY`                                                          | Yes                    | Mailjet secret key                                                                                                                 |
| `MAILJET_FROM_EMAIL`                                                          | Yes                    | Mailjet-verified sender, e.g. `Superseller <no-reply@superseller.pl>`                                                              |
| `MAILJET_CONFIRMATION_TEMPLATE_ID_PL` / `MAILJET_CONFIRMATION_TEMPLATE_ID_EN` | Yes                    | Polish and English Mailjet templates for auth confirmation emails; each receives only `confirmation_url`.                          |
| `MAILJET_ACCOUNT_DELETION_CONFIRMATION_TEMPLATE_ID_PL` / `_EN`                | Yes                    | Localized account-deletion owner-verification templates; each receives `confirmation_url`.                                         |
| `MAILJET_ACCOUNT_DELETION_REQUEST_TEMPLATE_ID_PL`                             | Yes                    | Polish administrator request template with request details, server-escaped `account_email` and `request_message`, and `admin_url`. |
| `MAILJET_ACCOUNT_DELETION_COMPLETED_TEMPLATE_ID_PL` / `_EN`                   | Yes                    | Localized account-deletion completion templates with no merge variables.                                                           |
| `MAILJET_WAITLIST_LIST_ID`                                                    | Yes for waitlist       | Mailjet contact list used for waitlist contacts                                                                                    |
| `MAILJET_WAITLIST_PHONE_PROPERTY`                                             | No                     | Defaults to `phone`; Mailjet static contact property                                                                               |
| `WAITLIST_SIGNUP_SECRET`                                                      | Yes for waitlist       | Shared secret expected from the landing proxy                                                                                      |
| `WAITLIST_STRIPE_COUPON_ID`                                                   | Yes for waitlist       | Stripe Coupon ID for the 20% first-invoice discount                                                                                |
| `WAITLIST_CODE_PREFIX`                                                        | No                     | Defaults to `WAIT`                                                                                                                 |
| `WAITLIST_MAILJET_TEMPLATE_ID_PL` / `_EN`                                     | Yes for waitlist       | Localized waitlist templates receiving `discount_percent` and `discount_code`                                                      |
| `MAILJET_CONVERSATION_ESCALATED_TEMPLATE_ID_PL` / `_EN`                       | Yes for notifications  | Localized escalation templates receiving `url` and `reason`                                                                        |
| `MAILJET_USAGE_LIMIT_REACHED_TEMPLATE_ID_PL` / `_EN`                          | Yes for notifications  | Localized limit templates receiving `replies_sent`, `reply_limit`, `current_period_end`, and `url`                                 |
| `NOTIFICATIONS_ENABLED`                                                       | No                     | Defaults to `true`; set `false` to suppress notification event and delivery creation                                               |
| `NOTIFICATIONS_APP_BASE_URL`                                                  | Required in production | Absolute HTTPS frontend origin for notification action links, e.g. `https://app.example.com`                                       |
| `OPENROUTER_API_KEY`                                                          | Yes                    | Required by the AI workflows                                                                                                       |
| `OPENROUTER_MANAGEMENT_KEY`                                                   | No                     | Optional                                                                                                                           |
| `OPENROUTER_API_KEY_ID`                                                       | No                     | Optional                                                                                                                           |
| `ALLEGRO_CLIENT_ID`                                                           | Yes                    | Allegro app client id                                                                                                              |
| `ALLEGRO_CLIENT_SECRET`                                                       | Yes                    | Allegro app client secret                                                                                                          |
| `ALLEGRO_REDIRECT_URI`                                                        | Yes                    | `https://api.example.com/api/allegro/auth/callback/`                                                                               |
| `ALLEGRO_DEEP_LINK_BASE`                                                      | Yes                    | `https://app.example.com/allegro-auth`                                                                                             |
| `ALLEGRO_ENV`                                                                 | Yes                    | Usually `production`                                                                                                               |
| `OLLAMA_BASE_URL`                                                             | No                     | Leave empty to use regex+NLP fallback                                                                                              |
| `OLLAMA_MODEL`                                                                | No                     | Defaults to Bielik model                                                                                                           |
| `SECURE_SSL_REDIRECT`                                                         | No                     | Defaults to `True`                                                                                                                 |
| `SESSION_COOKIE_SECURE`                                                       | No                     | Defaults to `True`                                                                                                                 |
| `CSRF_COOKIE_SECURE`                                                          | No                     | Defaults to `True`                                                                                                                 |
| `SECURE_HSTS_SECONDS`                                                         | No                     | Defaults to `3600`                                                                                                                 |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS`                                              | No                     | Defaults to `True`                                                                                                                 |
| `SECURE_HSTS_PRELOAD`                                                         | No                     | Defaults to `True`                                                                                                                 |
| `SECURE_CONTENT_TYPE_NOSNIFF`                                                 | No                     | Defaults to `True`                                                                                                                 |
| `USE_X_FORWARDED_HOST`                                                        | No                     | Defaults to `True`                                                                                                                 |

### 3. Frontend App

- Type: `Application`
- Build Pack: `Dockerfile`
- Base Directory: `frontend`
- Dockerfile: `Dockerfile`
- Public Domain: `https://app.example.com`
- Exposed Port: `80`
- Enable: `Inject Build Args to Dockerfile`

Frontend variables are **build-time** values. Changing them requires rebuilding and redeploying the frontend image.

Frontend build variables:

| Variable                        | Required                    | Example / Notes                                                               |
| ------------------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_BASE_URL`      | Yes                         | `https://api.example.com`                                                     |
| `EXPO_PUBLIC_SUPABASE_URL`      | Yes unless auth is disabled | Production: self-hosted Kong URL; dev: `https://your-project-ref.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes unless auth is disabled | Public anon key                                                               |
| `EXPO_PUBLIC_DISABLE_AUTH`      | Yes                         | `false` or `true`                                                             |

The frontend app version is read from `frontend/package.json`.

## Dependency Updates

Dependabot monitors the app's npm, pip, Docker, and GitHub Actions dependency
surfaces. Its pull requests target the `dev` branch.

## Frontend CI

Frontend CI runs for frontend-relevant pull requests targeting `dev` or `main`.
Push runs are limited to `dev` and `main` to avoid duplicate feature-branch
checks when the same commit is already covered by a pull request run.

## Domain And OAuth Values

With the recommended subdomain layout:

- Frontend: `https://app.example.com`
- Backend: `https://api.example.com`
- Backend API base URL in frontend: `EXPO_PUBLIC_API_BASE_URL=https://api.example.com`
- Allegro callback registered in Allegro Developer Portal: `https://api.example.com/api/allegro/auth/callback/`
- Allegro post-login redirect back to frontend: `https://app.example.com/allegro-auth`

## Verification Checklist

After deployment:

1. Open `https://app.example.com` and confirm the frontend loads.
2. Open `https://api.example.com/healthz/` and confirm it returns HTTP `200`.
3. Refresh frontend routes such as `/dashboard` and `/allegro-auth` and confirm they still resolve.
4. Verify frontend API requests reach `https://api.example.com`.
5. Complete the Allegro OAuth flow and confirm the callback lands on the backend and returns to the frontend.
6. Confirm uploaded media and collected static files are served correctly through backend `nginx`.
7. Confirm Celery workers connect to Redis and background jobs run.

## Local Validation Before Shipping

```bash
# Backend compose validation
cd backend
set -a
source ./.env.prod.example
set +a
docker compose -f docker-compose.prod.yml config
```

```bash
# Django production checks
cd backend/src
set -a
source ../.env.prod.example
set +a
python manage.py check --deploy
```

```bash
# Frontend image build
cd frontend
docker build \
  --build-arg EXPO_PUBLIC_API_BASE_URL=https://api.example.com \
  --build-arg EXPO_PUBLIC_SUPABASE_URL=https://supabase.example.com \
  --build-arg EXPO_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key \
  --build-arg EXPO_PUBLIC_DISABLE_AUTH=false \
  -t superseller-frontend .
```

Ollama is intentionally not included in the default production stack. If you want Bielik auditing in production later, deploy Ollama separately and set `OLLAMA_BASE_URL` to that service.

---

# 📊 Future Extensions (Not MVP)

- Learning from human escalations (with approval)
- Performance analytics dashboard
- Multi-marketplace support
- Fine-tuned routing model
- Smart pricing negotiation assistant (restricted)

---

# 🚀 MVP Scope

Must include:

- Allegro OAuth integration
- Message ingestion
- Global KB upload
- Product-level overrides
- Rules engine
- PII scrubber
- RAG generation
- Confidence gate
- Escalation logic
- Audit logging
- AI disclosure footer

Anything outside this is non-MVP.

---

# 🧨 What This System Is NOT

- Not a creative chatbot.
- Not a sales copy generator.
- Not a general-purpose LLM wrapper.
- Not allowed to operate autonomously without constraints.

This is a controlled decision system for customer communication.

---

# 🏁 Success Criteria

The system is successful when:

- 70–90% of messages are auto-handled safely.
- No hallucinated policies occur.
- No personal data leaks to LLM.
- No regulatory violations.
- Human operators trust the system.

---

# License

Proprietary – Internal Startup Project.

# Citations

[1] [Migrated source document](../../README.md)
