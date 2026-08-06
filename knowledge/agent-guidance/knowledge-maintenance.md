---
type: Agent Guidance
title: Knowledge Bundle Maintenance Protocol
description: Canonical rules for maintaining OKF project knowledge during future agent work.
resource: /agent-guidance/knowledge-maintenance.md
tags: [agents, okf, maintenance]
status: current
owner: project
source_paths:
  - docs/PROJECT_KNOWLEDGE_BASE.md
  - AGENTS.md
  - frontend/.cursor/rules/rules.md
  - frontend/.agents
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Canonical Knowledge Policy

The canonical project knowledge lives in this `knowledge/` bundle. Legacy documentation files that have been migrated should be removed, not kept as redirect stubs.

# OKF Maintenance Rules

- Treat `knowledge/index.md` as the starting point for durable project knowledge.
- Add new durable knowledge as an OKF concept instead of creating long-form docs under `docs/`, `backend/docs/`, or module-local README files.
- When changing product behavior, UI behavior, backend behavior, deployment, evals, compliance, pricing, or agent rules, update the relevant OKF concepts in the same change.
- Update `knowledge/log.md` with a date-grouped entry for every meaningful knowledge-bundle update.
- Remove old documentation files after migration unless they are active
  compatibility entry points such as `AGENTS.md`, `CLAUDE.md`, `README.md`, or
  `frontend/.cursor/rules/rules.md`.
- Preserve source provenance with `source_paths` frontmatter and short `# Provenance` sections. Use `# Citations` only for real surviving sources, preferably external sources or active repo files.

# Update Triggers

Update one or more OKF concepts whenever a change affects:

- Product positioning, customer-visible capabilities, or feature status.
- Pricing, allowances, referrals, roadmap proposals, or public marketing claims.
- Reply routing, escalation behavior, knowledge priority, or confidence.
- Privacy handling, safety rules, compliance boundaries, roles, or permissions.
- Backend modules, frontend UI behavior, deployment architecture, or operations.
- Eval datasets, eval workflows, agent rules, or coding conventions.

# Legacy Entry Points

- `AGENTS.md` remains the primary agent entry point and points agents into the
  bundle as a table of contents. Keep it compact; detailed rules belong in OKF
  concepts.
- `CLAUDE.md` remains a compatibility entry point for Claude-style tools and
  should be a symlink to `AGENTS.md`.
- `README.md` remains a concise repository entry point.
- `frontend/.cursor/rules/rules.md` remains a compact tooling entry point for
  Cursor-style tools because those tools auto-discover `.cursor/rules/`.
- `frontend/.claude/skills/` remains the home for procedural frontend authoring
  skills. Skills should point to OKF concepts for durable rules instead of
  copying those rules into each skill.
- `frontend/.agents/skills` is a compatibility symlink to
  `frontend/.claude/skills/` for frontend-local agent tooling. Do not edit
  through it as a separate source.
- `.agents/skills` is a compatibility symlink to `frontend/.claude/skills/`.
  Do not edit through it as a separate source.
- Specialized eval datasets remain beside their test runners; OKF concepts explain how to use them.


# Provenance

Migrated from legacy path `docs/PROJECT_KNOWLEDGE_BASE.md` into this OKF concept on 2026-07-08. The legacy file was removed after migration.
