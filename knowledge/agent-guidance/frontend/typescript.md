---
type: Agent Guidance
title: Frontend TypeScript Rules
description: Canonical frontend TypeScript rules for types over interfaces, no any, undefined over null, seam typing, and shared type sources.
resource: /agent-guidance/frontend/typescript.md
tags: [agents, frontend, typescript, lint]
status: current
owner: project
source_paths:
  - frontend/eslint.config.js
  - frontend/tsconfig.json
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-15
timestamp: 2026-07-09
---

# TypeScript conventions

> Written in Phase 5 of the
> [frontend redesign plan](../../plans/frontend-redesign-plan.md) alongside
> turning the ESLint rules on. Every rule here is machine-enforced — the doc and
> the linter agree, so a green `npm run lint` means the code already follows this
> file.

## Types, not interfaces

- Declare object shapes with **`type`, never `interface`**. Enforced by
  `@typescript-eslint/consistent-type-definitions: ["error", "type"]`.
- Compose with intersection **`&`, not `extends`**:

  ```ts
  // no
  interface KBDocumentDetail extends KBDocument {
    fragments: KBFragment[];
  }

  // yes
  type KBDocumentDetail = KBDocument & {
    fragments: KBFragment[];
  };
  ```

- Use discriminated unions for "one of N shapes" instead of optional-field soup
  (e.g. `ParsedLine` in `DocumentPreviewModal`, the `OfferSelectProps` single vs
  multiple split).

## No `any`

- Never `any`. Reach for `unknown` (then narrow), generics, or a discriminated
  union. Error handling narrows `unknown` with `isAxiosError` / `extractApiError`.
- Avoid `as unknown as X` double-casts. For web-only style props that React
  Native's types don't model, cast the style object to `Record<string, string>`
  (the repo-wide pattern, see `OffersTable.tsx` / `MessageCenterView.tsx`), not
  through `unknown`.
- Cross-boundary data is validated with zod against a snake_case `*Api` schema,
  then mapped to the camelCase app type (see `api-domain.md` / `security.md`), so
  no cast is needed at the boundary.

## Naming

- Variable identifiers outside `frontend/api/**` use camelCase, PascalCase, or
  UPPER_CASE. Snake_case identifiers are reserved for API boundary code that
  mirrors backend or third-party wire shapes before mapping them to app types.

## Prefer `undefined` over `null`

- New code returns/represents "absent" as `undefined`. `null` is tolerated only
  where an external contract (an API response, a third-party type) forces it.

## Index access is `T | undefined`

- `noUncheckedIndexedAccess` is enabled — `arr[i]` and `record[key]` are
  `T | undefined`. Guard it (`?? fallback`, optional chaining, a length-checked
  restructure), don't blanket-assert it. A `!` assertion is a reviewed exception:
  use it only where presence is provable (a bounded loop, a required regex
  group) and add a one-line why-comment. `.at()`, `Map.get()`, and
  destructuring-with-defaults are the house idioms.

## Type everything at the seams

- Type every function parameter and return value on exported/module-level
  functions. Let inference handle trivial locals; be explicit at module edges so
  callers read the contract without opening the body.

## Source of truth

- Define each app type **once** — in the endpoint's `types.ts`, or the domain
  root `types.ts` when it is shared by 2+ endpoints — and import it; never
  redeclare a shape in a feature. The snake_case wire type is its `*Api`
  counterpart in `schemas.ts`.

# Provenance

Migrated from `frontend/docs/conventions/typescript.md` into the OKF bundle on
2026-07-09. Lint-enforceable rules stay mirrored in
`frontend/eslint.config.js`.
