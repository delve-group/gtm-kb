---
type: Product Knowledge
title: Customer-Facing Capabilities
description: Canonical roles, customer journey, shipped capabilities, and notification capability boundaries.
resource: /product/capabilities.md
tags: [product, capabilities, customer-workflows]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
last_reviewed: 2026-07-14
timestamp: 2026-07-14
---

## 6. Roles and access

### Standard user/operator

The normal seller-facing account can access:

- Dashboard.
- Rule and knowledge management.
- Offer catalogue.
- Buyer messages.
- Post-purchase communication.
- Settings, billing, and onboarding.

### Administrator

Analytics is currently restricted to staff/admin users. Non-admin users are redirected away from analytics even though the data belongs to the product's operational audit system.

### Authentication

**Current**

- Email and password registration.
- Email confirmation.
- Email and password sign-in.
- Google sign-in.
- Session refresh and automatic retry after an expired access token.
- Logout.
- Protected application routes.

The main account identity is separate from the Allegro marketplace connection.

---

## 7. End-to-end customer journey

### Registration and purchase

1. The user creates an account.
2. The email address is confirmed.
3. The selected subscription is purchased.
4. Payment confirmation returns the user to onboarding.

### Guided onboarding

The setup can be paused and resumed. Active billing is checked before the
numbered flow and appears only as a recovery blocker when payment is missing or
pending. The current six-step sequence is:

1. Connect Allegro.
2. Synchronize offers and start product-knowledge preparation.
3. Upload one or more general shop-knowledge documents.
4. Choose full automation or suggestions and configure the escalation message.
5. Optionally add seller rules for special cases.
6. Run one real product-answer preview and one real human-handoff preview, then
   activate.

Every numbered step exposes concise contextual help that explains the concept,
preparation, and where the same controls live after setup. Assistant guidance
explicitly directs suggestion-mode users to the Messages view, where drafts
appear beside buyer conversations for review, editing, sending, or dismissal.
The optional rules step is marked reviewed after the user continues through it,
even when no special rule is needed.

The service tracks successful answer and escalation validation separately.
Completion no longer records those checks automatically; each marker follows a
matching simulator outcome in the onboarding interface.

Automatic replies cannot be enabled until the required setup is complete.

### Daily operation

1. New buyer conversations are synchronized.
2. The system checks subscription availability and configuration.
3. The conversation is classified.
4. Rules and relevant product/shop knowledge are selected.
5. The system answers, creates a suggestion, or escalates.
6. The seller monitors new messages and attention-required cases.
7. The decision and usage are recorded for review.

---

## 8. Current customer-facing capabilities

### Dashboard

- Counts active seller rules.
- Counts knowledge documents.
- Shows unresolved buyer conversations.
- Shows Allegro connection status.
- Provides direct access to major areas.
- Shows an “everything handled” state when no intervention is needed.
- Provides a visible path back to incomplete onboarding.

### Allegro account connection

- Connect and disconnect a seller account.
- Complete authorization in a browser flow.
- Refresh expired marketplace access automatically.
- Keep a persistent Allegro account assignment by Allegro account ID, separate from the short-lived OAuth token.
- Block another app user from connecting an Allegro account ID that is already assigned, even if the original user disconnected the token.
- Hydrate legacy OAuth tokens into persistent assignments through backfill or the owner's status check so old connections become permanently reserved too.
- Scope connection status and disconnect actions to the authenticated app user; browser-session OAuth fallback must not expose or remove another user's Allegro token.
- Show a support-facing problem report path in settings and onboarding when a user believes an Allegro account assignment is wrong.
- Return OAuth errors to the active web app screen so account-assignment failures open the same modal in settings and onboarding.
- Work against Allegro production or sandbox environments according to configuration.
- Multiple marketplace sessions can exist behind the scenes, but the customer UI currently behaves like a single-account integration.

### Offer synchronization and catalogue

- Synchronize all active offers or a limited number.
- Prepare product knowledge from offer descriptions and parameters.
- Detect unchanged offers and skip unnecessary regeneration.
- Track generated, unchanged, failed, and review-required products.
- Browse offer name, ID, price, stock, and publication status.
- Search by offer name or numeric ID.
- Open the original listing on Allegro.

### Buyer inbox

- List Allegro discussion threads.
- Show a message preview and newest activity.
- Highlight new buyer messages.
- Separate escalated cases from ordinary new messages.
- Show whether AI answered, delivery failed, or operator attention is needed.
- Show related offer and order details inside the conversation.
- Load older messages progressively.
- Mark opened conversations as read.
- Send manual replies.
- Approve, edit, or dismiss AI suggestions.
- Return control to AI after an operator reply, or keep the thread under human control.
- Resume AI handling after the configured inactivity/timeout behavior.

### Automatic replies

- Full automation mode sends eligible replies.
- Suggestion mode creates drafts for seller approval.
- Adjustable scan interval: 1, 5, 15, 30, or 60 minutes.
- Manual “scan now” action.
- Visible previous and next scan times.
- Configurable buyer-facing escalation message.
- Empty escalation message means no automatic message is sent.
- Default escalation timeout is 60 minutes; zero disables automatic return.

### Knowledge base

- General shop knowledge used across offers.
- Offer-specific knowledge.
- Automatic product knowledge generated from synchronized offers.
- PDF, DOCX, and TXT uploads.
- Global or offer-specific document scope.
- Upload, processing, ready, and failed states.
- Document versioning.
- Fragment/content preview.
- Document deletion.
- Per-offer automatic-reply setting.
- Latest successful version becomes active while older versions are deactivated.

Recommended general-shop content:

- Returns and complaints.
- Invoices and payments.
- Delivery methods and expected timing.
- Store contact and service policy.
- Frequently asked questions.

### Seller rules

- Create, edit, order, and delete manual rules.
- Rules can cover tone, negotiation limits, prohibited claims, required information, and escalation.
- Rules are applied after non-overridable safety rules.
- Seller rules cannot override core safety instructions.

### Learned rules

- When a seller materially edits an AI suggestion and sends the final reply, the system can extract a reusable rule from the difference.
- Learned rules are stored separately from manual rules.
- Duplicate or very similar learned rules are suppressed.
- Potential personal information is scrubbed before learning.
- A no-change approval does not create a learned rule.

### Simulator

- Test a buyer conversation before activation.
- Test against global knowledge or a selected offer.
- Stream the response as it is generated.
- Show detected intent and route.
- Show applied rules.
- Show retrieved source count and agreement.
- Show confidence and threshold.
- Explain why a case was escalated.
- Reset and repeat the conversation.
- Save a test conversation, then open it again to re-run it after editing rules.

Saved conversations are exposed from the simulator header: save stores the live
transcript and its last decision trace, and opening one replaces the live chat
with the saved transcript so the seller can carry it on. Titles are generated by
the service from the first buyer message; there is no rename and no per-tier cap
on how many a seller may keep.

### Escalations

- Dedicated attention queue.
- Open and resolved states.
- Reasons:
  - Complaint.
  - Low confidence.
  - Automatic replies disabled.
  - Buyer requested a person.
  - Out-of-scope message.
- Optional AI suggestion and confidence for the operator.
- Resolve a case after manual handling.
- Return a case to AI control.
- Optional countdown to automatic return.
- Badge and in-app alert when the open count increases.

There is a standalone escalation screen, but the primary navigation presents escalations inside the message workflow.

### Notifications

- Email and push preferences for escalated conversations.
- Email and push preferences for usage-limit events.
- Browser and native device push registration from Settings.
- Safe push endpoint listing that excludes delivery secrets.
- In-app alerts for newly opened attention-required cases.
- Low-usage banner that points sellers to subscription management.

### Post-purchase communication

- Enable or disable automatic messages after purchase.
- Trigger only for orders ready for processing.
- Send at most one post-purchase message per user/order.
- General fallback template.
- Variables:
  - Buyer login.
  - Order ID.
  - Purchased item list.
  - Item count.
  - Total amount.
  - Currency.
- Preview rendered content.
- Offer-specific priority messages for Pro.
- Standard, high, and highest priority options in the UI.
- When several enabled rules overlap an order, the highest numeric priority wins; ties prefer the older matching rule.
- If no rule matches, the general template is used.
- Basic always uses the general template.
- Sending history with pending, sent, and failed states.

### Settings

- Allegro connection.
- Subscription and payment state.
- Reply mode.
- Scan frequency.
- Escalation wording.
- Offer synchronization.
- Polish or English interface.
- Light, dark, or system theme.
- Session logout.

### Customer feedback

- Prompt an authenticated seller on the dashboard after onboarding is complete
  and at least five AI replies have been sent.
- Collect a required 1–5 satisfaction score and a required written comment in a
  dedicated modal, separate from bug and improvement reports.
- Store the prompt impression per app user and campaign on the current device;
  a dismissal suppresses the prompt for 30 days and a successful submission
  suppresses that campaign permanently on that device.
- Submit satisfaction through the existing feedback-report pipeline with the
  `customer_success` kind. Django retains the structured score and campaign in
  report context, while Telegram and Google Sheets receive the score and comment
  in the report message.

### Subscription usage

- Current plan and billing period.
- Current billing-period dates.
- Used and remaining AI replies.
- Base allowance and purchased extra allowance.
- Low-usage warning at 5% remaining or less.
- Subscription management.
- Subscription checkout retries once without an automatic waitlist discount
  when Stripe reports that its stored promotion-code ID no longer exists;
  unrelated Stripe failures still block checkout.
- Direct Basic-to-Pro upgrade through Stripe's hosted confirmation flow while
  preserving the monthly or yearly billing cadence.
- Payment-recovery path for past-due or unpaid subscriptions.
- Cancellation-at-period-end notice with the final active date.
- Additional reply-pack purchase when eligible.

### Analytics and audit

**Current but admin-only in the customer UI**

- Total processed messages.
- Answered, escalated/refused, and failed counts.
- Prompt, completion, and total token usage.
- Estimated AI processing cost.
- Grouping by day, user, model, module, or route.
- Filtering by conversation, source message, offer, route, model, date, decision, and status.
- Individual decision inspection.
- Knowledge and rule evidence.
- Transport result and processing timeline.
- CSV or NDJSON export.
- Direct navigation from an audit result to the original message thread.

### Localization and presentation

- Full Polish and English copy sets.
- Light, dark, and system themes.
- Responsive desktop and compact/mobile navigation.
- Web, iOS, and Android runtime targets.

Public App Store or Google Play availability is **not confirmed**.

---

## 13. Notifications

### Current in-app behavior

- Alert when the open escalation count increases.
- Navigation badge for attention-required messages.
- Persistent warning when 5% or less of the AI reply allowance remains.

### Backend-ready channels

- Email.
- Mobile push.
- Browser push.

Supported system events:

- Conversation escalated.
- AI reply limit reached.

Important notification rules:

- A newly opened or reopened escalation emits one event.
- Repeated scans of the same open escalation do not create duplicates.
- One usage-limit event is created per user, subscription period, and effective limit.
- Provider payloads contain routing metadata, not buyer-message content.
- Failed or permanently invalid push endpoints can be disabled automatically.

The customer interface does not yet expose notification preferences or device/browser registration. External email and push availability therefore remains **backend-ready**, not a complete public feature.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
