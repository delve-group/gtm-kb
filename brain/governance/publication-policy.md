---
type: Publication Policy
title: Public-content publication policy
description: Fail-closed rules for turning Company Brain knowledge and live research into external drafts.
tags: [governance, publication, marketing, safety, claims]
status: stable
generated: { by: codex/gpt-5, at: "2026-08-06T17:25:35Z" }
stale_after: "2027-02-06"
sources:
  - id: legacy-commercial-model
    resource: ../../knowledge/product/commercial-model.md
    title: Legacy commercial model and marketing truth
  - id: legacy-privacy
    resource: ../../knowledge/architecture/privacy-safety-compliance.md
    title: Legacy privacy, safety, and compliance design
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format v0.2 specification
owner: team:company
visibility: internal
publication:
  status: prohibited
---
# Retrieval boundary

- Public drafts may reuse claims from fresh, stable, public, `approved` concepts.
- `review-required` concepts may inform a draft only when every derived factual claim is surfaced in the evidence receipt for human review.
- `prohibited` or internal concepts may guide planning but their private facts must not appear in the public draft or be sent to an external research service.
- Draft, deprecated, stale, or unsourced concepts never silently become factual public claims.

# Claim rules

- Prefer current customer behavior over historical plans.
- No source means omit the claim or ask for confirmation.
- Separate product capability from performance proof.
- Omit unsupported metrics, customer identities, pricing, legal assurances, or availability claims.
- Never guarantee compliance, perfect safety, zero hallucinations, zero leakage, reply speed, or time savings.
- Generated artifacts are always review-required, regardless of source approval.

# People, tags, quotes, and media

- Confirm identity, relevance, and tagging consent separately.
- A public profile is not proof of event participation or endorsement.
- Do not quote a person without a source and permission appropriate to the context.
- Do not use a team or event photo without confirmed usage permission.
- Never scrape or expose private LinkedIn data.

# External actions

The Campaign Studio drafts and recommends. It must not publish, tag, message, follow, connect, upload, or contact anyone without a separate explicit user request and appropriate confirmation.

# Approval procedure

To approve a concept, a human reviewer must:

1. Check the body against every source.
2. Resolve knowledge gaps that affect public meaning.
3. Add a current `verified` event.
4. Set `publication.status: approved` with their `human:` actor and approval time.
5. Choose a meaningful future `stale_after` date.
6. Review the Git diff and run validation.
