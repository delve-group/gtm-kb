---
type: Backend Module
title: System Notifications
description: Backend notification events, delivery channels, environment variables, and API contracts.
resource: /backend/notifications.md
tags: [backend, notifications]
status: current
owner: project
source_paths:
  - backend/docs/notifications.md
  - backend/src/allegrobot/settings.py
  - backend/src/notifications/services.py
  - backend/src/notifications/views.py
  - backend/env.example
last_reviewed: 2026-07-10
timestamp: 2026-07-10
---

# System Notifications

Backend notifications are emitted for operator-facing system events.

The backend supports:

- email notifications through Mailjet via Django Anymail
- mobile push targets through Expo Push Service
- browser push targets through standards-based Web Push subscriptions

Supported event types:

- `conversation_escalated` when an AI conversation is escalated to an operator
- `usage_limit_reached` when a user's AI reply limit is exhausted for the
  current billing period

Frontend and mobile clients register push endpoints, list their safe endpoint
summaries, read provider capabilities, and update preferences. Event detection
and provider delivery live in the backend.

## Event Flow

1. `autoresponder.tasks._upsert_escalated_thread()` creates or reopens an
   `EscalatedThread`.
2. A notification is enqueued only when the thread is newly open or reopened
   after resolution. Repeated scans of an already-open escalation do not notify.
3. `notifications.services.notify_escalation_opened()` creates a
   `NotificationEvent` with sanitized metadata only.
4. `notifications.tasks.enqueue_escalation_notifications()` creates delivery
   records for enabled channels.
5. `notifications.tasks.send_notification_delivery()` sends each pending
   delivery and records provider status. Expo push deliveries are grouped into
   batches of up to 100 messages.
6. `notifications.tasks.check_expo_push_receipts()` periodically checks Expo
   push receipts because Expo tickets are not final delivery status.

Usage-limit notifications follow the same delivery pipeline:

1. `billing.services.has_available_replies()` returns `False` while processing a
   customer message.
2. `autoresponder.tasks._refuse_subscription_limit()` records a refused attempt
   and marks the thread as needing operator attention.
3. `notifications.services.notify_usage_limit_reached()` creates a
   `usage_limit_reached` event only when the user has an active exhausted plan.
4. The event key is scoped to user, entitlement, billing period, and reply limit,
   so repeated over-limit messages in the same period do not create duplicate
   notifications.

The notification payload deliberately excludes `buyer_message`. Push providers
and email providers retain payloads outside our database, so notifications only
carry thread routing metadata:

```json
{
  "type": "conversation_escalated",
  "escalationId": 123,
  "threadId": "thread-abc",
  "reason": "request_human",
  "url": "https://app.example.com/messages?threadId=thread-abc"
}
```

`usage_limit_reached` carries billing-period metadata and safe routing fields:

```json
{
  "type": "usage_limit_reached",
  "threadId": "thread-abc",
  "sourceMessageId": "message-abc",
  "offerId": "offer-123",
  "replyLimit": 30,
  "repliesSent": 30,
  "repliesRemaining": 0,
  "currentPeriodEnd": "2026-06-30T00:00:00Z",
  "url": "https://app.example.com/settings"
}
```

## Environment Variables

Add these to the backend environment:

```dotenv
NOTIFICATIONS_ENABLED=true
NOTIFICATIONS_APP_BASE_URL=https://app.example.com

MAILJET_API_KEY=your-mailjet-api-key
MAILJET_SECRET_KEY=your-mailjet-secret-key
MAILJET_FROM_EMAIL=Superseller <no-reply@superseller.pl>
MAILJET_CONVERSATION_ESCALATED_TEMPLATE_ID_PL=
MAILJET_CONVERSATION_ESCALATED_TEMPLATE_ID_EN=
MAILJET_USAGE_LIMIT_REACHED_TEMPLATE_ID_PL=
MAILJET_USAGE_LIMIT_REACHED_TEMPLATE_ID_EN=

EXPO_PUSH_ENABLED=true
EXPO_PUSH_ACCESS_TOKEN=

WEB_PUSH_ENABLED=true
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_VAPID_SUBJECT=mailto:support@example.com
```

Notes:

- `NOTIFICATIONS_ENABLED` defaults to `true`. Set it to `false` to stop
  notification event creation, delivery creation, and provider jobs while
  keeping the preferences and push-endpoint APIs available.
- `NOTIFICATIONS_APP_BASE_URL` is the public frontend origin used to build
  action links in notification payloads and emails. Use the app URL, not the API
  URL; for example `https://app.example.com`.
- The backend strips a trailing slash from `NOTIFICATIONS_APP_BASE_URL` and
  appends routes such as `/messages?threadId=...` and `/settings`.
- Production startup requires `NOTIFICATIONS_APP_BASE_URL` to be an absolute
  HTTPS frontend URL. Tests and local development may still use relative or
  HTTP URLs.
- Email deliveries are skipped when Mailjet is not configured.
- `MAILJET_FROM_EMAIL` must be a sender address or sender domain verified in
  Mailjet. The application passes it explicitly because Mailjet's Send API
  requires `From.Email`; stored templates own the subject and body.
- Notification email templates are required. The backend never renders a raw
  text or HTML fallback. It selects the Polish or English event-specific
  template from the persisted notification language and skips delivery if that
  template is not configured.
- Conversation-escalated templates receive only `url` and a human-readable
  `reason`. Usage-limit templates receive only `replies_sent`, `reply_limit`,
  `current_period_end`, and `url`.
- Mailjet deliveries use a single provider tag: the notification event type.
  Mailjet rejects multiple tags, so the generic notification marker and other
  routing context belong in message metadata instead.
- Escalation reason values are provider-safe codes in stored payloads, such as
  `out_of_scope`, but email bodies and template variables expose a human label,
  such as `Out of scope`.
- Expo access tokens are optional for some Expo projects, but should be set if
  push security is enabled in Expo.
- Web Push requires a VAPID key pair. Expose only the public key to browser
  clients.

## API Contracts

All endpoints require the same authenticated JWT bearer token used by the rest
of the backend.

### Capabilities

`GET /api/notifications/capabilities/`

Returns public provider availability for the current deployment:

```json
{
  "notifications_enabled": true,
  "email_configured": true,
  "expo_push_enabled": true,
  "web_push_enabled": true,
  "web_push_vapid_public_key": "public-key"
}
```

When `NOTIFICATIONS_ENABLED=false`, provider-specific booleans are false and
the VAPID public key is blank.

### Preferences

`GET /api/notifications/preferences/`

Creates default preferences lazily when missing:

```json
{
  "language": "pl",
  "escalation_email_enabled": true,
  "escalation_push_enabled": true,
  "usage_limit_email_enabled": true,
  "usage_limit_push_enabled": true,
  "created_at": "2026-05-12T10:00:00Z",
  "updated_at": "2026-05-12T10:00:00Z"
}
```

`PATCH /api/notifications/preferences/`

```json
{
  "language": "en",
  "escalation_email_enabled": false,
  "escalation_push_enabled": true,
  "usage_limit_email_enabled": true,
  "usage_limit_push_enabled": true
}
```

### Register Expo Push

`POST /api/notifications/push-endpoints/`

```json
{
  "provider": "expo",
  "platform": "ios",
  "device_id": "stable-device-id",
  "expo_token": "ExponentPushToken[...]"
}
```

Use `platform: "android"` for Android clients. The backend upserts by
`user + provider + device_id`, so clients can safely re-register on app start.

### Register Browser Web Push

`POST /api/notifications/push-endpoints/`

```json
{
  "provider": "web_push",
  "platform": "web",
  "device_id": "stable-browser-install-id",
  "web_push_subscription": {
    "endpoint": "https://push.example/subscription",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

Browser clients must create the subscription from a service worker using the
backend-provided VAPID public key from deployment config.

### List Push Endpoints

`GET /api/notifications/push-endpoints/`

Lists safe endpoint metadata for the authenticated user. The response excludes
delivery secrets such as Expo tokens and raw Web Push subscriptions.

```json
[
  {
    "id": 123,
    "provider": "web_push",
    "platform": "web",
    "device_id": "stable-browser-install-id",
    "enabled": true,
    "failure_count": 0,
    "last_error_code": "",
    "last_error_message": "",
    "last_success_at": null,
    "last_failure_at": null,
    "created_at": "2026-05-12T10:00:00Z",
    "updated_at": "2026-05-12T10:00:00Z"
  }
]
```

### Unregister Push

`DELETE /api/notifications/push-endpoints/{device_id}/`

Deletes all push endpoints for that authenticated user and device id.

## Failure Handling

- Mailjet failures mark the delivery `failed`; missing config marks it `skipped`.
- Expo `DeviceNotRegistered` disables the endpoint permanently.
- Expo tickets are saved as `provider_receipt_id`; receipt checks can later mark
  delivery failure and disable dead endpoints.
- Web Push `404` and `410` responses disable the endpoint permanently.
- All provider calls are audited in `NotificationDelivery`.

## Client Integration

Mobile Expo clients:

1. Ask notification permission after login or onboarding.
2. Call `Notifications.getExpoPushTokenAsync(...)`.
3. Persist a stable local `device_id`.
4. Register the token with `POST /api/notifications/push-endpoints/`.
5. On notification tap, route to `/messages?threadId=<threadId>`.

Web clients:

1. Register a service worker.
2. Request notification permission.
3. Subscribe to Push API using `WEB_PUSH_VAPID_PUBLIC_KEY`.
4. Register the subscription with the backend.
5. On notification click, open the payload `url`.

References:

- Django Anymail Mailjet: https://anymail.dev/en/stable/esps/mailjet/
- Expo Push Service: https://docs.expo.dev/push-notifications/sending-notifications/
- MDN Push API: https://developer.mozilla.org/en-US/docs/Web/API/Push_API
- pywebpush: https://github.com/web-push-libs/pywebpush

# Provenance

Migrated from legacy path `backend/docs/notifications.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
Environment-variable behavior also reflects active Django notification settings and services.
