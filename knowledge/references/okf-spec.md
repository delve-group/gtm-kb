---
type: Reference
title: Open Knowledge Format v0.1 Reference
description: Reference links and local conventions for this repository's OKF bundle.
resource: https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
tags: [okf, reference, spec]
status: external
owner: GoogleCloudPlatform/knowledge-catalog
source_paths:
  - https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf
  - https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# Open Knowledge Format v0.1

This repository targets Google's Open Knowledge Format v0.1 draft from `GoogleCloudPlatform/knowledge-catalog`.

Local conventions extend OKF with these producer-defined frontmatter fields:

| Field | Meaning |
| --- | --- |
| `status` | One of `current`, `backend-ready`, `proposal`, `needs-confirmation`, `historical`, `generated`, or `external`. |
| `owner` | Owning project area, team, or repository. |
| `source_paths` | Original source files migrated into or represented by the concept. |
| `last_reviewed` | Date the concept was last reviewed against repository state. |

# Local Concept Types

Use these `type` values for new concepts unless a future migration deliberately extends the vocabulary:

- `Product Knowledge`
- `Architecture`
- `Backend Module`
- `Frontend Guidance`
- `Agent Guidance`
- `Evaluation Suite`
- `Operations Runbook`
- `Historical Plan`
- `Test Knowledge`
- `Reference`
- `Inventory`

# Citations

[1] [Google OKF README](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf)
[2] [Google OKF SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
