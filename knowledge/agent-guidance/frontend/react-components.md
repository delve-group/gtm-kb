---
type: Agent Guidance
title: Frontend React Component Rules
description: Canonical React and React Native component rules for arrow functions, one component per file, named exports, tokens, primitives, and effects.
resource: /agent-guidance/frontend/react-components.md
tags: [agents, frontend, react, components]
status: current
owner: project
source_paths:
  - frontend/eslint.config.js
  - frontend/features/
  - frontend/shared/
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-15
timestamp: 2026-07-09
---

# React component conventions

> Written in Phase 5 of the
> [frontend redesign plan](../../plans/frontend-redesign-plan.md) alongside
> turning the ESLint rules on. The rules here are machine-enforced where a
> linter can express them; the rest are review conventions every feature already
> follows.

## Arrow functions only

- Components, hooks, and helpers are **arrow `const`s**. No `function` keyword.
  Enforced by `func-style: ["error", "expression"]`, which already errors on
  `function` declarations.

  ```ts
  // no
  export function useAppToast() { … }
  function CopyableId({ id }: { id: string }) { … }

  // yes
  export const useAppToast = () => { … };
  const CopyableId = ({ id }: { id: string }) => { … };
  ```

- Because arrow `const`s are not hoisted, declare a helper/sub-component **before**
  the component that uses it.
- No `React.FC` / `FC`. Type props with a local `type Props = { … }` and destructure
  in the parameter list.

## One component per file

- One component per `.tsx` file, named the same as the file (`PascalCase.tsx`).
  Pure logic/helpers live in `.ts` (`useSomething.ts`, `camelCase.ts`).
- When a component grows a second component inside it, split the file. God
  components were decomposed in Phase 3 for exactly this reason.

## Named exports; `export default` only in `app/`

- Inline **named exports** everywhere. `export default` is allowed **only** in
  `app/` route files (Expo Router requires it). Enforced by a `no-restricted-syntax`
  ban on `ExportDefaultDeclaration`, disabled for `app/**`.
- Consumers import from a feature/domain **barrel** (`index.ts`), never a deep
  method/component path. `no-restricted-imports` bans `@/api/*/*`.

## UI primitives and tokens

- Build only on gluestack primitives imported from `@/shared/ui`, and on the
  shared composed components in `@/shared/components` (see `shared-ui.md`). Check
  `shared/` before writing new UI — dedupe crosses feature boundaries.
- **Theme tokens only** — `bg-*`, `text-*`, `border-*` with `dark:` variants.
  Never a raw hex color in `features/` or `shared/components`. This is
  lint-enforced: a `no-restricted-syntax` rule in `eslint.config.js` fails the
  build on any `#rrggbb` string literal. Raw hex is permitted only inside SVG
  illustration assets (e.g. `AnimatedSuccessLogo`) and named style-object
  constants in `shared/lib/` (e.g. `WEB_SHADOW`) — both allow-listed in
  `eslint.config.js`.

## Minimize effects

- Event handlers first; reach for `useEffect` only for subscriptions or imperative
  bridges (measurement, focus, native modules). Server state lives in the
  TanStack Query layer (`data-layer.md`), not in an effect + `setInterval`.

# Provenance

Migrated from `frontend/docs/conventions/react-components.md` into the OKF
bundle on 2026-07-09. Lint-enforceable rules stay mirrored in
`frontend/eslint.config.js`.
