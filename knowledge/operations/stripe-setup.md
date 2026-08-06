---
type: Operations Runbook
title: Stripe Setup and Verification
description: Dashboard, environment, webhook, secret-handling, and verification steps required to activate Stripe billing.
resource: /operations/stripe-setup.md
tags: [operations, stripe, billing, payments]
status: current
owner: backend
source_paths:
  - backend/STRIPE_SETUP.md
  - backend/src/billing/services.py
  - backend/src/allegrobot/settings.py
  - backend/env.example
last_reviewed: 2026-07-13
timestamp: 2026-07-13
---

# Stripe — setup

**The code is ready.** The `billing` module (subscriptions, message packs,
portal, and webhooks) and `referral` module (coupons) are fully implemented,
wired into URLs and `INSTALLED_APPS`, and covered by migrations and tests. The
frontend (`api/billing/`, `SubscriptionSettings`) is ready too.

Activating payments requires **configuration only**: populate `.env` keys and
create products in the Stripe Dashboard. No code changes are needed.

## 1. Stripe Dashboard — create products and prices

In **test** mode (then repeat in **live** mode):

- **Basic** product → two recurring prices: monthly and yearly
- **Pro** product → two recurring prices: monthly and yearly
- **Message Pack 20** product → one one-time price
- (Optional) Referral coupons: one for the referrer and one for the referee

Copy the **Price ID** (`price_...`) for each price.

## 2. Webhook

Dashboard → Developers → Webhooks → Add endpoint:

- URL: `https://<YOUR_BACKEND>/api/billing/stripe/webhook/`
- Events handled by `handle_stripe_event`:
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_succeeded`, `invoice.payment_failed` i `charge.refunded`.
- Copy the **Signing secret** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`
- Copy the **Endpoint ID** (`we_...`) → `STRIPE_WEBHOOK_ENDPOINT_ID`
- Set the exact public endpoint URL in `STRIPE_WEBHOOK_ENDPOINT_URL`

For local testing: `stripe listen --forward-to localhost:8000/api/billing/stripe/webhook/`
(the CLI prints a temporary `whsec_...`). The CLI secret differs from the
Dashboard endpoint secret. In this mode, endpoint ID and URL may remain empty.

## 3. Customer Portal

Configure the Customer Portal separately for test and live mode in the Stripe
Dashboard:

- Enable **Switch plan** in the subscription-management section.
- Add Basic and Pro monthly and yearly prices to the portal product catalog.
- Enable plan-change proration so Stripe displays and charges the difference.
- Keep cancellation at the end of the billing period.

For an active Basic plan, app Settings opens the direct confirmation screen for
the matching Pro price (monthly to monthly, yearly to yearly). The Stripe
Portal must permit that product and price, otherwise Stripe rejects the session.

## 4. Populate `.env`

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_WEBHOOK_ENDPOINT_ID=we_...
STRIPE_WEBHOOK_ENDPOINT_URL=https://api.example.com/api/billing/stripe/webhook/
STRIPE_API_VERSION=2026-02-25.clover
STRIPE_PRICE_BASIC_MONTHLY=price_...
STRIPE_PRICE_BASIC_YEARLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_MESSAGE_PACK_20=price_...
# Legacy — verify whether still used (`get_price_id_for_selection` in `services.py`)
STRIPE_BASIC_PRICE_ID=
STRIPE_PRO_PRICE_ID=
# Only if using referrals
STRIPE_REFERRAL_REFEREE_COUPON_ID=
STRIPE_REFERRAL_REFERRER_COUPON_ID=
# Only if using a waitlist campaign
WAITLIST_STRIPE_COUPON_ID=
```

In production, also set URLs (they default to `localhost:8081` locally):
`STRIPE_SUCCESS_URL`, `STRIPE_SETTINGS_SUCCESS_URL`, `STRIPE_CANCEL_URL`,
`STRIPE_PORTAL_RETURN_URL`, `STRIPE_MESSAGE_PACK_SUCCESS_URL`,
`STRIPE_MESSAGE_PACK_CANCEL_URL`, `FRONTEND_BASE_URL`.

## 5. Verification

- If `STRIPE_SECRET_KEY` is set, the API does not start without a properly
  formatted, non-placeholder `STRIPE_WEBHOOK_SECRET`.
- The production API container runs `python manage.py verify_stripe_webhook`.
  The command retrieves `STRIPE_WEBHOOK_ENDPOINT_ID` through the Stripe API and
  requires matching test/live mode, `enabled` status, the exact URL, and every
  supported event. A Stripe error or outage prevents API startup.
- Stripe does not return an existing signing secret through its API, so it can
  be conclusively verified only by validating the signature of a received event.
- Run `python manage.py migrate` if billing/referral migrations have not run.
- Run tests: `pytest src/billing src/referral`.
- `GET /api/billing/subscription/` should return `stripe_configured: true`.
- Complete a full checkout in test mode (card `4242 4242 4242 4242`).
- For an active Basic plan, check the Pro-upgrade button and Stripe proration
  screen before confirming.
- Schedule cancellation at period end and verify Settings displays the date
  through which the plan remains active.
- Confirm the webhook updated `BillingEntitlement`.

## Secret-handling note

Stripe keys are secrets. Do not commit `sk_...` or `whsec_...` values to the
repository; store them in a secret manager or hosting environment variables.

# Provenance

Migrated from `backend/STRIPE_SETUP.md` on 2026-07-11 and reconciled with the
active settings and Stripe event handler. The legacy file was removed.
