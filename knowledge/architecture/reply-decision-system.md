---
type: Architecture
title: Reply Decision System
description: Canonical routing, intent, conversation segmentation, usage enforcement, rules, and learning guidance.
resource: /architecture/reply-decision-system.md
tags: [architecture, autoresponder, rules, routing]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
last_reviewed: 2026-07-27
timestamp: 2026-07-27
---

## 9. Reply decision system

### Supported intents

| Intent | Meaning | Default route |
|---|---|---|
| Order status | Tracking, delivery, or order progress | Rule-based response |
| Product question | Specifications, fit, availability, compatibility, use | Knowledge-based response |
| Price negotiation | Discount or lower-price request | Rule-based response |
| Complaint | Complaint, return, damage, or refund demand | Human |
| Spam | Unrelated promotion or spam | Rule-based response |
| Non-actionable | Thanks, acknowledgement, or no action needed | Rule-based response |
| Out of scope | Unrelated or incoherent content | Human |
| Wants human | Explicit request for seller/operator contact | Human |

High-confidence pattern checks run before AI classification. If those checks do
not identify the intent, a lightweight AI classifier is used. A retryable
classifier failure receives at most three attempts in total; an exhausted or
permanent failure becomes a technical generation escalation instead of being
silently reclassified as a product question.

An explicit request for a person takes priority over complaint classification when both are present.

### Main processing sequence

1. The transport adapter loads the message and normalized conversation history.
2. The shared decision engine masks personal information before external AI use.
3. The engine classifies intent and chooses the route.
4. The engine checks topic and offer policy.
5. It resolves core and seller rules, or retrieves product and global knowledge.
6. It calculates confidence and generates only when the route and confidence
   permit it.
7. It returns an `answer`, `escalate`, or `block` outcome with exact buyer-facing
   text, detailed reason, evidence, and model usage.
8. The production adapter performs transport and business side effects.

Before entering the engine, the production adapter additionally confirms that
the account is due to run, the plan has remaining replies, the thread is not
under operator control, and the source message is neither stale nor already
processed.

### Shared decision engine and adapters

`autoresponder.decision_engine` is the canonical implementation for one bot
turn. The Allegro worker, the Rules-page message simulator, and the bot-eval
runner all call this engine with the same classifier, DRE generator, RAG
generator, policy snapshot, and normalized history.

- The production adapter polls Allegro, enforces subscription limits and stale
  message guards, sends or saves the outcome, and records attempts, cursors,
  suggestions, escalations, notifications, and customer usage.
- The simulator bypasses subscription limits and all production side effects.
  It still creates a separate technical AI-audit run with
  `execution_mode=simulator`, so token and cost observability remain available.
- The eval runner supplies deterministic fixtures but executes the same decision
  engine rather than a third behavioral implementation.

Answer outcomes include the same AI disclosure footer in every adapter.
Escalation outcomes expose exactly the configured escalation message; a blank
configuration deliberately produces no buyer-facing message.

### Failure and escalation semantics

- Disabled topics or offers use `auto_reply_disabled`.
- Missing knowledge, low confidence, or a valid grounded refusal use the
  `low_confidence` escalation category while retaining the detailed reason.
- Empty or structurally invalid model output and exhausted dependency failures
  use `generation_failed`.
- Explicit human requests, complaints, and out-of-scope content retain their
  dedicated categories.

Retryable model calls have exactly three attempts in total (the initial call and
two retries with short exponential backoff). Timeouts, connection failures,
408/409/429/5xx responses, and invalid model structures are retryable.
Authentication failures and other permanent 4xx responses stop immediately.
Valid RAG refusals and absence of retrieved fragments are business outcomes, not
technical errors, and are not retried. The OpenAI client has no nested retry.

### Conversation segmentation

The service separates a long Allegro thread into current conversational segments so an old complaint or closure does not incorrectly control a new exchange.

Important behaviors:

- A segment can look back up to 30 days.
- Clear closing phrases can end a prior segment.
- Negated phrases and questions are not treated as closures.
- A lightweight AI tiebreaker can resolve ambiguous boundaries.
- A newer buyer message prevents sending a stale generated reply.
- Operator messages are tracked so AI does not immediately answer a thread the operator has taken over.

### Reply length and disclosure

- Generated replies reserve room for an AI disclosure footer.
- The service uses a conservative message-length limit below Allegro's maximum.
- Post-purchase messages have their own strict body limit.

### Usage enforcement

- Only active or trialing subscriptions can generate billable replies.
- Base reply allowance:
  - Basic: 30 per billing period.
  - Pro: 60 per billing period.
- Paid extra reply packs extend the allowance only for the relevant billing period.
- Each successful AI answer counts through the recorded reply attempt.
- When no allowance remains, the message is refused, the thread needs operator attention, and a usage-limit notification can be created.

---

## 11. Rules and learning

### Rule hierarchy

1. Core safety rules.
2. Seller-defined rules.
3. Retrieved knowledge and task instructions.

Core rules are non-overridable. Seller rules are ordered and inserted after the safety layer.

Examples of suitable seller rules:

- Reply in Polish when the buyer writes in Polish.
- Do not offer discounts above a defined amount.
- Ask for an order number for order-related issues.
- Never provide a private phone number.
- Use a formal or informal tone.

### Learned-rule lifecycle

1. AI creates a suggestion.
2. The seller edits and sends it.
3. Personal information is removed from the comparison.
4. AI extracts a generalizable preference.
5. Invalid, personal, duplicate, or trivial results are discarded.
6. A valid learned rule appears in the separate learned-rules list.

Learned rules are best described as reusable preferences inferred from edits, not as unrestricted self-training.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
