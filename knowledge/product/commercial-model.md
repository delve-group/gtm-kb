---
type: Product Knowledge
title: Commercial Model and Marketing Truth
description: Canonical billing, referral, roadmap proposal, and safe marketing claim guidance.
resource: /product/commercial-model.md
tags: [product, billing, marketing, roadmap]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
last_reviewed: 2026-07-16
timestamp: 2026-07-08
---

## 14. Billing and commercial model

### Current plans

| Plan | Monthly price shown | Yearly price shown | Base AI replies | Positioning |
|---|---:|---:|---:|---|
| Basic | 79.99 PLN | 863.89 PLN | 30 | Smaller shops automating common questions |
| Pro | 139.99 PLN | 1,511.89 PLN | 60 | Active sellers with higher conversation volume |

Yearly billing is presented as a 10% discount:

- Basic: 71.99 PLN monthly equivalent.
- Pro: 125.99 PLN monthly equivalent.

### Current plan differentiation

Basic:

- Shop knowledge.
- General post-purchase message.
- 30 AI replies per billing period.

Pro:

- Larger reply allowance.
- Custom response rules.
- Offer-specific priority post-purchase messages.
- 60 AI replies per billing period.

### Extra replies

Current service values:

- One pack adds 20 replies.
- Current service label is 10 PLN.
- Packs apply to the current matching billing period.
- Purchase requires an active eligible subscription.

Treat pack price and all public plan contents as **needs confirmation** before publishing.

### Subscription states

- Inactive.
- Pending.
- Active.
- Trialing.
- Past due.
- Canceled.
- Unpaid.

Payments, recurring subscriptions, additional packs, customer self-service, and payment recovery are handled through Stripe.

### Older pricing proposals

Older documents describe Free, Starter, Pro, and Business tiers, SMS bundles, and paid knowledge pulls. Those values conflict with the current Basic/Pro product and are not current truth.

Do not advertise:

- Free or Starter plans.
- 500 or 2,000-message allowances.
- SMS bundles.
- Paid knowledge pulls.
- Business pricing.

unless commercial ownership explicitly revives them.

---

## 15. Referral program

**Status: backend-ready, no complete customer UI**

Current capabilities:

- Unique eight-character referral code per referrer.
- Shareable registration link.
- Code redemption only for a new customer.
- Self-referral blocked.
- One received referral per customer account.
- Pending, qualified, rewarded, and rejected states.
- Referee coupon can be attached to first checkout.
- Qualification after the first paid invoice.
- Default 14-day refund window.
- Referrer reward processed after the window.
- Monthly referrer subscription can receive a configured coupon.
- Annual referrer subscription receives a credit equal to one month of the current annual price.
- Default soft review threshold: 12 rewards per year.
- Same billing-customer identity on both sides is rejected.
- Customer-facing referral modal with the shareable link, code, and
  aggregate status counts.

Important limitations:

- NIP comparison is only a placeholder unless explicitly enabled and completed.
- Allegro-account identity and card-fingerprint checks are not implemented.
- Coupon percentages/amounts are deployment configuration, not guaranteed product values.
- The customer modal does not expose per-referral details or exact reward
  values.

The business proposal suggests a first-month discount for the referred seller and a later reward for the referrer. Exact percentages remain undecided.

---

## 23. Roadmap and commercial proposals

The following ideas are preserved from planning material but are not current commitments:

- NIP verification and one-company-per-account controls.
- SMS alerts for new discussions and sales.
- Purchasable SMS bundles.
- Paid knowledge-refresh credits.
- Public native mobile distribution.
- Multiple Allegro accounts.
- Enterprise contracts.
- Dedicated account manager.
- Four-business-hour support target.
- Monthly performance review for Enterprise.
- Custom integrations and message footers.
- Formal referral marketing and reward screens.

### Enterprise proposal snapshot

Intended audience:

- More than 2,000 monthly messages.
- Multiple stores/accounts.
- Need for custom setup or support guarantees.

Proposed service:

- Individual pricing.
- Dedicated contact.
- Assisted onboarding.
- Priority support.
- Monthly review.
- Custom work.

None of these terms should be published without commercial approval.

---

## 24. Marketing and sales truth

### Safe claims

- Connect an Allegro seller account.
- Synchronize active offers.
- Prepare product knowledge from offer descriptions and parameters.
- Add general shop and product-specific documents.
- Define rules the assistant must follow.
- Choose automatic replies or editable suggestions.
- Learn reusable preferences from seller edits.
- Test replies and escalations before activation.
- Pass uncertain, complaint-related, or unsupported cases to a person.
- Show sources, rules, confidence, and outcomes.
- Send post-purchase messages with order variables.
- Create offer-specific post-purchase variants on Pro.
- Track used and remaining AI replies.

### Claims requiring confirmation

- Final public domain.
- Final plan prices and allowances.
- Unlimited AI.
- Exact time or cost savings.
- Customer counts, testimonials, or logos.
- Enterprise availability and support targets.
- Email, SMS, or push availability.
- Multi-account support.
- Referral reward values.
- Public mobile-app availability.
- Data residency, uptime, legal certification, or compliance guarantees.

### Proof to collect

- Median first-response time.
- Messages handled automatically.
- Escalation rate.
- Suggestion acceptance and edit rate.
- Weekly operator time saved.
- Product catalogue coverage.
- Knowledge gaps found through escalations.
- Post-purchase delivery success.

Until measured data exists, use product screenshots and demonstrations rather than invented metrics.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
