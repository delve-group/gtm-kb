---
type: Product Knowledge
title: Product Overview
description: Canonical product purpose, positioning, customer problem, target users, and jobs.
resource: /product/overview.md
tags: [product, canonical, positioning]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
  - PRODUCT.md
last_reviewed: 2026-07-16
timestamp: 2026-07-11
---

# Superseller — comprehensive project knowledge base

## Document role

This is the canonical overview of the project: product purpose, audiences, workflows, shipped capabilities, backend-ready capabilities, business rules, technical architecture, operations, commercial model, safety principles, and unresolved decisions.

Use it to:

- Understand the product before changing it.
- Ground landing-page and sales copy in real behavior.
- Distinguish shipped features from proposals.
- Preserve important business and technical invariants.
- Onboard product, design, engineering, and support collaborators.

**Superseller is the final customer-facing product name.** References to previous names in historical material are stale and must not be reused in current product copy or configuration.

Last reviewed against the repository: **2026-06-29**.

## Truth and status labels

- **Current** — represented in the active customer application and supported by the current service.
- **Backend-ready** — supported behind the scenes but not yet exposed as a complete customer workflow.
- **Proposal** — described in planning or commercial material but not safe to advertise as available.
- **Needs confirmation** — implemented values exist, but product or commercial ownership should confirm them before public use.

When sources conflict, prefer current customer behavior and current service rules over older planning documents.

---

## 1. Executive summary

Superseller is an AI customer-support assistant for Allegro sellers. It handles buyer conversations using the seller's approved shop knowledge, product information, and response rules. The seller can allow automatic replies or require approval of AI suggestions. Unsupported, sensitive, low-confidence, or explicitly human cases are passed to an operator.

The product is not intended to be a generic chatbot. Its core idea is controlled automation:

1. Connect the seller's Allegro account.
2. Synchronize active offers and prepare product knowledge.
3. Add shop-wide policies and custom rules.
4. Test answers and escalations.
5. Let AI answer or suggest replies.
6. Keep a person responsible for exceptions.
7. Preserve an inspectable decision history.

The product also includes post-purchase messages, subscription usage, guided onboarding, and an operator inbox.

## 2. Product positioning

### Category

AI-first customer-support automation for Allegro sellers.

### Core promise

Automate repetitive buyer support without giving up control over information, rules, sending mode, or risky cases.

### Positioning statement

For Allegro sellers who spend too much time answering repeat questions, Superseller is a controlled AI assistant that uses their actual catalogue and shop policies. Unlike a generic chatbot, it follows explicit seller rules, shows why it made a decision, and escalates when it lacks reliable support.

### Product character

- Allegro-specific rather than omnichannel.
- AI-first rather than ticketing-first.
- Seller-controlled rather than autonomous at any cost.
- Evidence-oriented rather than black-box.
- Designed for Polish commerce, with Polish and English interfaces.
- Subscription priced per shop/product account, not presented as per-agent helpdesk software.

The brand personality is practical, calm, and trustworthy. The product should
feel like a focused operations workspace rather than a playful chatbot.

### Product and design principles

- Keep the operator focused on the conversation and the next useful action.
- Make automation boundaries, evidence, and escalation clear.
- Prefer compact, familiar controls over decorative interface patterns.
- Show only information that helps the current decision.
- Preserve seller control throughout automated workflows.

Avoid generic chatbot styling, black-box automation, traditional helpdesk
clutter, decorative UI, and claims that imply autonomy without seller control.

### Primary differentiators

- Product knowledge generated from active Allegro offers.
- General shop knowledge and offer-specific knowledge used together.
- Seller-defined rules applied before generated wording.
- Choice between automatic sending and suggestion approval.
- Learned rules from meaningful seller edits.
- Simulator for testing before activation.
- Explicit human escalation path.
- Detailed decision and usage history.
- Pre-purchase support and post-purchase communication in one product.

## 3. Customer problem

Allegro sellers repeatedly answer questions about:

- Product specifications, compatibility, size, and availability.
- Delivery time and order status.
- Discounts and price negotiation.
- Returns, complaints, invoices, and store policies.
- Simple acknowledgements or messages that need no action.

Manual handling consumes time and creates slow or inconsistent replies. As catalogue size and conversation volume grow, keeping every answer aligned with current product information and shop policy becomes difficult.

Unrestricted AI introduces a different risk: it can invent facts, promise unsupported outcomes, mishandle complaints, or expose personal information. The product is designed to save work while making refusal and escalation normal outcomes.

## 4. Target customers

### Small Allegro shops

Owners or small teams who answer messages themselves and need simple automation without a large support platform.

### Growing sellers

Shops with a larger catalogue or message volume that need consistent replies, shared rules, product context, and an exception queue.

### High-volume operations

Teams that benefit from automatic sending, product-specific knowledge, post-purchase personalization, audit history, and usage monitoring.

### Enterprise prospects

The planning material describes sellers with more than 2,000 monthly messages, multiple Allegro accounts, custom configuration, dedicated support, and service guarantees. This remains a **proposal**, not a confirmed public offer.

## 5. Main customer jobs

- Reduce repetitive buyer support work.
- Answer faster and more consistently.
- Use the correct information for the product being discussed.
- Keep shop policies and tone consistent.
- Review AI suggestions before sending when desired.
- Identify conversations that need a person.
- Test behavior before activating automation.
- Learn from operator corrections.
- Send useful post-purchase messages.
- Review why a message was answered or escalated.
- Monitor plan usage and avoid unexpected interruption.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
Product register guidance from `PRODUCT.md` was merged on 2026-07-11; that
legacy file was removed after its positioning and design principles were
reconciled with this concept and the frontend design system.
