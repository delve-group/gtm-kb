---
type: Agent Guidance
title: Frontend Testing Rules
description: Canonical frontend testing state, intended jest-expo and React Native Testing Library harness, first coverage targets, and bot-eval boundary.
resource: /agent-guidance/frontend/testing.md
tags: [agents, frontend, testing, ci]
status: current
owner: project
source_paths:
  - frontend/package.json
  - frontend/jest.afterEnv.ts
  - frontend/testUtils/queryClient.ts
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-16
timestamp: 2026-07-16
---

# Testing

> **The harness now exists.** The redesign
> ([frontend redesign plan](../../plans/frontend-redesign-plan.md)) deliberately shipped the structure + CI gates and
> **deferred the test suite**; the first wave has since landed on exactly the
> harness described here. This file records that harness and what remains to
> cover. See [architecture.md](architecture.md) for the CI gates.

## Current state

The **jest-expo + React Native Testing Library** harness is in place: `npm test`
runs colocated `*.test.ts(x)` suites, and CI runs it after `typecheck`. The
first wave covers the boundary validator (`api/shared/parse.ts`), the query-key
factory (`api/queries/keys.ts`), the token-storage invariant
(`auth/sessionStorage.ts`), the 401-refresh single-flight
(`api/shared/authRefresh.ts`), and the production auth guard (`app.config.ts`).

The CI gate chain — lint, typecheck, `test`, `format:check`, `build:web`, and
`npm audit` (see [architecture.md](architecture.md)) — is the floor, not a
substitute for behavioural tests. Do not claim coverage that does not exist.

## Intended harness

- **Runner:** `jest-expo` (the Expo-aware Jest preset) so RN + web transforms,
  `@/` alias, and `EXPO_PUBLIC_*` env resolve the same way the app builds them.
- **Component tests:** `@testing-library/react-native` — assert on rendered
  output and behaviour (what the user sees / does), never on implementation
  detail or component internals.
- **Query hooks:** use `testUtils/queryClient.ts` for a fresh
  `QueryClientProvider` wrapper per test. Its deterministic defaults disable
  retries, background refetches, and cache-retention timers; mock the
  `api/<domain>` method, not axios. `jest.afterEnv.ts` clears every registered
  client after each test; keep stateful clients out of `jest.setup.ts`, which
  is reserved for early environment-wide mocks.
- **Files:** `*.test.ts(x)` colocated with the code under test. Arrow functions,
  `type` not `interface`, `@/` alias — the same convention as product code
  ([typescript.md](typescript.md), [react-components.md](react-components.md)).
- **Script:** add `"test": "jest"` (and `"test:watch"`) to `package.json`; wire
  it into CI after `typecheck`.

## What to cover first

Highest-value, lowest-flake targets — the money / identity / correctness paths
the redesign already hardened:

1. **The data layer** (`api/queries/`) — _remaining._ The query-key factory
   shape is covered; still to do is polling via `refetchInterval`, offset vs
   infinite pagination, and the optimistic-mutation-with-rollback path
   (especially the once-only optimistic send). See [data-layer.md](data-layer.md).
2. **Boundary parsing** (`api/shared/parse.ts` + a domain schema) — _covered._ A
   good response parses; a malformed one throws the generic boundary error and
   does not leak. See [security.md](security.md) and [api-domain.md](api-domain.md).
3. **Auth / session** — _covered._ Token refresh single-flight, the
   token-storage invariant (web persists nothing; native keeps the refresh token
   in secure-store only), and `EXPO_PUBLIC_DISABLE_AUTH` never reaching a
   production path.
4. **Shared components with logic** — _remaining._ `useAnchoredOverlay`,
   `OfferSelect` (single vs multiple), and the `Modal`/`Section`/`Card` shells
   that many features now depend on.

## Bot behaviour is evals, not unit tests

Anything touching the assistant's routing, reply text, grounding, escalation, or
safety is measured by the repo's **bot evals**, not by frontend unit tests (see
root `AGENTS.md`). Unit tests verify code paths; evals benchmark the end-to-end
AI flow. Do not substitute one for the other.

# Provenance

Migrated from `frontend/docs/conventions/testing.md` into the OKF bundle on
2026-07-09. It records the current no-suite state and the intended first test
harness without claiming coverage that does not exist.
