---
type: Product Knowledge
title: Feature Status and Known Inconsistencies
description: Canonical feature-status matrix and stale-material register.
resource: /product/feature-status.md
tags: [product, status, stale-material]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
last_reviewed: 2026-07-16
timestamp: 2026-07-10
---

## 21. Feature-status matrix

| Capability | Status | Notes |
|---|---|---|
| Email/password account | Current | Includes confirmation |
| Google sign-in | Current | Main account auth |
| Allegro connection | Current | Customer UI assumes one primary account; Allegro ID assignment is persistent until support release |
| Offer catalogue | Current | Search and pagination |
| Offer knowledge generation | Current | Descriptions and parameters |
| Global/product documents | Current | PDF, DOCX, TXT |
| Seller rules | Current | Manual CRUD and ordering |
| Learned rules | Current | Derived from edited suggestions |
| Simulator | Current | Compact live workflow |
| Saved simulator conversations | Current | Save/open/delete from the simulator header; no rename, no per-tier cap |
| Automatic replies | Current | Full automation |
| AI suggestions | Current | Edit, approve, dismiss |
| Escalation queue | Current | Integrated with messages |
| Standalone escalation view | Current but secondary | Not in primary navigation |
| Post-purchase messages | Current | General and Pro priority variants |
| Billing | Current | Basic, Pro, yearly/monthly, packs |
| In-app usage/attention alerts | Current | Includes low-usage banner and new attention toasts |
| Analytics | Current, admin-only | Not standard-user navigation |
| Email notifications | Current | User preferences exposed; delivery depends on Mailjet config |
| Verified account deletion | Current | Public email-confirmed request plus shared web/iOS/Android Settings entry; superuser fulfillment cancels Stripe immediately |
| Mobile/browser push | Current | Settings can register/unregister the current device |
| Customer satisfaction prompt | Current | Separate required score/comment modal after five sent replies; reuses the feedback dispatch pipeline with device-local suppression |
| Referral program | Backend-ready | Customer UI absent |
| Enterprise offer | Proposal | Terms not confirmed |
| SMS alerts and packs | Proposal | Not current |
| Multiple Allegro accounts | Partial | Session support exists; product flow does not |
| NIP verification | Proposal/incomplete | Referral hook is a placeholder |
| Public mobile-store release | Needs confirmation | Runtime supports native targets |

---

## 22. Known inconsistencies and stale material

### Brand

Superseller is the final product name. Any previous names that remain in historical plans or stale configuration examples must not be reused in current product surfaces.

### Pricing

The active product uses Basic and Pro with 30 and 60 base replies. Older documents describe Free, Starter, Pro, and Business with much larger limits. Treat the older documents as historical proposals.

### AI provider documentation

Some older documentation says the service calls OpenAI directly. Current shared AI traffic goes through OpenRouter while still selecting OpenAI models.

### Knowledge documentation

Rules, Knowledge Base, and Simulator are separate product routes. Knowledge Base
owns document upload, filtering, preview and deletion, plus the all-offers product
knowledge synchronization previously exposed in Settings. Its coverage map
aggregates documents into Global, the eight largest offer scopes, and Other; node
area represents fragment volume, and selecting a node filters the document list.

### Analytics access

Product copy can imply user-facing analytics, but the current route and navigation restrict it to staff/admin.

### Notifications

Notification preferences and current-device push registration are exposed in Settings. Delivery still depends on deployment provider configuration, especially Mailjet and Web Push VAPID keys.

### Referrals

The authenticated app exposes a compact referral modal with the user's
registration link, code, and aggregate statuses. The customer UI still does
not expose per-referral details or a fixed reward value.

### Multiple Allegro sessions

The service can store several sessions, but the product should be marketed as one connected seller account until a multi-account workflow is intentionally completed.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
