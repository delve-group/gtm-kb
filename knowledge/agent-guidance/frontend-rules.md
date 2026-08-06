---
type: Agent Guidance
title: Frontend Architecture and Tooling Rules
description: Canonical frontend TypeScript, React Native, Expo, API, and feature-architecture rules - index into the modular OKF frontend rule concepts.
resource: /agent-guidance/frontend-rules.md
tags: [agents, frontend, cursor-rules]
status: current
owner: project
source_paths:
  - frontend/.cursor/rules/rules.md
  - frontend/.claude/skills/
  - frontend/.agents
  - knowledge/agent-guidance/frontend/
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Frontend rules — index

The canonical, per-topic frontend rules live in
**`knowledge/agent-guidance/frontend/`**. Each concept is paired with the CI/lint
gate that enforces it where a machine can enforce the rule, so "the doc says X"
and "the machine rejects not-X" stay in agreement.
`frontend/.cursor/rules/rules.md` (symlinked as `frontend/CLAUDE.md` and
`frontend/AGENTS.md`) is only a tooling entry point that points here.

Read [architecture.md](frontend/architecture.md) first -
it holds the target tree, the identical feature shape, and the verification gates
that define "done". Then read only the topic file relevant to your change:

- [architecture.md](frontend/architecture.md) - feature
  shape, `shared/` layering, `api/queries/`, server-vs-client state, CI gates.
- [typescript.md](frontend/typescript.md) - `type` only,
  `&` over `extends`, no `any`, `undefined` over `null`.
- [react-components.md](frontend/react-components.md) -
  arrow-only, no `React.FC`, one component per file, tokens-not-hex,
  gluestack-only, minimize effects.
- [code-style.md](frontend/code-style.md) - always brace
  control statements (no inline `if`), blank lines between multi-line blocks,
  comments explain _why_ not _what_ (no banner dividers).
- [data-layer.md](frontend/data-layer.md) - TanStack
  Query: query-key factory, polling via `refetchInterval`, pagination, optimistic
  mutations, **no `setInterval` in components**.
- [shared-ui.md](frontend/shared-ui.md) - the shared
  component catalogue, overlay positioning via `useAnchoredOverlay`,
  add-here-not-in-a-feature, dedupe-across-features.
- [platform.md](frontend/platform.md) - web-priority /
  native-first-class; `platform.ts` + `useBreakpoint` as the only source of
  truth; Tailwind vs JS vs `.web.tsx`/`.native.tsx` splits; named breakpoints.
- [api-domain.md](frontend/api-domain.md) - one directory
  per endpoint (`index.ts` method + camelCase `types.ts` + snake_case `*Api`
  `schemas.ts` + `mappers.ts`), shared pieces at the domain root, `index.ts`
  barrel; validation + snake_case→camelCase mapping at the boundary; error
  handling via `extractApiError`.
- [security.md](frontend/security.md) - token-storage
  invariant, `EXPO_PUBLIC_*` = public / no client secrets, CSP + headers,
  treat LLM-fed content as data.
- [testing.md](frontend/testing.md) - the deferred
  jest-expo + RTL harness and what to cover first (aspirational until the suite
  lands).

# Required Frontend Skills

Before coding, choose the matching authoring skill. These skills are important:
they are the operational checklists that turn the OKF rules into correctly
shaped files.

- New nav view or product surface:
  `frontend/.agents/skills/add-feature/SKILL.md`
- New backend resource/API domain:
  `frontend/.agents/skills/add-api-domain/SKILL.md`
- New endpoint in an API domain:
  `frontend/.agents/skills/add-api-endpoint/SKILL.md`
- New fetch, poll, paginate, or mutation hook:
  `frontend/.agents/skills/add-query-hook/SKILL.md`
- New reusable UI or feature-to-shared promotion:
  `frontend/.agents/skills/add-shared-component/SKILL.md`

The skills are procedural checklists; durable rules belong in this OKF bundle.
`frontend/.agents/skills` and `.agents/skills` are compatibility symlinks to
`frontend/.claude/skills/`; neither is a separate source.

# Critical enforcement (summary)

- React / React Native + TypeScript. `type`, not `interface` (compose with `&`).
- Arrow functions only; no `function` declarations; no `React.FC`.
- Always brace control statements — no inline/single-line `if`; blank lines
  between multi-line blocks; comments explain _why_, not _what_ (no banners).
- Inline named exports; `export default` only in `app/` route files.
- Gluestack primitives from `@/shared/ui`; semantic theme tokens with `dark:`
  variants — never hardcoded hex.
- Always check `@/shared/components`, `@/shared/components/panels`,
  `@/shared/ui`, `@/shared/hooks`, and `@/shared/lib` before building UI,
  controls, overlays, modals, layout helpers, or cross-feature logic. Reuse the
  shared component when it fits; promote there first when the need is reusable.
- Thin route files; feature logic under `features/<name>/` in the identical
  shape (`View` + `components/` + `hooks/` + `index.ts`).
- Server state through the `api/queries/` data layer — no `setInterval` polling
  in components. Session/UI state in `store/` (zustand).
- One API method per file under `api/<domain>/`, imported via the domain barrel;
  zod-validate at the trust boundary only.
- One platform/breakpoint source of truth (`shared/lib/platform.ts` +
  `shared/hooks/useBreakpoint.ts`); never re-derive `isMobile`/`isDesktop`.
- Read and update the OKF bundle (this file + `frontend/*.md`) when frontend
  behaviour or rules change.

# Facts kept current

- **Auth is Django JWT**, not Supabase — access/refresh tokens via
  `auth/djangoAuth.ts` and the `api/shared/apiInstance.ts` interceptors (a
  single-flight 401-refresh factory shared with `api/allegro`). There is no
  Supabase client.
- **API domains** under `frontend/api/`: `allegro`, `audit`, `auth`, `billing`,
  `feedback`, `knowledge-base`, `onboarding`, `postbuy`, `queries` (the data
  layer), `referral`, `rules`, `shared` (transport + error + config + parse
  infra), `simulator`, `simulator-chat` (lazy AI SDK streaming transport),
  `waitlist`.
- **Testing:** no unit/integration suite yet — the redesign shipped structure +
  CI gates and deferred the suite. CI (lint, typecheck, `format:check`,
  `build:web`, `npm audit`) is the current gate; see `testing.md` for the
  intended harness.

# Provenance

Migrated from `frontend/.cursor/rules/rules.md`. The detailed rules were first
split into modular frontend convention files during the frontend redesign, then
moved into `knowledge/agent-guidance/frontend/` on 2026-07-09 so OKF is the
single source of durable agent guidance. This concept carries the enforcement
summary that read-only tooling relies on.
