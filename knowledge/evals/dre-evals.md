---
type: Evaluation Suite
title: DRE Evals
description: Deterministic and LLM-based evaluations for the deterministic rules engine.
resource: /evals/dre-evals.md
tags: [evals, dre, rules]
status: current
owner: project
source_paths:
  - backend/src/dre/evals/README.md
last_reviewed: 2026-07-08
timestamp: 2026-07-08
---

# DRE Evaluation Suite

Deterministic + LLM-based evaluations for the Deterministic Rules Engine module.

## 1. Deterministic Evals (no LLM)

Pure substring/ordering assertions. No API key needed.

```bash
cd backend
PYTHONPATH=src python3 src/dre/evals/evaluate_dre.py
```

### Adding cases

Add a JSON object to `cases/dre_golden_cases.json`:

```json
{
  "id": 8,
  "description": "What this case tests",
  "core_rules": null,
  "user_rules": null,
  "assertions": {
    "contains": ["must be present"],
    "not_contains": ["must be absent"],
    "order": [["A before", "B"]]
  }
}
```

---

## 2. LLM Evals (live API calls)

Sends adversarial customer messages through the DRE system prompt to an LLM,
then uses a separate LLM Judge to verify rule compliance.

Requires `OPENAI_API_KEY` in the environment.

```bash
cd backend
PYTHONPATH=src python3 src/dre/evals/evaluate_dre_llm.py
PYTHONPATH=src python3 src/dre/evals/evaluate_dre_llm.py --model gpt-4o --judge-model gpt-4o
```

### How it works

1. For each case in `cases/dre_llm_cases.json`:
   - Builds the system prompt via `DeterministicRulesEngine`
   - Calls the LLM with the system prompt + adversarial customer message
   - Passes the response to `DREJudge` which returns a structured `passed/failed` verdict
2. Reports per-case results and exits `0` (all pass) or `1` (any fail).

### Adding cases

Add a JSON object to `cases/dre_llm_cases.json`:

```json
{
  "id": 11,
  "description": "What the adversarial scenario tests",
  "core_rules": null,
  "user_rules": ["Optional tenant-specific rule"],
  "customer_message": "The adversarial customer message",
  "rule_tested": "Which rule is being targeted"
}
```


# Provenance

Migrated from legacy path `backend/src/dre/evals/README.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
