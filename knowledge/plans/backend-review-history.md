---
type: Historical Plan
title: Backend Review History and Remaining Debt
description: Chronological record of the phased backend review, its decisions, fixes, test baselines, and deferred debt.
resource: /plans/backend-review-history.md
tags: [backend, review, history, debt]
status: historical
owner: backend
source_paths:
  - backend/BACKEND_REVIEW_NOTES.md
last_reviewed: 2026-07-11
timestamp: 2026-07-11
---

# Backend review history

This is a historical review record, not the canonical source for current agent
rules. Use [Backend Agent Rules](../backend/agent-rules.md) for active rules and
verify unresolved debt against the current code before acting on it.

## Review-wide decisions (2026-07-07)

- API errors use a stable `{code, message}` shape and domain-prefixed error
  codes. Contract changes are recorded in the [Frontend API Contract
  Changelog](../frontend/api-contract-changelog.md).
- Tests use Django `TestCase`/`APIClient` and pytest-django against real
  PostgreSQL. Mock only external services, never the database.
- Assert error codes rather than message text. Target coverage was at least 85%
  per module, with the full suite reported after each phase.
- Code, identifiers, comments, docstrings, and error codes are English. At the
  time, user-facing messages were intentionally Polish.
- Use timezone-aware datetimes, Django migrations, and minimal comments that
  explain non-obvious reasoning. Avoid speculative refactors during a phase.

## Review phases

1. Test infrastructure, configuration, and authentication.
2. Allegro integration and the autoresponder.
3. AI client/audit, DRE, RAG, and PII scrubbing.
4. Billing, onboarding, notifications, post-purchase, referrals, simulator,
   waitlist, and feedback.
5. Production hardening, end-to-end verification, and CI/coverage gating.

## Delivered review outcomes

- The test suite moved to pytest-django and PostgreSQL with migrations enabled;
  real external API calls and global test patches were removed.
- Production configuration was hardened with fail-fast required environment
  variables, explicit `DEBUG`, Stripe webhook validation, and safe timeouts.
- Authentication received uniform anti-enumeration responses, Celery email
  delivery, and global typed domain errors.
- Allegro token handling was made user-scoped, encrypted, refresh-safe, and
  resilient to transient provider failures. Views were split into focused
  modules and error contracts were standardized.
- Autoresponder configuration and scan scheduling gained transactional locking,
  per-user deduplication, documented segmentation settings, and focused tests.
- PII scrubbing fixed validated IBAN/NRB masking, placeholder preservation, and
  disabled-LLM-audit handling. RAG received upload limits, document-version
  locking, and test coverage.
- The DRE, billing, referral, notification, and simulator work was reviewed for
  contracts, safety, and testability. The final baseline was expected to be
  fully green after the PII fixes.

## Historical deferred debt

- Batch RAG embeddings and paginate document-detail fragments.
- Replace full message-thread scans with cheaper Allegro event-driven work if
  feasible.
- Move internal audit analytics from the hidden customer frontend route into
  Django admin.
- Revisit anonymous `status`/`disconnect` endpoints and the module ownership of
  intent classification.

## Phase 11: Billing and onboarding (2026-07-26)

- Stripe webhook hardened against out-of-order/duplicate events: entitlements
  track `last_event_created` and ignore stale subscription/invoice events, so a
  delayed `subscription.updated` can no longer resurrect a canceled
  subscription. All entitlement mutations run inside
  `transaction.atomic()` + `select_for_update`.
- Product KB generation moved from a synchronous HTTP request to a Celery task
  (`202` + polling contract with `product_kb_in_progress` /
  `product_kb_started_at`; idempotent re-POST, 15-minute stale-task recovery,
  failures land in `state.last_error`).
- Billing and onboarding errors moved to the global `{code, message}` contract
  with Polish user-facing messages (`billing.*` / `onboarding.*` codes); the
  Stripe webhook keeps `{"detail"}` because Stripe is its consumer. Raw Stripe
  exception text is no longer leaked in 5xx responses.
- Onboarding state polling slimmed to a single observe pass with one aggregate
  count query; KB document versioning unified behind the locked
  `rag.services.next_document_version`; incomplete Stripe plan prices are no
  longer cached; message packs now count until their original period end date,
  so a mid-period plan upgrade cannot void a paid pack (user decision).

## Phase 12: Notifications (2026-07-28)

- Push notifications are now localized from `NotificationPreference.language`
  (Polish users were getting English pushes despite localized email templates),
  and the usage-limit copy states explicitly that new buyer messages are left
  unanswered (closes the phase-6 follow-up); the event `url` deep-links to
  `/messages` (with `threadId` when known) instead of `/settings`.
- Transient provider failures (Mailjet/network/Expo batch transport) are
  retried with backoff (60 s, 300 s; max 3 attempts) before a delivery is
  marked failed; permanent endpoint problems still resolve to skipped/disabled.
- Fixed Expo receipt reconciliation deadlock: resolved receipts (ok or error)
  now clear `provider_receipt_id`, so old rows no longer permanently occupy the
  100-row scan batch and block new receipts from ever being checked.
- Mailjet template requirement recorded for the operator: usage-limit templates
  must clearly say messages are not handled automatically.

## Phase 13 (part A): Postbuy, referral, simulator (2026-07-28)

- Postbuy scan is poison-proof: a failing `get_order` for one event records a
  visible FAILED message (with the fetch error) and the cursor moves past it,
  instead of aborting the scan and re-hitting the same event forever while all
  later orders wait; unexpected per-event errors are also isolated in the task
  loop. Stuck PENDING messages (worker died between create and send; dedup
  would silently block the order forever) are swept to FAILED by the dispatch
  task after 1 hour.
- Simulator chat now has cost throttles (user decision: `10/minute` +
  `100/day`, env-overridable via `SIMULATOR_CHAT_RATE` /
  `SIMULATOR_CHAT_DAILY_RATE`) - the simulator intentionally bypasses
  subscriptions, so throttling is the only cost barrier for unpaid accounts.
- Referral reward fix (revised after user decision on 2026-07-28): monthly
  rewards keep the Stripe coupon (`STRIPE_REFERRAL_REFERRER_COUPON_ID`, 100%
  off), but the bug where `Subscription.modify(discounts=[coupon])` replaced
  the whole discounts list is fixed - existing discounts (e.g. waitlist or an
  earlier reward) are read from the subscription and re-attached alongside the
  new coupon (Stripe supports up to 3 stacked discounts). Yearly plans keep
  the one-month balance credit as before (a 100% coupon would cover the whole
  yearly invoice). An interim balance-credit-for-monthly variant was
  implemented and reverted the same day - coupons are the product's intended
  mechanism.

### Phase 13 (part B/C/D)

- B1: postbuy, referral, simulator, waitlist, and feedback moved to the global
  `{code, message}` contract with Polish messages - the entire backend now
  shares one error shape (codes listed in the frontend API contract
  changelog). Stripe/Allegro/simulator exception text no longer leaks to
  clients (fixed 4xx/5xx messages, details logged). Postbuy template
  validation messages translated to Polish.
- B2: `GET /api/postbuy/messages/` validates `offset`/`limit`
  (`postbuy.invalid_pagination` 400 instead of an unhandled 500).
- C: code assertions added/updated across the five modules (referral redeem,
  feedback unavailable, postbuy pro_required + pagination, waitlist invalid
  secret, simulator message_required).

### Deferred (user request, 2026-07-28)

- Simulator abuse signal: detect accounts with high simulator usage that still
  have no subscription (competitor probing / cost abuse). Data already exists
  in `ai_audit.ConversationRun` (`execution_mode=simulator`) - needs an
  aggregate + surfacing (Django admin report or periodic alert). Owner: phase
  14 or a product task.

## Phase 14: Production hardening, CI gates, admin (2026-07-28)

Recon found the infra healthier than planned: upstream had already restored
GitHub Actions CI (ruff, pytest, migration checks, Coolify deploy), made all
Mailjet/Stripe/deletion secrets required in the prod compose, and closed the
phase-2 Mailjet debt (`PRODUCTION_REQUIRED_ENV` includes the templates).
Remaining fixes delivered:

- A1: nginx no longer serves `/media/` publicly - it exposed sellers' KB
  documents (`kb/global/...`) and AI audit exports (`audit/exports/`) to
  anyone with the URL. Audit export downloads go through the authenticated
  staff-only `GET /api/audit/exports/{id}/download/` (FileResponse, 404 for
  missing/expired files); `download_url` in the detail payload points there.
  KB files need no URL at all. The nginx media volume mount was removed.
- B1: CI test step enforces a coverage gate (`--cov --cov-fail-under=80`;
  measured baseline on 2026-07-28 was 85.3% with 740 tests passing).
- B2: new CI job builds the production Docker stage and runs
  `manage.py check --deploy --fail-level ERROR` inside it with a fake env
  covering `PRODUCTION_REQUIRED_ENV` - a new required setting without a CI
  update fails visibly. The deploy job now needs both verify and the image
  job.
- B4: `lintmigrations` compares against `github.event.before` (falling back to
  merge-base) instead of `origin/main`, which on a main push pointed at HEAD
  and linted nothing.
- B3 (env cleanup of `STRIPE_REFERRAL_REFERRER_COUPON_ID`) was withdrawn -
  the coupon is used again after the referral reward revert.
- D1: Django admin added for billing (entitlements, message packs), onboarding
  (state, product KB statuses), postbuy (config, rules, messages), and
  feedback reports - previously incidents required raw SQL for these apps.
- C: export download tests (staff gets the streamed file, non-staff 403,
  missing file 404, `download_url` shape).

# Provenance

Condensed and translated from the legacy Polish review notes on 2026-07-25.
