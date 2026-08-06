---
type: Operations
title: Mailjet Delivery Tracking and Alerts
description: Configure and operate Mailjet delivery webhooks, PostgreSQL delivery state, reconciliation, and Telegram failure alerts.
resource: /operations/mailjet-delivery.md
tags: [operations, mailjet, email, webhooks, telegram]
status: current
owner: project
source_paths:
  - backend/src/authentication/email_delivery.py
  - backend/src/authentication/tasks.py
  - backend/src/authentication/signals.py
  - backend/src/authentication/models.py
  - backend/src/allegrobot/settings.py
last_reviewed: 2026-07-21
timestamp: 2026-07-21
---

# Mailjet Delivery Tracking and Alerts

## Delivery semantics

Account-deletion email submission and delivery are separate states. A successful
Mailjet API response records `accepted`; only a Mailjet `sent` webhook records
`sent`. `blocked`, hard bounce, and spam events record `failed`. The account
owner's confirmation remains the separate business-success event.

`TransactionalEmailDelivery` stores one PII-free row per account-deletion
request and email purpose. It records the provider message ID, attempts, safe
error code, delivery timestamps, and Telegram-alert timestamp. It never stores
the recipient address or confirmation token.

## Mailjet webhook setup

1. Generate dedicated HTTP Basic credentials; do not reuse Django, JWT,
   Mailjet API, or deletion-proxy secrets. Store them as
   `ANYMAIL_WEBHOOK_SECRET=username:password` in the backend deployment.
2. In Mailjet Event Tracking, register this HTTPS URL for `sent`, `blocked`,
   `bounce`, and `spam` and enable grouped events:

   ```text
   https://username:password@api.example.com/anymail/mailjet/tracking/
   ```

3. Use the same credentials in the URL and `ANYMAIL_WEBHOOK_SECRET`. Hex-only
   credentials avoid URL-encoding ambiguity.
4. Send a disposable account-deletion request and confirm the delivery row
   moves from `accepted` to `sent` or `failed`.

Anymail validates Basic Auth, parses grouped and individual Mailjet events, and
normalizes provider event names before the authentication app updates state.
For localhost setup and tunnel troubleshooting, follow
[Cloudflare Tunnel for Local Webhooks](cloudflare-tunnel.md).

## Telegram alerts and reconciliation

`TELEGRAM_ACCESS_TOKEN` and `TELEGRAM_CHAT_ID` are mandatory in production.
Failed or unknown delivery states enqueue an idempotent Celery alert containing
only the delivery purpose, request UUID, status, safe error code, attempt count,
and Django-admin URL.

Celery Beat checks accepted deliveries every five minutes. A stale delivery is
queried through Mailjet's message API; terminal provider failures update the
row and alert Telegram, while an unresolved status becomes `unknown` and also
alerts. Django Admin exposes delivery rows and filters for operational review.

If Telegram itself fails, Celery retries with backoff and logs a token-safe
error. A database or broker outage remains an infrastructure-monitoring concern
because the application cannot persist or enqueue an alert while those systems
are unavailable.

## End-to-end verification

Run automated coverage first:

```bash
docker compose exec -T web pytest -q \
  authentication/tests/test_email_delivery.py \
  authentication/tests/test_account_deletion.py \
  allegrobot/tests.py
```

Then monitor all three runtime participants while testing through the public
landing page:

```bash
docker compose logs -f web celery celery-beat
```

### Successful business flow

Use a disposable Superseller account whose mailbox you control. Completing the
last step permanently deletes the account and may cancel its Stripe
subscription.

1. Submit the public account-deletion form. The proxy and Django endpoint must
   return `202`, and Celery must submit the confirmation template.
2. Open Django Admin at
   `/admin/authentication/transactionalemaildelivery/`. The `confirmation`
   delivery first becomes `accepted` and then `sent` after Mailjet's webhook.
3. Open the confirmation email and follow its one-time link. The request
   becomes `verified`; the `admin_notification` delivery also moves from
   `accepted` to `sent`.
4. From Django Admin, queue fulfillment only for this disposable account. The
   request becomes `completed`, identifying data is scrubbed, and the
   `completed` delivery moves to `sent`.
5. Verify the mailbox received the confirmation and completion messages, the
   administrator received the verified-request message, and Telegram received
   no failure alert.

An API or Celery `succeeded` log proves only submission. The test passes from a
business perspective only when Mailjet state, mailbox receipt, account state,
and expected alerts all agree.

### Controlled failure and Telegram alert

Use a second disposable request so the successful audit trail remains intact.
Copy its confirmation delivery UUID from Django Admin. Then send a synthetic
grouped Mailjet `blocked` event through the public tunnel URL:

```bash
printf "Delivery UUID: "
read -r DELIVERY_ID
printf "Webhook username:password: "
read -rs WEBHOOK_AUTH
printf "\n"
EVENT_TIME="$(date +%s)"

curl --fail-with-body \
  --user "$WEBHOOK_AUTH" \
  --header "Content-Type: application/json" \
  --data-binary "[{\"event\":\"blocked\",\"time\":${EVENT_TIME},\"MessageID\":999999999,\"email\":\"test@example.invalid\",\"Payload\":\"{\\\"email_delivery_id\\\":\\\"${DELIVERY_ID}\\\"}\",\"error\":\"manual_test_block\"}]" \
  "https://<tunnel-host>/anymail/mailjet/tracking/"

unset WEBHOOK_AUTH
```

The endpoint must return `200`. The delivery must become `failed` with
`mailjet_rejected_manual_test_block`, and Telegram must receive one alert that
contains the request UUID but no recipient email. Wait for the first alert,
then repeat the request: it must not send a second Telegram alert, and
`telegram_alerted_at` must remain populated.

### Reconciliation fallback

To exercise the recovery path separately, temporarily disable only Mailjet's
`Sent` trigger, submit another disposable request, and verify its delivery
remains `accepted`. Keep Celery Beat running. Within roughly five to ten
minutes, the stale-delivery task must query Mailjet and move the row to `sent`.
Re-enable the `Sent` trigger immediately after the test. `Blocked`, `Bounce`,
and `Spam` triggers should remain enabled throughout.

# Citations

- [Mailjet event webhooks](https://dev.mailjet.com/email/guides/webhooks/)
- [Anymail Mailjet tracking](https://anymail.dev/en/stable/esps/mailjet/)
