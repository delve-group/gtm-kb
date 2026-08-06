---
type: Evaluation Suite
title: Bot Behavior Evals
description: Repo-local eval workflow for Superseller behavior.
resource: /evals/bot-behavior-evals.md
tags: [evals, bot-behavior, ai]
status: current
owner: project
source_paths:
  - agent-evals/README.md
last_reviewed: 2026-07-27
timestamp: 2026-07-27
---

# Superseller Bot Evals

This directory contains repo-local evals for measuring Superseller's
replies and business-flow decisions. These evals judge the runtime
bot behavior: routing, reply text, RAG grounding, escalation decisions, side
effects, trace evidence, and safety.

The workflow follows the OpenAI agent-evals guidance:

1. Inspect traces or run artifacts while behavior is still being debugged.
2. Promote stable expectations into repeatable datasets and eval runs.
3. Use graders to catch regressions in bot behavior over time.

See: https://developers.openai.com/api/docs/guides/agent-evals

## Layout

```text
agent-evals/
  cases/v1.json                    # benchmark bot-behavior cases
  fixtures/sample_pass.json         # known-good bot run artifact
  fixtures/sample_fail.json         # known-bad bot run artifact
  run_bot_cases.py                  # runner for the real local bot pipeline
  evaluate_bot_reply_run.py         # dependency-free local evaluator
```

## Run Locally

From the repository root:

```bash
python3 agent-evals/evaluate_bot_reply_run.py \
  --cases agent-evals/cases/v1.json \
  --run agent-evals/fixtures/sample_pass.json
```

That command only grades an existing run artifact. It does not call the bot or
the model.

To run cases through the local bot pipeline and then grade the generated
artifacts:

```bash
backend/.venv/bin/python -B agent-evals/run_bot_cases.py \
  --cases agent-evals/cases/v1.json \
  --output-dir agent-evals/runs/local
```

For live model runs, the runner automatically loads env files before checking
`OPENROUTER_API_KEY`. Shell environment variables win. Then it checks:

1. `agent-evals/.env`
2. `backend/.env`
3. `.env`

So you can keep using the backend env file, or create an eval-specific local
file:

```bash
cp agent-evals/.env.example agent-evals/.env
```

`agent-evals/.env` is ignored by git. For another path, pass `--env-file`:

```bash
backend/.venv/bin/python -B agent-evals/run_bot_cases.py \
  --cases agent-evals/cases/v1.json \
  --env-file /path/to/local.env
```

By default the runner uses `allegrobot.test_settings`, creates an in-memory test
database, seeds case-specific rules and retrieval fixtures, and calls the same
single-turn decision engine used by production and the simulator. It uses the
real model client for routing and reply generation, but does not call Allegro or
send real buyer messages. This keeps escalation wording, disabled-policy
handling, history, retry behavior, and product/global knowledge scope aligned
with runtime behavior.

For an offline plumbing check that does not call the model:

```bash
backend/.venv/bin/python -B agent-evals/run_bot_cases.py \
  --cases agent-evals/cases/v1.json \
  --output-dir /tmp/bot-eval-runs \
  --model-mode mock
```

Run one case only:

```bash
backend/.venv/bin/python -B agent-evals/run_bot_cases.py \
  --cases agent-evals/cases/v1.json \
  --case-id rag-product-waterproof-answer
```

Use `--live-retrieval` only when you want the runner to query a real configured
KB database instead of the deterministic per-case retrieval fixtures.

The evaluator exits with `0` only when every required check passes. It exits with
`1` for failed checks, invalid JSON, missing fields, or unknown `case_id`.

Write a machine-readable report with:

```bash
python3 agent-evals/evaluate_bot_reply_run.py \
  --cases agent-evals/cases/v1.json \
  --run agent-evals/fixtures/sample_pass.json \
  --json-output /tmp/bot-eval-report.json
```

## Run Artifact Schema

Each bot run is represented by one JSON object:

```json
{
  "case_id": "rag-product-waterproof-answer",
  "run_id": "manual-run-2026-07-07-001",
  "input": {
    "buyer_message": "Czy ta kurtka jest wodoodporna?",
    "offer_id": "offer-jacket-1"
  },
  "observed": {
    "intent": "PRODUCT_QUESTION",
    "route": "RAG",
    "decision": "answer",
    "reason": "answer_ready",
    "assistant_text": "Draft reply before send-time footer.",
    "sent_text": "Final text sent to Allegro.",
    "escalation_reason": null,
    "confidence": 0.86,
    "used_fragment_ids": ["frag-jacket-waterproof"],
    "sanitized_message": "Czy ta kurtka jest wodoodporna?"
  },
  "side_effects": {
    "sent_message": true,
    "suggestion_created": false,
    "escalation_created": false,
    "attempt_decision": "answer",
    "audit_final_decision": "answer"
  },
  "trace": {
    "model_inputs": ["Sanitized model-facing prompt or excerpts."],
    "kb_evidence": [
      {
        "fragment_id": "frag-jacket-waterproof",
        "selected": true
      }
    ]
  },
  "notes": "Optional evaluator-visible context."
}
```

`input` may contain the raw buyer message. Model-facing privacy checks inspect
`observed.sanitized_message`, `observed.assistant_text`, `observed.sent_text`,
`trace.model_inputs`, and `notes`; they intentionally do not fail just because
raw PII appears in `input.buyer_message`.

## Case Schema

Each case in `cases/v1.json` contains:

- `id`, `title`, `category`, and `task_prompt`.
- `input`: buyer message, offer id, and context scope for the benchmark.
- `setup`: runner-only fixtures such as tenant rules, RAG fragments, confidence
  details, and mock-model bodies for offline checks.
- `expected`: expected intent, route, decision, reason, confidence bounds,
  fragment evidence, side effects, escalation reason, and AI disclosure policy.
- `required_reply_markers`: substrings that must appear in the assistant or sent
  reply.
- `forbidden_reply_markers`: unsupported claims or unsafe text that must not
  appear in the assistant or sent reply.
- `forbidden_model_markers`: raw PII or unsafe text that must not appear in
  model-facing fields.

## Graders

The local evaluator is deterministic and dependency-free. It runs these required
checks:

- Expected intent, route, decision, reason, and escalation reason.
- Confidence minimum or maximum.
- Required reply markers.
- Forbidden reply markers.
- Forbidden model-facing markers.
- Required RAG fragment ids.
- Expected business side effects.
- Required AI disclosure footer.

This intentionally starts simple. If a future case needs semantic judgment,
add that as a separate explicit grader rather than weakening these checks.

## Adding Cases

Add or update a case whenever bot behavior changes. This is required by
`AGENTS.md`.

Good cases are concrete enough to benchmark the whole AI business flow:

- The buyer message and offer/context setup.
- The expected route, decision, and escalation behavior.
- The reply content that must appear.
- Claims that must not appear.
- The KB fragments or rules that should ground the answer.
- The side effects that should be written or avoided.
- The trace evidence needed to debug failures.

Regression fixes should include a case that would have failed before the fix.
Feature changes that do not affect bot behavior should state why no new eval case
is needed.

## OpenAI Evals Mapping

V1 is local-first and does not call OpenAI APIs. Later, these files can map to
OpenAI evals as follows:

- `cases/v1.json` entries become dataset items.
- Bot run artifacts become samples.
- Deterministic local checks become graders.
- Production trace metadata can be added to the run artifact once the bot runner
  exports it consistently.


# Provenance

Migrated from legacy path `agent-evals/README.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
