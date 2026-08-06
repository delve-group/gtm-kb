---
type: Test Knowledge
title: Runtime KB Artifacts
description: Generated and uploaded runtime KB artifacts that are not canonical repo knowledge.
resource: ../../backend/src/media/kb/global/
tags: [test-knowledge, generated, runtime, rag]
status: generated
owner: project
source_paths:
  - backend/src/media/kb/global/
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# Runtime KB Artifacts

`backend/src/media/kb/global/` contains uploaded or generated runtime knowledge-base files when the app has been exercised locally. These artifacts are intentionally ignored by git through the `media/` ignore rule and should not be treated as canonical documentation.

Observed local examples include generated `allegro-offer-*` text files, duplicated PDF uploads, and a DOCX business-plan sample. They are useful for local debugging but should not be migrated into the OKF bundle unless a future task explicitly promotes one into a tracked fixture.

# Handling Rules

- Do not commit runtime files from `backend/src/media/kb/global/` as part of knowledge maintenance.
- If a runtime artifact becomes a stable test fixture, move it into a tracked fixture directory first and add a dedicated OKF concept.
- Keep canonical RAG fixture knowledge documented in [RAG Fixture Documents](/test-knowledge/rag-fixtures.md).
