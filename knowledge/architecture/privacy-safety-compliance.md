---
type: Architecture
title: Privacy, Safety, and Compliance
description: Canonical PII, audit privacy, safety, legal boundary, analytics, and retention guidance.
resource: /architecture/privacy-safety-compliance.md
tags: [architecture, privacy, safety, compliance]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
  - backend/src/ai_audit/services.py
  - backend/src/ai_audit/tasks.py
  - backend/src/ai_audit/langfuse_client.py
last_reviewed: 2026-07-21
timestamp: 2026-07-08
---

## 12. Privacy, safety, and compliance design

### Personal-information masking

Before text reaches external AI services, the system uses three layers:

1. Context-aware pattern detection for structured data.
2. Polish-language entity recognition for names and locations.
3. Optional local AI audit for residual leaks.

Covered data includes:

- Email addresses.
- Phone numbers.
- PESEL.
- Bank account and IBAN/NRB numbers.
- Postal codes and addresses.
- Names and locations.
- Order and tracking identifiers.
- URLs where considered sensitive.

The structured checks validate context and checksums to avoid masking innocent values such as prices that resemble identifiers.

If the optional local auditor is unavailable, the deterministic and language-recognition layers continue to operate.

### Audit privacy

- Audit processing stores hashes and approved metadata rather than raw message bodies in technical spans.
- Notification payloads intentionally exclude buyer-message text.
- Audit fields are allowlisted by processing step.
- Raw inputs and sanitized inputs have separate hashes.

Audit collection must never control customer-facing reply success. Runs, spans,
and model usage are collected in memory with payload allowlisting applied before
serialization. When a run exits, the backend makes one best-effort publish of
the complete JSON batch to the Redis-backed `ai_audit` Celery queue. The Celery
worker persists the run, spans, and usage rows atomically and idempotently, then
links the corresponding auto-reply attempt. Queue publication and audit-storage
failures are logged but never raised into reply processing. If Redis is
unavailable or a process is killed before publication, the audit batch may be
lost; reply availability takes precedence over audit completeness.

Langfuse is an optional observability projection, not the compliance or billing
system of record. The local `ai_audit` models remain authoritative for retained
runs, usage, exports, and cost reporting. Each exported Langfuse trace uses
HMAC-derived user and session pseudonyms plus hashed source/offer identifiers;
the Langfuse trace ID is stored on the local conversation run for correlation.
Production startup rejects content capture, validates a nonzero sampling rate,
and an SDK export mask removes observation and OpenTelemetry prompt/output
attributes as defense in depth. Non-production content capture recursively runs
the deterministic and NLP PII scrubbers over trace-only copies; a scrubber error
drops the content and keeps metadata rather than exporting raw data. Embeddings
are always hash-only, and external offer/message identifiers in span metadata
are hashed. Langfuse failures are caught locally and never replace a customer
reply result or business exception.

### Safety rules

- Do not answer outside available context.
- Prefer escalation to unsupported guessing.
- Product-specific information takes priority.
- Seller rules cannot override core safety behavior.
- Complaints and explicit human requests route to a person.
- AI-generated replies include disclosure wording.

### Legal-claim boundary

The architecture is designed around GDPR data minimization and EU AI transparency principles, but the repository does not prove legal certification.

Do not publicly claim:

- Guaranteed GDPR compliance.
- Certified EU AI Act compliance.
- Impossible hallucinations.
- Guaranteed prevention of all data leakage.
- A specific retention or data-residency promise without deployment confirmation.

### Customer feedback data

Authenticated bug, suggestion, and customer-satisfaction reports retain the
account email, app version, user-entered text, and limited app context in Django.
The delivery worker also sends the reporter email, platform, report type, and
formatted message to configured Telegram and Google Sheets destinations. Prompt
copy should not ask for buyer data, order details, or other sensitive content;
access and retention for these reports remain deployment-policy decisions.

---

## 16. Analytics, audit, and retention

### Recorded run data

- Conversation and source-message identifiers.
- Offer ID.
- Start and finish times.
- Status.
- Final decision and reason.
- Confidence.
- Intent and route.
- Knowledge evidence.
- Models used.
- Estimated cost.
- Safe error code.
- Langfuse trace correlation ID when tracing is enabled.

### Processing spans

The audit timeline covers:

- Personal-information scans.
- Intent routing.
- Rule resolution.
- Knowledge retrieval.
- Reply generation.
- Sending.
- Marking the thread as read.

### Usage ledger

Tracks:

- Provider and model.
- Operation and module.
- Route and conversation.
- Prompt, completion, cached, and total tokens.
- Estimated cost.
- Provider request metadata.

### Retention defaults

- Conversation runs: 90 days.
- Usage ledger: 365 days.
- Export files: 7 days.

These are configurable policy defaults and should not become public contractual promises without confirmation.

### Verified account deletion

- Expo web, Android, and iOS expose a Settings action that opens the exact
  public resource at `https://superseller.pl/delete-account`.
- The landing form proxies requests to Django with a server-only shared secret.
  Existing and unknown emails receive the same response, preventing account
  enumeration.
- Django stores only a SHA-256 confirmation-token digest. The raw one-time
  token is delivered through a Mailjet transactional template and expires after
  the configured lifetime (24 hours by default).
- Provider acceptance is not treated as delivery. PII-free PostgreSQL delivery
  rows are updated by authenticated Mailjet events, stale accepted messages are
  reconciled, and failed or unknown delivery triggers a Telegram alert that
  contains only a request UUID and safe operational codes.
- The administrator is notified only after the owner confirms access to the
  account email. Fulfillment is restricted to superusers and runs as an
  idempotent Celery task.
- Fulfillment deactivates the user, cancels an active Stripe subscription
  immediately, deletes associated waitlist data and user-owned database rows,
  removes knowledge-base and audit-export files from storage, and scrubs request
  PII after attempting the completion email. Completion-email failure is tracked
  and alerted independently and does not misreport the account deletion itself
  as incomplete.
- Stripe cancellation failure leaves the account inactive but present and the
  request retryable. The workflow never pauses a subscription or marks deletion
  complete while recurring billing cancellation is unresolved.
- Stripe invoices and other records that must remain for accounting or legal
  obligations are outside the application-user cascade and must be retained
  only for the approved purpose and duration.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.

# Citations

- [Langfuse data masking](https://langfuse.com/docs/observability/features/masking)
- [Langfuse token and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)
