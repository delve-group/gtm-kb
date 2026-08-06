---
type: Frontend Guidance
title: Frontend API Contract Changelog
description: Backend-to-frontend API contract changes recorded during the phased backend review.
resource: /frontend/api-contract-changelog.md
tags: [frontend, backend, api, contracts, changelog]
status: current
owner: frontend
source_paths:
  - backend/CHANGELOG_FRONTEND.md
last_reviewed: 2026-07-27
timestamp: 2026-07-27
---

# API Contract Changelog (Frontend)

Record of backend-to-frontend contract changes made during review. The target
error format is `{code, message}`: a stable `code` and a Polish `message`. Add
new contract changes here.

## Simulator and AI audit parity (2026-07-27)

- Simulator favorite detail/create payloads include optional `offer_id`.
  Selecting an offer enables offer-specific plus global knowledge; an empty
  value keeps retrieval global-only.
- Simulator trace payloads include `action`, `decision`, detailed `reason`,
  `escalation_reason`, `offer_id`, `used_fragment_ids`, and `kb_evidence`.
  Frontend validation supplies compatibility defaults for traces produced by an
  older backend.
- AI-audit run summaries include
  `execution_mode: "production" | "simulator"`. Run filters, exports, and usage
  summaries accept the same field; `group_by=execution_mode` is supported.
  Missing values from older records or payloads are interpreted as
  `production`.
- Escalations can use the new `generation_failed` category after an invalid
  model response or retryable dependency failure exhausts the three-attempt
  budget.

## Registration (2026-07-25)

`POST /api/auth/register/` and `POST /api/auth/resend-verification/` accept an
optional `language: "pl" | "en"` (default: `"pl"`). The selected language
chooses the localized Mailjet account-confirmation template.

## Notification and waitlist language (2026-07-25)

- `POST /api/waitlist/signup/` accepts `language: "pl" | "en"` (default:
  `"pl"`). The language is stored with the signup and chooses the localized
  discount-code email template.
- `GET` and `PATCH /api/notifications/preferences/` return and accept
  `language: "pl" | "en"`. The setting chooses Mailjet templates for
  conversation escalation and the reply-limit notification.

## Global (2026-07-08)

**New API error format — all endpoints.** Each error now returns:

```json
{ "code": "auth.invalid_credentials", "message": "Invalid email or password." }
```

Serializer validation errors also include `fields` (the original per-field error map):

```json
{ "code": "validation_error", "message": "Enter a valid email address.", "fields": { "email": ["..."] } }
```

**The `detail` field no longer exists.** `api/shared/apiError.ts` reads
`data.message`, `data.detail`, and `data.error`. Always route by `code`, never
by `message` text.

## Auth (2026-07-08)

- Error codes gained the `auth.` prefix: `auth.invalid_email`, `auth.invalid_key`, `auth.invalid_password`, `auth.invalid_credentials`, `auth.inactive_user`, `auth.email_not_verified`, `auth.invalid_refresh`.
- `email_already_registered` was removed: a registration race now returns the same `202` as every other path.
- `POST /api/auth/login/` with invalid credentials: **400 → 401** (`auth.invalid_credentials`).
- Auth error messages were translated into Polish.
- Confirmation email is sent asynchronously through Celery. Registration returns 202 before email delivery; the contract is unchanged, but delivery can be delayed.
- With `LANGUAGE_CODE='pl'`, built-in Django/DRF validation messages (for example password requirements and "This field is required") arrive in Polish in `message`/`fields`.

## Auth — account deletion (2026-07-15)

- `POST /api/auth/account-deletion-requests/` is the server endpoint for the
  landing proxy. It requires `X-Account-Deletion-Secret`, accepts `email`, an
  optional `message`, `source`, and `language: "pl" | "en"` (default: `"pl"`),
  and always returns `202 {"status":"confirmation_sent_if_account_exists"}` for
  a valid form, regardless of whether the account exists.
- `POST /api/auth/account-deletion-requests/confirm/` requires the same header
  and a `token` field. Success returns `200 {"status":"verified"}`; an invalid,
  superseded, or expired token returns `400 auth.deletion_token_invalid`.
- A missing or invalid proxy secret returns `403 auth.deletion_proxy_forbidden`.
  Both endpoints have independent IP and identifier limits.
- The Expo app never calls these endpoints directly. Settings opens the public
  form, while secrets remain server-side only.

## Allegro (2026-07-08)

- New error codes (global `{code, message}` format): `allegro.not_connected` (403; no/dead connection, previously a Polish `detail`), `allegro.token_invalid` (403), `allegro.forbidden` (403), `allegro.not_found` (404), `allegro.rate_limited` (429 + `Retry-After` header), `allegro.api_error` (502), and `external.unavailable` (503; backend-side network error).
- Invalid `offset`/`limit` parameters (for example, non-numeric values) return 400 `validation_error` instead of 500; `limit` is capped at 100 (messages: 20).
- Allegro list/detail endpoints return structured 403 responses instead of 500 when authorization is broken.
- Allegro tokens are now resolved per user, not browser session; session is onboarding fallback only.
- 404/400 codes instead of `{'detail'}`: `allegro.session_not_found` (DELETE /auth/{id}/revoke/), `allegro.suggestion_not_found` and `allegro.text_required` (suggestion send/dismiss), and `allegro.escalation_not_found` and `allegro.no_bot_suggestion` (escalations).
- POST /discussions/{id}/messages/ with empty or missing `text` returns `validation_error` + `fields` rather than raw serializer errors.

## Allegro (2026-07-09)

- The OAuth callback blocks an Allegro account whose ID is persistently assigned to another app user. The deep link returns `status=error`, `error=allegro.account_already_assigned`, and a Polish `error_description`.
- `POST /api/allegro/auth/disconnect/` disconnects the access token but does not release the persistent Allegro ID assignment. Only support/admin can release it.
- `GET /api/allegro/auth/status/` can return `account` from the persisted Allegro account profile instead of fetching `/me` on every request.
- `GET /api/allegro/auth/status/` and `POST /api/allegro/auth/disconnect/` no longer use a session-cookie Allegro token if it belongs to another signed-in user. Status prefers the current user's token; disconnect removes only the current user's or an unowned session token.

## Allegro (2026-07-10)

- `GET /api/allegro/auth/url/` returns the web `redirectUrl` (`{FRONTEND_BASE_URL}/allegro-auth`) and stores it in signed OAuth `state` when the request comes from the web frontend. OAuth callback errors, including `allegro.account_already_assigned`, therefore return to the active Settings/Onboarding screen instead of the `frontend://...` custom scheme.
- The HTML OAuth callback now preserves the error query string as `status=error&error=...`; previously the separator could be stored as `&amp;`, so the frontend did not always recognize `error=allegro.account_already_assigned`.

## Autoresponder (2026-07-09)

- Error codes gained the `autoreply.` prefix and global `{code, message, ...extra}` format:
  - `autoreply.plan_required` (403; previously `plan_required` + `detail`),
  - `autoreply.onboarding_required` (400; previously `onboarding_required`) — `missing_requirements` and `onboarding_url` **remain** alongside `code`/`message`,
  - `autoreply.disabled` (400; previously `{detail: "Enable auto-replies..."}` without a code),
  - `autoreply.scan_cooldown` (429; `retry_at` remains),
  - `autoreply.scan_unavailable` (503).
- **A frontend fix is still required (confirmed 2026-07-11):** `api/allegro/updateAutoReplyConfig/index.ts` compares `data.code === "onboarding_required"`; change it to `"autoreply.onboarding_required"`. `detail` no longer arrives; read `message`.

## Autoresponder (2026-07-10)

- `GET /api/allegro/auto-reply/stats/`: `escalated_last_24h` now counts **actual escalations opened in the last 24 hours** (`EscalatedThread.opened_at`), not every bot refusal. The value can be lower; the field name is unchanged.

## Billing / Onboarding (2026-07-22)

- Wszystkie błędy billingu i onboardingu przeszły na globalny kontrakt
  `{code, message}` (komunikaty PL) zamiast `{"detail": "..."}` (EN).
  Kody billing: `billing.invalid_plan`, `billing.invalid_return_target`,
  `billing.not_configured` (500), `billing.price_not_configured` (500),
  `billing.checkout_failed` (502), `billing.session_ownership` (403),
  `billing.stripe_unavailable` (502), `billing.subscription_required`,
  `billing.not_message_pack_session`, `billing.customer_required`,
  `billing.invalid_portal_flow`, `billing.upgrade_not_allowed`,
  `billing.portal_failed` (502).
  Kody onboarding: `onboarding.payment_required`, `onboarding.allegro_required`,
  `onboarding.invalid_max_offers`, `onboarding.requirements_missing`
  (z dodatkowym polem `missing: string[]` w odpowiedzi).
  Wyjątek: `POST /api/billing/stripe/webhook/` nadal zwraca `{"detail"}` —
  konsumuje go Stripe, nie FE. Odpowiedzi 5xx/502 nie zawierają już surowych
  treści wyjątków Stripe.
- `GET /api/billing/prices/` zwraca dodatkowo `message_pack`
  ({amount, currency, interval} albo null) — FE może renderować cenę pakietu
  dynamicznie zamiast hardkodu; `subscription.message_pack.price_label`
  poprawione na "10 zł" (było "10 zl"). Niekompletny cennik nie jest już
  cache'owany na godzinę.
- `state.last_error` w onboardingu jest teraz po polsku (nadaje się do
  wyświetlenia userowi).
- Semantyka `extra_reply_limit` w `GET /api/billing/subscription/`: dokupione
  pakiety wiadomości liczą się do swojej pierwotnej daty końca okresu (nie
  przepadają przy zmianie planu w środku miesiąca).

- `POST /api/onboarding/generate-product-kb/` działa teraz asynchronicznie:
  zwraca `202` z payloadem stanu (bez pól `generated`/`skipped`/`failed`/
  `needs_review` w odpowiedzi). Generacja idzie przez Celery; postęp śledzić
  pollingiem `GET /api/onboarding/state/` (per-ofertowe `product_statuses`).
- Nowe pola w `GET /api/onboarding/state/`: `product_kb_in_progress` (bool,
  top-level) oraz `state.product_kb_started_at`. Ponowny POST w trakcie
  generacji jest idempotentny (nie kolejkuje drugiego zadania, także `202`).
- Błąd generacji ląduje w `state.last_error`, a `product_kb_in_progress` wraca
  na `false` — FE powinien pokazać komunikat i pozwolić ponowić.

## Billing / Onboarding

- `POST /api/billing/portal-session/` accepts the optional field
  `flow: "upgrade_pro"`. For an active Basic subscription without scheduled
  cancellation, it returns a URL to Stripe-hosted Pro-upgrade confirmation,
  preserving the monthly or yearly billing interval. Other requests still open
  the main Customer Portal.

## Knowledge Builder (2026-07-15)

- All endpoints require JWT Bearer authentication and are isolated per user.
- `POST /api/knowledge-builder/sessions/` accepts required
  `modality: "voice" | "text"`, `transcription_consent: boolean`, and, for
  voice, the current `disclosure_version`. It returns a serialized session and
  `201` for a new session or `200` for a resumed active session. Voice mode
  without consent or with an outdated disclosure returns `400 validation_error`.
  The session also returns calculated `transcription_consent` and
  `required_disclosure_version`; consent is stored as versioned grant/revoke
  events rather than a mutable flag.
- `GET /api/knowledge-builder/sessions/current/` returns
  `{"session": <session|null>}`.
- `GET /api/knowledge-builder/cards/` returns only the current user's cards.
  It supports optional `status` and `topic` filters; an invalid status returns
  `400 validation_error`. Each card includes current revision coordinates:
  `current_revision_id`, `revision_number`, and `content_hash`.
- `POST /api/knowledge-builder/cards/{card_id}/revisions/` creates a proposed
  revision from `base_revision_id` and `base_content_hash`.
- `POST /api/knowledge-builder/revisions/{revision_id}/confirm/` and `/reject/`
  decide the exact content identified by `content_hash`. All three mutations
  require `Idempotency-Key`; retrying the same request is safe, while a stale
  base or reuse of the key for a different payload returns `409`.
- `POST /api/knowledge-builder/sessions/{session_id}/realtime-call/` accepts a
  raw `application/sdp` offer and returns an SDP answer with `201`. Through
  unified WebRTC, the backend creates at most one active session connection,
  binds it to the exact consent event, and stores the provider call ID. Moving
  to text mode records a revoke and requests provider hangup; the client never
  receives the primary key or multiple ephemeral credentials. The endpoint can
  be disabled by configuration and has a dedicated throttle.
- `GET /api/knowledge-builder/readiness/` returns `ready`, `total_p0`,
  `resolved_p0`, and `blockers`.
- `GET /api/knowledge-builder/coverage/` extends readiness with ordered
  `results` for every active P0 requirement. `answered`, `live_lookup`, and
  `escalate` are resolved; `missing`, `conflict`, and `stale` block readiness.
- The frontend already has a typed client, query/mutation hooks, and exportable
  session, coverage, and card views. The view is not yet connected to routing
  or the microphone; activation will ship with the tool-call bridge.

## AI Audit (2026-07-28)

- `download_url` in `GET /api/audit/exports/{id}/` is now the authenticated
  endpoint `/api/audit/exports/{id}/download/` instead of a public `/media/...`
  file URL. The FE must fetch it with the usual auth header (staff-only) and
  save the streamed response - a plain `<a href>` without credentials will get
  401/403. Public `/media/` serving was removed from nginx (KB documents and
  audit exports were downloadable without auth).

## Postbuy / Referral / Simulator / Waitlist / Feedback (2026-07-28)

- The last five modules moved to the global `{code, message}` error contract
  (Polish messages) instead of `{"detail": ...}`. Codes:
  `postbuy.plan_required`, `postbuy.cursor_init_failed`,
  `postbuy.pro_required` (403), `postbuy.rule_not_found` (404),
  `postbuy.invalid_pagination`, `postbuy.invalid_template`;
  `referral.invalid_code`; `simulator.message_required`,
  `simulator.turn_failed` (500); `waitlist.invalid_secret` (403),
  `waitlist.not_configured` (500), `waitlist.delivery_failed` (502),
  `waitlist.invalid_signup`; `feedback.email_required`,
  `feedback.unavailable` (503). The whole backend is now on one error shape.

## Customer-success feedback (2026-08-02)

- `POST /api/feedback/reports/` accepts `kind=customer_success` in addition to
  `bug` and `suggestion`. The request and asynchronous `202 {report_id, status}`
  response shapes are otherwise unchanged.
- Postbuy template validation messages (serializer `fields` and
  `postbuy.invalid_template`) are now Polish (e.g. "Nieznane zmienne
  szablonu: ..."). `GET /api/postbuy/messages/` validates `offset`/`limit`
  (400 instead of 500 on non-numeric values).

## Simulator (2026-07-28)

- `POST /api/simulator/chat/` is rate-limited (default 10/minute and 100/day
  per user) and can now return `429` with a `Retry-After` header; the FE
  should surface a "spróbuj za chwilę" state.

## Notifications (2026-07-28)

- The `usage_limit_reached` event payload (push `data` / email merge data):
  `url` now deep-links to `/messages?threadId=...` (previously `/settings`) so
  the notification opens the unanswered conversation.
- Push notifications (Expo/Web Push) are localized from
  `preferences.language` (PL/EN); the usage-limit copy states explicitly that
  new buyer messages are left unanswered.
- For whoever configures Mailjet templates: the `USAGE_LIMIT_REACHED`
  templates (PL/EN) must clearly say messages are NOT handled automatically
  until the period ends or a message pack is bought; merge data:
  `replies_sent`, `reply_limit`, `current_period_end`, `url`.

## RAG / Knowledge Base (2026-07-10)

- Upload and 404 errors use the global `{code, message}` format instead of
  `{'error': ...}`: `rag.file_required`, `rag.unsupported_file_type`,
  `rag.file_too_large` (new 10 MB limit), and `rag.document_not_found`.

## Other

(no changes)
