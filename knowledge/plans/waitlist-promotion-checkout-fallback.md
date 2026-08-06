---
type: Design Plan
title: Waitlist Promotion Checkout Fallback
description: Fail-open subscription checkout behavior for stale automatic waitlist promotion codes.
resource: /plans/waitlist-promotion-checkout-fallback.md
tags: [backend, billing, stripe, waitlist, checkout]
status: implemented
owner: backend
source_paths:
  - backend/src/billing/views.py
  - backend/src/waitlist/services.py
  - backend/src/waitlist/tests.py
last_reviewed: 2026-07-14
timestamp: 2026-07-14
---

# Waitlist promotion checkout fallback

Subscription checkout first attempts to apply an eligible waitlist promotion
code. If Stripe specifically reports that `discounts[0][promotion_code]` is a
missing resource, the backend invalidates that stale provider ID and retries
Checkout once without the automatic waitlist discount. All other Stripe errors
remain fail-closed.

The retry removes waitlist metadata from both the Checkout Session and its
subscription metadata. This prevents later webhooks from marking an unapplied
waitlist discount as redeemed or converted. The fallback may still expose
Stripe's manual promotion-code entry and may apply an independently valid
referral coupon.

Tests cover a successful retry, stale-record invalidation, metadata removal,
and the rule that unrelated Stripe errors do not trigger a discount-free retry.
