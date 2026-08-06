---
type: Agent Guidance
title: Coding Guidelines
description: Canonical cross-cutting coding, eval, visual-QA, compatibility, and comment/docstring guidance for agents.
resource: /agent-guidance/coding-guidelines.md
tags: [agents, coding, evals]
status: current
owner: project
source_paths:
  - AGENTS.md
  - CLAUDE.md
  - knowledge/backend/agent-rules.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Coding Guidelines

## General

- **Always use English for everything written in the repository**, including
  documentation, code, identifiers, log messages, comments, docstrings, test
  descriptions, and commit/PR text.
- Follow established best practices and the repo's current patterns.
- Favor consistency, clean code, and simplicity over cleverness.
- Before adding a utility or helper, check `@/shared/lib` and `@/shared/hooks`
  for an existing shared implementation; reuse it when it fits instead of
  duplicating it locally.
- Keep durable agent rules in this OKF bundle. `AGENTS.md`, `CLAUDE.md`, and
  frontend Cursor rules are compatibility entry points, not the canonical home
  for detailed guidance.
- Backend-specific TDD, pytest, config, error-contract, and review rules live in
  [Backend Agent Rules](../backend/agent-rules.md).

## App Versioning

- Every included application change must bump the app version before handoff.
- Choose the smallest appropriate [Semantic Versioning](https://semver.org/)
  increment without asking for a separate version decision:
  - **Patch** for backward-compatible fixes, internal changes, documentation,
    and other non-user-facing changes.
  - **Minor** for backward-compatible user-facing features or meaningful new
    capabilities.
  - **Major** for incompatible public API changes, removed user-facing behavior,
    or required migration/breaking changes.
- Update every repository source of the shipped app version that must remain in
  sync. State the selected version and SemVer rationale in the final handoff.

## Tests Worth Writing

- Do not add tests that only restate the implementation: field-by-field mapper
  assertions, pass-through wrappers, or schema shapes the type system and the
  boundary parse already enforce. They cost review attention, break on harmless
  renames, and pass whether or not the code is right.
- Test logic that can be wrong: branching, non-trivial parsing and formatting,
  cache and invalidation behavior, and any past regression worth pinning.
- A new API endpoint, mapper, or query hook needs no test by default. Add one
  when it carries real logic or when a bug proves it does.

## Superseller Bot Evals

- This repository uses bot evals to measure Superseller's behavior: routing,
  reply text, RAG grounding, escalation decisions, side effects, audit evidence,
  and safety.
- Follow the OpenAI agent-evals model: inspect traces first, then promote stable
  bot-behavior expectations into repeatable datasets and eval runs.
- When adding or changing bot behavior, update the bot eval dataset with at
  least one case that captures the expected buyer message, context, decision,
  reply constraints, escalation behavior, and required verification evidence.
- When fixing a bot-behavior regression, add or update an eval case that would
  have caught the failed reply, routing, grounding, escalation, or safety
  behavior before the fix.
- Do not treat ordinary unit tests as a substitute for these evals. Unit tests
  verify code paths; bot evals benchmark the quality and safety of the
  end-to-end AI business flow.
- If a feature does not affect bot behavior and does not need a new eval case,
  state why in the final response.

## Frontend Visual Changes

- Never run the app yourself to test visual changes.
- Use static checks, code review, screenshots supplied by the user, or explicit
  user-directed verification instead.

## Comments And Docstrings

- Write every comment and docstring in English.
- Keep comments and docstrings minimal.
- Add comments only when they explain why non-obvious logic exists.
- Do not add boilerplate Args/Returns docstrings for ordinary internal
  functions.

Bad:

```python
# Increment counter
counter += 1
```

Good:

```python
# Allegro pages are 1-indexed; keep UI display aligned with the API.
counter += 1
```

## Compatibility

The old Polish `CLAUDE.md` content is not copied here. English guidance is
canonical for all coding agents; `CLAUDE.md` is only an entry-point pointer.

# Provenance

Trimmed on 2026-07-09 after backend-specific rules moved to
`knowledge/backend/agent-rules.md`.
