---
type: Architecture
title: Knowledge and Confidence System
description: Canonical knowledge priority, document processing, and confidence calculation guidance.
resource: /architecture/knowledge-confidence.md
tags: [architecture, knowledge, rag, confidence]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
last_reviewed: 2026-07-27
timestamp: 2026-07-27
---

## 10. Knowledge and confidence system

### Knowledge priority

1. Offer-specific knowledge.
2. General shop knowledge.

Both can contribute to the answer, but product fragments receive a score advantage.

An `offer_id` selects both offer-specific and general shop knowledge. Without an
offer selection, retrieval is intentionally global-only. The saved simulator
favorites contract persists this optional selection so reopening a scenario
reproduces the same knowledge scope.

### Document processing

1. Accept PDF, DOCX, or TXT.
2. Extract and clean text.
3. Split text into overlapping chunks.
4. Create semantic representations.
5. Store chunks for similarity search.
6. Promote the newest successful version.

Current defaults:

- Roughly 600-token chunks.
- Roughly 100-token overlap.
- 1,536-dimensional embeddings.
- Up to 12 product candidates.
- Up to 8 global candidates.
- Up to 8 final fragments.
- 1,500-token combined knowledge budget.
- Product score boost of 0.10.

### Confidence calculation

The confidence score combines:

- Best source similarity: 45%.
- Mean source similarity: 30%.
- Number of sources: 15%.
- Agreement between source types: 10%.

The current threshold is **0.40**.

- At or above the threshold: generation may proceed.
- Below the threshold: pass to a person.
- No sources: do not invent an answer.
- Automatic reply disabled for the offer: pass to a person.

The simulator uses the same retrieval and confidence code as production,
including the complete normalized conversation history. It exposes confidence,
selected fragment identifiers, and knowledge evidence so sellers can understand
and tune their setup without creating production attempts or escalations.

---

# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
