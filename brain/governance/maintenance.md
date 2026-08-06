---
type: Maintenance Protocol
title: Company Brain maintenance protocol
description: Rules for durable updates, agent proposals, ownership, provenance, and Git review.
tags: [governance, maintenance, agents, git, provenance]
status: stable
generated: { by: codex/gpt-5, at: "2026-08-06T17:25:35Z" }
stale_after: "2027-02-06"
sources:
  - id: legacy-maintenance
    resource: ../../knowledge/agent-guidance/knowledge-maintenance.md
    title: Legacy knowledge maintenance protocol
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format v0.2 specification
owner: team:company
visibility: internal
publication:
  status: prohibited
---
# Canonical boundary

`brain/` is the active company-wide bundle. `knowledge/` is retained source material. Generated artifacts and raw research do not become canonical knowledge merely because an agent created them.

# Agent update protocol

1. Read the smallest relevant index and concepts.
2. Identify whether the information is durable knowledge, temporary research, or an artifact.
3. Prefer editing an existing focused concept over creating a duplicate.
4. Preserve provenance with `sources` and claim footnotes where useful.
5. Record the current producer in `generated`.
6. Remove stale verification or approval when a meaningful change invalidates it.
7. Default new external findings to `draft` and `review-required` or `prohibited`.
8. Update indexes and `/log.md` when structure or durable knowledge changes.
9. Run validation and review the complete diff.

# Write-back from campaigns

Campaign learnings enter through a proposal. Good candidates include a verified event outcome, confirmed public handle, approved quote, reusable market insight, current CTA destination, or new proof item. Post wording, speculative keyword lists, and unverified profile matches stay in the campaign artifact.

# Do not store

- Secrets, credentials, tokens, or private keys.
- Private customer messages or personally identifiable customer data.
- Sensitive infrastructure access instructions.
- Private LinkedIn or social-platform data.
- Unapproved personal information, photos, or quotes.
