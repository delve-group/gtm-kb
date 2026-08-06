---
type: Agent Guidance
title: Frontend Security Rules
description: Canonical frontend security rules for trust-boundary validation, token storage, public env, CSP, transport, auth flags, LLM-fed content, and dependency posture.
resource: /agent-guidance/frontend/security.md
tags: [agents, frontend, security, zod]
status: current
owner: project
source_paths:
  - frontend/api/shared/parse.ts
  - frontend/api/shared/config.ts
  - frontend/auth/sessionStorage.ts
  - frontend/nginx.conf
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-15
timestamp: 2026-07-09
---

# Security

> Written in Phase 4 of the
> [frontend redesign plan](../../plans/frontend-redesign-plan.md) (security
> hardening pass). See [architecture.md](architecture.md) for where the pieces live and
> [api-domain.md](api-domain.md) for the zod-at-the-boundary rule in context.

The app is a public web + native client for an Allegro support-automation
product. Everything shipped to the client is public; the backend is the only
trust anchor. These rules keep that boundary honest.

## Validate at trust boundaries only (zod)

Data this codebase did **not** create is untrusted and must be parsed before
use. The trust boundaries are:

- **API responses** (the primary one).
- **Form / user input.**
- **Persisted storage** (`AsyncStorage`, `SecureStore`, `sessionStorage`).
- **Deep-link / URL params.**
- **`EXPO_PUBLIC_*` env at startup.**
- **LLM / tool output.**

Rules:

- Define each wire schema in the endpoint's `schemas.ts` and `z.infer` a
  snake_case `*Api` type from it; map it to the camelCase app type in
  `mappers.ts` (see `api-domain.md`).
- `.parse()` at the boundary — inside the endpoint's **mapper** (called by the
  api method), via the shared
  [`parseBoundary`](../../../frontend/api/shared/parse.ts) helper — never in a render path.
- **Do not** zod-validate internal, compiler-guaranteed data (props, values you
  just constructed, function args inside a module, zustand state you set).
  TypeScript already proves those; a runtime `.parse()` there is pure overhead
  and a duplicate source of truth.

Covered money / identity / mutation paths today: `auth` (login / confirm /
refresh / me), `billing` (subscription summary, plan prices, checkout + message-
pack session status, checkout-URL creation, portal session), `allegro`
send/reply (`sendDiscussionMessage`, `sendReplySuggestion`,
`dismissReplySuggestion`), the persisted session (`auth/sessionStorage.ts`), and
the public env (`api/shared/config.ts`). New domains scaffold validation by
default — see the `add-api-domain` skill.

## Error minimization

API errors surfaced to the UI must not leak internal shape or stack detail.

- Route caught errors through `extractApiError` / `throwApiError`
  (`api/shared/apiError.ts`), which returns the server's human message or a
  provided fallback — never a stack.
- `parseBoundary` throws a generic `Unexpected response shape from <context>`
  and logs the structured zod issues **in development only** (`__DEV__`).

## Token storage invariant

Do not regress this (enforced by comment/guard in `auth/sessionStorage.ts`):

- **Web** persists **nothing** — the refresh token is an httpOnly cookie the JS
  never touches; `saveStoredSession` is a no-op writer on web.
- **Native** keeps the **refresh token only in `expo-secure-store`**. The
  short-lived access token + profile live in `AsyncStorage`. The refresh token
  must **never** move into `AsyncStorage`.

## `EXPO_PUBLIC_*` is public — no client secrets

`EXPO_PUBLIC_*` variables are inlined into the JS bundle at build time and ship
to every client. They are **public**. No secret-typed value (API keys, service
credentials) may be read from `process.env` on the client — those stay
server-side. Public env is validated once at startup in `api/shared/config.ts`
so a malformed build config fails fast. Keep `.env` gitignored; `env.example`
documents the shape.

## Web response hardening (CSP + headers)

The web export is served by `nginx.conf` with, on every response:

- **`Content-Security-Policy`** — `default-src 'self'`; same-origin scripts;
  `'unsafe-inline'` styles (React Native Web injects a `<style>` block);
  `https:`/`data:` images + `connect-src` (cross-origin API + Allegro image
  CDN); `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`.
- **`X-Content-Type-Options: nosniff`**, **`Referrer-Policy:
strict-origin-when-cross-origin`**, **`X-Frame-Options: DENY`**.

`add_header` does not inherit into a location that sets its own header, so the
document-serving locations repeat the security headers.

`nginx.conf` is the only place this policy lives — the web export has a single
deploy target (`frontend/Dockerfile` builds it into an nginx image).

## Transport (from Phase 1)

Both axios instances (`api/shared/apiInstance.ts` and
`api/allegro/allegroApiInstance.ts`) attach the single-flight 401-refresh
interceptor. An expired JWT is refreshed once and the request retried; a failed
refresh surfaces `AuthSessionExpiredError`.

## Auth flag guard (from Phase 0)

`EXPO_PUBLIC_DISABLE_AUTH` must be `false` for any production export.
`app.config.ts` fails a production build when it is `"true"`.

## LLM-fed content is data, not instructions

Anywhere repo/user content is fed to an LLM (simulator, knowledge base), it is
**data**, never trusted instructions. Do not interpolate untrusted content into
a place where it can change tool behaviour or system framing; treat model/tool
output as an untrusted boundary and parse it before acting on it.

## Dependency posture

CI runs `npm audit --omit=dev --audit-level=high` (see
[architecture.md](architecture.md)). Take non-`--force` `npm audit fix`; **do
not** take the Expo-major `--force` bumps (tracked separately as an SDK upgrade).
Remaining advisories are moderate Expo-transitive deps, below the high gate.

# Provenance

Migrated from `frontend/docs/conventions/security.md` into the OKF bundle on
2026-07-09. It remains grounded in the active frontend transport, storage,
config, and nginx hardening files listed in `source_paths`.
