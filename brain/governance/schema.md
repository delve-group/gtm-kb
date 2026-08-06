---
type: Governance Standard
title: Company Brain OKF profile
description: OKF v0.2 fields and local metadata required for safe agent consumption and public-content work.
tags: [governance, okf, schema, validation]
status: stable
generated: { by: codex/gpt-5, at: "2026-08-06T17:25:35Z" }
stale_after: "2027-02-06"
sources:
  - id: okf-spec
    resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
    title: Open Knowledge Format v0.2 specification
    author: team:google-cloud-platform
owner: team:company
visibility: internal
publication:
  status: prohibited
---
# Standard fields

Every concept uses OKF v0.2:

- `type`: required by OKF; descriptive, open vocabulary.
- `title` and `description`: required by this repository for retrieval and indexes.
- `tags`: optional list of unique strings.
- `sources`: structured provenance; each entry requires `resource`.
- `generated`: required locally with `by` actor and `at` ISO 8601 datetime.
- `verified`: optional verification event or list of events.
- `status`: required locally; `draft`, `stable`, or `deprecated`.
- `stale_after`: absolute date when the concept becomes stale.

Do not reuse the legacy bundle's custom `status` values. Product maturity belongs in a separate domain field such as `feature_state` when needed.

# Local fields

```yaml
owner: human:mike | team:marketing
visibility: public | internal
publication:
  status: approved | review-required | prohibited
  by: human:mike       # required only for approved
  at: 2026-08-06T18:00:00Z
```

Metadata is a retrieval and publication policy, not access control. Sensitive information does not belong in this repository.

# Approval invariant

An approved concept must be public, stable, sourced, fresh, human-verified after its last meaningful change, and approved by a `human:` actor at or after that change.

Missing visibility or publication metadata fails closed as internal and prohibited.

# Indexes and logs

- The root `index.md` declares `okf_version: "0.2"`.
- Other indexes and logs have no frontmatter.
- Every knowledge directory has an index covering its direct concepts and child knowledge directories exactly once.
- Log date headings use ISO `YYYY-MM-DD`, newest first.

# Attribution

A claim footnote such as `[^okf-spec]` must match a `sources[].id` entry. Use bundle-relative links beginning `/` for links between active concepts. Relative source paths may point to retained repository evidence such as `knowledge/`.
