---
type: Agent Guidance
title: Frontend Platform and Responsive Rules
description: Canonical frontend platform and responsive-layout rules for web, native, breakpoints, platform overrides, and anti-patterns.
resource: /agent-guidance/frontend/platform.md
tags: [agents, frontend, platform, responsive]
status: current
owner: project
source_paths:
  - frontend/shared/lib/platform.ts
  - frontend/shared/hooks/useBreakpoint.ts
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Platform & responsive layout

> Written in Phase 2 of the
> [frontend redesign plan](../../plans/frontend-redesign-plan.md) as the
> platform foundation lands. Web is the **priority** target; native mobile is
> **first-class**. There is exactly one source of truth for "am I web/native?"
> and "how wide am I?" — never re-derive it inline.

## The single source of truth

- **`shared/lib/platform.ts`** — static, compile-time constants:
  `isWeb`, `isNative`, `isIOS`, `isAndroid`, and named breakpoints
  `BREAKPOINTS = { mobile: 768, desktop: 1024 }`. Import these instead of
  writing `Platform.OS === "web"`.
- **`shared/hooks/useBreakpoint.ts`** — width-reactive state:
  `{ width, isMobile, isTablet, isDesktop }` derived from `useWindowDimensions`
  - the named breakpoints. Import this instead of re-deriving
    `const isDesktop = width >= 1024` or reading `useWindowDimensions` directly for
    a layout decision.

Never introduce a local `isMobile`/`isDesktop`/`isMobileView`/`isDesktopWeb`
const, and never hardcode `768`/`1024` — those are the symptoms this layer
removes.

## Override discipline (which tool for which difference)

State the override direction explicitly: **web is the default, native is the
override.** Pick the lightest tool that expresses the difference:

1. **Pure layout differences → Tailwind responsive classes** (`md:`, `lg:`).
   This is the default. Example: `className="flex-col md:flex-row"`.
2. **Behaviour CSS can't express → `isWeb`/`isNative`** from `platform.ts`.
   Use for secure-store vs localStorage, gestures, native modules, web portals,
   haptics — anything that is a capability difference, not a size difference.
3. **Substantially divergent implementations → `Component.web.tsx` /
   `Component.native.tsx`** file splits (the pattern `shared/ui` already uses).
   Reach for this instead of a large inline `if (isNative) { … } else { … }`.
4. **Small value picks → `Platform.select`** (or `isIOS ? a : b`) for a single
   number/string, e.g. a keyboard offset.

## Anti-patterns

- `const isDesktop = Platform.OS === "web" && width >= 1024;` → use
  `useBreakpoint()` (+ `isWeb` if the check must also be web-gated).
- Repeating a `.measure()`-based overlay/tooltip anchor by hand → use
  `useAnchoredOverlay` / `useAnchoredTooltip` (see `shared-ui.md`).
- Scattering `Platform.OS === "web"` through a feature → import `isWeb`.

# Provenance

Migrated from `frontend/docs/conventions/platform.md` into the OKF bundle on
2026-07-09. The concept tracks the single-source platform helpers used by the
Expo web and native clients.
