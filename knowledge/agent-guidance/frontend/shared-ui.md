---
type: Agent Guidance
title: Frontend Shared UI Rules
description: Canonical shared UI component catalogue and rules for reusable components, tokens, overlays, modals, layout primitives, controls, and promotion into shared.
resource: /agent-guidance/frontend/shared-ui.md
tags: [agents, frontend, shared-ui, design-system]
status: current
owner: project
source_paths:
  - frontend/shared/components/
  - frontend/shared/ui/
  - frontend/shared/hooks/
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Shared UI: the component catalogue

> Written in Phase 2 of the
> [frontend redesign plan](../../plans/frontend-redesign-plan.md) as the shared
> component library lands. **Before writing any component, check whether a
> shared one already covers it** — reusable UI lives in `shared/`, is consumed
> by every feature, and is fixed once. This applies to composed UI, controls,
> modals, overlays, panels, hooks, and helper logic. Never copy or hand-roll a
> component when `shared/` already provides the affordance.

## Two hard rules

1. **Add-here-not-in-a-feature.** If a component is (or could be) used by more
   than one feature, it belongs in `shared/`, not in a `features/*/components/`
   folder. A feature importing another feature's internals
   (`../otherFeature/components/X`) is a smell — promote `X` to `shared/`.
2. **Check shared first.** Before building a control, picker, modal, overlay,
   card, panel, empty state, layout helper, hook, or utility, inspect
   `@/shared/components`, `@/shared/components/panels`, `@/shared/ui`,
   `@/shared/hooks`, and `@/shared/lib`. Reuse the shared component when it
   matches the job; only create feature-local UI when the need is genuinely
   feature-specific.
3. **Tokens, not hex.** Use semantic Tailwind tokens (`bg-primary-500`,
   `text-error-600`, `border-outline-100`, with `dark:` variants) — never a raw
   hex/rgb literal in a component. Colour props that can't take a class (e.g.
   `placeholderTextColor`, animated `backgroundColor`) resolve a token value or
   wrap a `Box` with the token class.

## Where things live

- **`shared/ui/`** — gluestack primitives (VENDORED — do not edit) plus promoted
  custom controls that behave like primitives.
- **`shared/components/`** — cross-feature composed components (below).
- **`shared/components/panels/`** — cross-feature _capability_ panels: a whole
  feature-agnostic capability shared by multiple screens (e.g. the Allegro
  connect status shared by settings and onboarding).
- **`shared/hooks/` / `shared/lib/`** — cross-feature hooks and helpers.

## The catalogue — reach for these

### Overlays & positioning

- **`useAnchoredOverlay()` + `<AnchoredOverlay>`** — anchor a floating
  dropdown/menu to a trigger: measures the trigger, re-measures on web
  scroll/resize, dismisses on outside click, and renders a web portal / native
  modal. Presentation stays in your component; positioning lives in the hook.
- **`useAnchoredTooltip()`** (`shared/lib/floatingTooltip`) — measure a trigger
  and show a viewport-clamped tooltip below it. Use for info/hint tooltips.
- **`shared/lib/measure.ts`** — `measureInWindow(ref)` (promise-based, cross
  platform) and `domNode(ref)` (web DOM node). Use these instead of
  `(ref.current as any).measure(...)` / `._nativeTag`.

### Modals

- **`AppModal`** — the modal shell (backdrop, header with title + close, body,
  optional footer). Build every modal on this instead of repeating the
  `Modal/ModalBackdrop/ModalContent/…` scaffolding.
- **`ListModal`** — "show the full list in a modal" (the `All*Modal` family):
  `AppModal` + `data`/`renderItem`/`keyExtractor` + empty state.
- **`ConfirmDialog` / `useConfirmDialog`** — destructive/confirmation dialogs.

### Layout & content

- **`AuthScreen` + `AuthHeader`** — shared login/register frame with the product
  brand centered above one focused form panel and the language control anchored
  at the view's bottom-right. Use `AuthHeader` for the shared title/description
  presentation when an auth flow owns a state-dependent header.
- **`Section`** — title + info tooltip + optional primary action, then a body.
  Wraps `SectionHeader`.
- **`Card`** — one card frame with title/subtitle/media/actions slots; keep the
  feature-specific body as `children`.
- **`EmptyState`** — centered icon + title + description + optional action for
  "no results"/"nothing selected". For the Allegro "connect first" state use
  **`NotConnectedView`** (pass the per-feature icon + copy).
- **`HelpPanel`** — the standard help/FAQ block: translated title + intro body,
  optional extra feature content as `children`, then a single-open unfilled FAQ
  accordion built from `{ value, question, answer }` items. Every view help
  panel is a thin wrapper passing its own i18n copy.
- **`ScrollableHelpPanel`** — constrained help/FAQ scroll region with native
  scroll indicators and an end-aware scroll cue; pass translated hint copy.
- **`ScrollMoreCue`** — shared end-aware overlay cue for virtualized or custom
  scroll regions that cannot use `ScrollableHelpPanel`; pass translated copy
  plus the scroll viewport, content height, and current offset.
- **`WarningBanner`** — inline info/warning/error/success banner with a
  semantic `tone`.
- **`StateBadge`** — small status pill with a semantic `tone`.
- **`Stat`** — one label + value block; compose inside `Card`.

### Controls

- **`InlineInfoTooltip`** — compact accessible info trigger for field labels;
  pass translated helper copy through `text`. Positioning uses the shared
  anchored-tooltip layer on web and native.
- **`SegmentedControl`** — compact mutually exclusive choices such as billing
  cadence, filter modes, or small view switches. Use this instead of hand-rolled
  adjacent buttons for segmented pickers.
- **`OfferSelect`** — the single offer picker for both single-select and
  multi-select (`multiple` prop). Positioning via `useAnchoredOverlay`; i18n
  strings passed in (namespace-agnostic). Supports static `offers` or async
  `loadOffers` gated on `isActive`.
- **`IntervalSlider`** — discrete step slider with tokenized colours + haptics.

## Adding a new shared component

Follow the **`add-shared-component`** skill (`.claude/skills/`): one component
per file, named export, tokens only, both light/dark, both platforms, wired
into the barrel, with the "does a shared one already exist?" gate.

# Provenance

Migrated from `frontend/docs/conventions/shared-ui.md` into the OKF bundle on
2026-07-09. The shared component catalogue should stay synced with
`frontend/shared/` and the `add-shared-component` skill.
