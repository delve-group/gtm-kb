---
type: Agent Guidance
title: Frontend Architecture and Definition of Done
description: Canonical frontend target tree, feature shape, layering rules, verification gates, and frontend rule/skill maintenance protocol.
resource: /agent-guidance/frontend/architecture.md
tags: [agents, frontend, architecture, ci]
status: current
owner: project
source_paths:
  - knowledge/plans/frontend-redesign-plan.md
  - frontend/.cursor/rules/rules.md
  - frontend/.agents
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Architecture & the definition of "done"

> This is the floor every change in the frontend builds on. It is seeded in
> Phase 0 of the [frontend redesign plan](../../plans/frontend-redesign-plan.md)
> and grows as later phases land
> their conventions. Sibling files in this folder (`data-layer.md`,
> `shared-ui.md`, `platform.md`, `typescript.md`, `react-components.md`,
> `code-style.md`, `api-domain.md`, `security.md`, `testing.md`) are written by the phase that
> establishes each convention; Phase 6 finalizes the index and cross-links.

## Target directory shape

```
frontend/
  app/                          # thin Expo Router routes only (render a View, no logic)
  features/<feature>/           # EVERY feature has the identical shape:
    <Feature>View.tsx           #   thin: composes sub-components + hooks
    components/                  #   one small component per file
    hooks/                       #   feature hooks = thin wrappers over the data layer
    index.ts                     #   barrel (the feature's public surface)
  shared/
    ui/                          # gluestack primitives (VENDORED — do not edit) + promoted
                                 #   custom controls that behave like primitives
    components/                  # cross-feature composed components (Modal, Section, Card,
                                 #   EmptyState, NotConnectedView, WarningBanner, StateBadge…)
    components/panels/           # cross-feature capability panels (AllegroConnect, AutoReplyConfig…)
    hooks/                       # cross-feature hooks (useAuthGate, useAnchoredOverlay, useBreakpoint…)
    lib/                         # helpers (platform.ts, measure.ts, appToast…)
  api/
    <domain>/                    # one dir per endpoint (index.ts+types+schemas+mappers) + shared root files + index.ts barrel
    queries/                     # query keys + typed query/mutation hooks + poll intervals
  store/                         # zustand: ONLY session/client/UI state (auth, locale, theme, flags)
  lib/  i18n/                    # cross-cutting utilities and translations
  ../knowledge/agent-guidance/frontend/
                                 # canonical frontend rule concepts
  .claude/skills/                # repo authoring skills (add-feature, add-api-domain, ...)
  .agents/skills                 # symlink to .claude/skills for frontend-local agent tooling
  ../.agents/skills              # symlink to .claude/skills for agent tooling
```

## Authoring skills are required

Before coding a frontend change, choose the matching skill from
`frontend/.agents/skills/` (symlinked to `frontend/.claude/skills/`):

- `add-feature` for a new nav view or product surface.
- `add-api-domain` for a new backend resource/API domain.
- `add-api-endpoint` for a new endpoint in an API domain.
- `add-query-hook` for server-state fetching, polling, pagination, or mutation.
- `add-shared-component` for reusable UI or feature-to-shared promotion.

The root `.agents/skills` path is a symlink to the same skill directory.
The frontend-local `frontend/.agents/skills` path is also a symlink to
`frontend/.claude/skills`.

## The identical feature shape

Every feature under `features/<name>/` ends in the same four parts and nothing
else at the top level:

- `<Feature>View.tsx` — thin composition of sub-components + hooks. No data
  orchestration inline; that lives in `hooks/`.
- `components/` — one small, named-export component per file.
- `hooks/` — thin wrappers over the `api/queries/` data layer (server state) or
  `store/` (client state).
- `index.ts` — the barrel that is the feature's only public surface. Consumers
  import the barrel, never a file inside the feature.

`app/` route files are the only place `export default` is allowed (Expo Router
requires it); everything else uses inline named exports.

## Layering rules

- **Server state → the data layer** (`api/queries/`, TanStack Query). No
  hand-rolled `loading/error/poll` skeletons and **no `setInterval` polling in
  components**.
- **Session / client / UI state → `store/`** (zustand): auth, locale, theme,
  feature flags. Not server data.
- **Reusable UI → `shared/`**, checked _before_ writing or composing UI. Always
  inspect `@/shared/components`, `@/shared/components/panels`, `@/shared/ui`,
  `@/shared/hooks`, and `@/shared/lib` first. If an existing shared component
  fits, reuse it. If a capability could be used by two features (e.g. the
  Allegro-connect panel used by both settings and onboarding), promote it to
  `shared/` instead of copying or rebuilding it inside a feature.
- **Platform / breakpoints → one source of truth** (`shared/lib/platform.ts` +
  `shared/hooks/useBreakpoint.ts`). Never re-derive `isMobile`/`isDesktop`
  inline.

## The definition of "done" (verification gates)

Every change must leave all of these green — locally and in CI
(`.github/workflows/ci.yml`, which runs them on every push/PR touching
`frontend/`):

```
npm run lint          # expo lint
npm run typecheck     # tsc --noEmit
npm run format:check  # prettier --check .
npm run build:web     # expo export -p web
npm audit --omit=dev --audit-level=high
```

CI **is** the gate: if it is red, the change is not done. New conventions are
enforced by adding lint rules (from Phase 5 onward), so "the doc says X" and
"the machine rejects not-X" stay in agreement.

## Non-negotiable guards already in place

- **Auth landmine:** `app.config.ts` throws on a production build
  (`NODE_ENV=production`) when `EXPO_PUBLIC_DISABLE_AUTH="true"`, so a dev-only
  auth bypass can never reach a web export or native release.
- **Public env only:** only `EXPO_PUBLIC_*` variables are bundled into the
  client — they are public. No secrets client-side. `.env` is gitignored;
  `env.example` documents the build variables.

## Rules & skills evolve with the code

When a change makes you decide "we always do X this way," that decision ships as
an edit to the relevant concept in this folder in the same PR, and any new
reusable machinery ships with (or updates) its authoring skill under
`.claude/skills/`. Do not defer conventions to a later phase.

# Provenance

Migrated from `frontend/docs/conventions/architecture.md` into the OKF bundle on
2026-07-09. The rules were originally emitted by the frontend redesign plan and
then reconciled against the shipped Expo app.
