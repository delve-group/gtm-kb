---
type: Historical Plan
title: Native Django Auth Backend Migration Plan
description: Historical plan for the native Django auth migration.
resource: /plans/native-django-auth-migration.md
tags: [plan, auth, historical]
status: historical
owner: project
source_paths:
  - AUTH_MIGRATION_PLAN.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# Native Django Auth Backend Plan

## File Output
- This plan was originally saved at `superseller/AUTH_MIGRATION_PLAN.md`; the canonical migrated copy is this OKF concept.
- Root repo guidance is stored in `superseller/AGENTS.md`; `frontend/AGENTS.md` stays untouched.

## Summary
- Clean-slate migration: no Supabase Auth user migration.
- Use Django `auth.User`, allauth `EmailAddress`, PostgreSQL, Mailjet via Django Anymail, and SimpleJWT access/refresh tokens.
- Phase 1 implements email/password signup, mandatory email confirmation, login, refresh, logout, `/me`, Docker dev/prod config, and unit/API tests using TDD.

## Data Structures
- Keep default Django `auth.User`; login by email only.
- Use allauth `account_emailaddress` for verified/primary email state.
- Use SimpleJWT blacklist tables: `OutstandingToken` and `BlacklistedToken`.
- Remove `UserProfile`, Supabase auth backends, Supabase helper module, Supabase env vars, and Supabase management command overrides.
- Update billing lookup to use `django_user_id`, `client_reference_id`, and email only.

## Backend Patterns
- Add `authentication/serializers.py` for register, login, confirm email, resend, logout, and user payloads.
- Add `authentication/services.py` for email normalization, user creation, allauth confirmation email sending, key confirmation, verified-login checks, token issuance, and refresh blacklist.
- Keep DRF views thin; serializers validate input, services own behavior.
- Add `django-allauth`, `djangorestframework-simplejwt`, and `django-anymail[mailjet]`.
- Configure allauth email-only login and SimpleJWT refresh rotation/blacklisting.

## Mailjet Email
- Use Anymail's Mailjet backend:
  - `INSTALLED_APPS += ["anymail"]`
  - `EMAIL_BACKEND = "anymail.backends.mailjet.EmailBackend"`
  - `ANYMAIL = {"MAILJET_API_KEY": ..., "MAILJET_SECRET_KEY": ...}`
  - `DEFAULT_FROM_EMAIL = MAILJET_FROM_EMAIL`
- Add env vars:
  - `MAILJET_API_KEY`
  - `MAILJET_SECRET_KEY`
  - `MAILJET_FROM_EMAIL`
  - `MAILJET_REPLY_TO_EMAIL` optional
- Use Django locmem/test email backend in `allegrobot.test_settings` so unit tests assert `mail.outbox` without network calls.

## API
- `POST /api/auth/register/` returns `202`; creates user and sends confirmation email, no tokens.
- `POST /api/auth/confirm-email/` confirms key and returns `{ access, refresh, user }`.
- `POST /api/auth/login/` returns tokens only for verified users; unverified users get `403 { code: "email_not_verified" }`.
- `POST /api/auth/token/refresh/` uses SimpleJWT refresh.
- `POST /api/auth/logout/` blacklists refresh token.
- `POST /api/auth/resend-verification/` always returns `202`.
- `GET /api/auth/me/` returns `id`, `email`, `is_staff`, `is_email_verified`.

## Docker Compose
- Dev `backend/docker-compose.yml`:
  - add `postgres:16-alpine` with healthcheck and `postgres_data`
  - set backend `DATABASE_URL=postgresql://allegro:allegro@postgres:5432/allegro`
  - make `web`, `celery`, and `celery-beat` depend on healthy `postgres` and `redis`
  - remove Supabase env expectations
- Prod `backend/docker-compose.prod.yml`:
  - add in-compose `postgres:16-alpine` with persistent `postgres_data`
  - still pass `DATABASE_URL` to Django, constructed as `postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}`
  - require `POSTGRES_PASSWORD`; default `POSTGRES_USER=allegro`, `POSTGRES_DB=allegro`
  - make app services depend on healthy `postgres` and `redis`
  - remove Supabase env vars
  - add Mailjet env vars and keep `FRONTEND_BASE_URL`, JWT, Allegro, Redis, static/media, nginx, and backup config
  - update `db-backup` to use the same `DATABASE_URL` and add the missing `Dockerfile.backup`
- Update `entrypoint.sh` to wait for database readiness before migrations/checks.

## TDD And Tests
- Add to `AGENTS.md`:

```md
## Backend TDD
- For backend behavior changes, write failing tests before implementation.
- Use red/green slices: add one focused failing test or small failing group, run the targeted Django test command, implement the minimum code, then rerun until green.
- Prefer Django `TestCase` and DRF `APIClient` for backend API behavior; isolate pure logic in service tests.
- Do not finish auth/backend work without running the new targeted tests and impacted app tests.
```

- Add `authentication/tests/` covering serializers, services, and API flows.
- Add billing tests proving Supabase lookup is gone.
- Update protected-view tests that now return `401` under SimpleJWT.
- Validate Docker with:
  - `docker compose -f backend/docker-compose.yml config`
  - `docker compose -f backend/docker-compose.prod.yml config`

## Assumptions
- Production PostgreSQL runs inside Compose but Django still reads only `DATABASE_URL`.
- Frontend token storage migration follows `{access, refresh, user}`.
- Passwordless, Google OAuth, and Allegro OAuth are later phases.


# Provenance

Migrated from legacy path `AUTH_MIGRATION_PLAN.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
