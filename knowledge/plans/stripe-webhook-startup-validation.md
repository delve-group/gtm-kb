---
type: Design Plan
title: Stripe Webhook Startup Validation
description: Fail-fast design for requiring Stripe webhook configuration locally and verifying the registered endpoint in production.
resource: /plans/stripe-webhook-startup-validation.md
tags: [stripe, billing, webhooks, startup, operations]
status: implemented
owner: backend
source_paths:
  - backend/src/allegrobot/settings.py
  - backend/src/billing/management/commands/verify_stripe_webhook.py
  - backend/scripts/entrypoint.sh
last_reviewed: 2026-07-13
timestamp: 2026-07-13
---

# Stripe webhook startup validation

When Stripe billing is disabled, API startup remains independent of Stripe.
When `STRIPE_SECRET_KEY` is configured, Django settings require a non-placeholder
`whsec_...` signing secret in every environment.

The production web container additionally retrieves the configured Dashboard
webhook endpoint before launching the API. Startup succeeds only when the
endpoint belongs to the account selected by the API key, has the expected
test/live mode, is enabled, uses the exact configured public URL, and subscribes
to every billing event handled by the backend. Network or Stripe API failures are
fail-closed. Celery processes do not repeat the remote check.

Local Stripe CLI forwarding intentionally skips remote endpoint retrieval because
the CLI listener is not a Dashboard-managed endpoint. Stripe does not expose an
existing endpoint's signing secret through its API, so successful verification of
an incoming signed event remains the only proof that the configured secret itself
matches.
