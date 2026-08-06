---
type: Evaluation Suite
title: Autoresponder Segmentation Evals
description: Deterministic evaluation suite for conversation segmentation logic.
resource: /evals/autoresponder-segmentation-evals.md
tags: [evals, autoresponder, segmentation]
status: current
owner: project
source_paths:
  - backend/src/autoresponder/evals/README.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# Autoresponder Segmentation Evaluation

This directory contains a deterministic evaluation suite for the
conversation-segmentation logic in `autoresponder.segmentation`.

Allegro stores every exchange between a buyer and a seller in a single
flat thread. The segmenter detects where the *current* logical
conversation begins so the bot doesn't feed the LLM context from
unrelated, closed topics.

## How it works

`cases/segmentation_golden.json` contains hand-labeled threads. Each
case lists:

- `messages`: raw Allegro message dicts (the same shape returned by the
  Allegro API).
- `escalations`: any escalations that affect this thread, with their
  `resolved_at` timestamp. Used by the segmenter as a hard break.
- `expected_cutoff_id`: id of the first message of the current segment.
- `expected_reason`: which heuristic should have fired
  (`time_gap`, `offer_change`, `resolved_escalation`, `closure_marker`,
  or `no_break`).

The LLM tiebreaker is disabled during evaluation so the run is fully
deterministic.

## Running locally

```bash
cd backend
uv run python src/autoresponder/evals/evaluate_segmentation.py
```

The script exits with code `0` when every case matches both expected
cutoff id and expected reason, and `1` otherwise.

## Adding new cases

Add a JSON object to `segmentation_golden.json` with a unique `id`
and a descriptive `label`. Keep the message timestamps realistic
(use UTC ISO-8601). Set `expected_reason` to `no_break` if the entire
thread is a single segment.

When tuning thresholds (`THREAD_BREAK_HOURS`,
`CLOSURE_FOLLOWED_BY_SILENCE_HOURS`, etc.) in
`autoresponder/segmentation.py`, re-run the eval after each change to
make sure no case regresses.


# Provenance

Migrated from legacy path `backend/src/autoresponder/evals/README.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
