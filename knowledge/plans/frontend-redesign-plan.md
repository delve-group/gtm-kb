---
type: Plan
title: Frontend Redesign and Hardening Plan
description: Historical multi-phase frontend redesign plan that produced the current Expo architecture, data layer, shared UI, security posture, conventions, and authoring skills.
resource: /plans/frontend-redesign-plan.md
tags: [frontend, plan, redesign, historical]
status: historical
owner: project
source_paths:
  - frontend/
  - knowledge/agent-guidance/frontend/
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Superseller Frontend — Redesign & Hardening Plan

> Self-contained execution plan. Written for an AI-assisted workflow where each phase
> is picked up by an agent with **no memory of the planning conversation**. Every phase
> is independently mergeable and independently verifiable. Read the whole "Conventions"
> and "Target architecture" sections before executing any phase.
>
> 2026-07-09 OKF migration note: the frontend convention docs this plan originally
> placed under `frontend/docs/conventions/` now live under
> `knowledge/agent-guidance/frontend/`. The authoring skills remain in
> `frontend/.claude/skills/`.

Repo: `/Users/igor/Projects/superseller/frontend` — Expo/React Native + TypeScript, also
builds web via react-native-web. ~33k LOC, 309 files. Product: Allegro customer-support
automation (see `../../PRODUCT.md`).

---

## Context & goals

The app works but has drifted into **three incoherences**, plus a **thin security posture**:

1. **Duplicated data logic.** 6 feature hooks + 3 polling zustand stores + 4 scattered
   `setInterval` literals each hand-roll the same `loading/error/poll/paginate` skeleton, with
   the "don't re-flash the spinner on refetch" guard written **3 different ways**
   (`hydratedRef`, `hasLoadedRef`, `summary === null`). No caching, no dedupe, overlapping timers.
2. **Duplicated UI.** Two ~300–400-line offer selectors are ~85% identical; `NotConnectedView`
   exists twice; a `.measure()`/`as any` positioning cast is copied across 7 sites; 10+ modal
   components repeat one modal shell; a `Section`/`Card`/`EmptyState` pattern is re-implemented per
   feature; hardcoded hex colors break dark mode.
3. **Two conventions at once.** Docs say _type-only, arrow-only, tokens-not-hex, one barrel per
   feature_, but the code has 9 `interface` files, ~17 `function`-keyword files, deep
   `@/api/*/method` imports, and 3 features missing `hooks/`/`index.ts`. Nothing enforces it (no
   CI, no typecheck script, no lint rules). Docs are stale (rules describe a **Supabase** auth
   client that was replaced by **Django JWT**; `app.config.ts` still ships as "Autobot").
4. **Security is unenforced.** No CI dependency gate, client-only auth flag can reach a build, the
   Allegro axios instance has no token-refresh, API boundaries trust responses without schema
   validation, web export has no CSP/security headers.
5. **Platform handling is ad-hoc.** The app targets **web (priority) + native mobile (first-class)**,
   but the "am I web/desktop/mobile?" predicate is re-derived ~10 times under 5 different names with
   inconsistent thresholds (`isDesktop`, `isDesktopWeb`, `isMobile`, `isWeb`, `isMobileView`; some
   `Platform.OS === "web"`, some `&& width >= 1024`, some `width < 768`). 53 inline `Platform.OS`
   branches live in feature code; breakpoints (768/1024) are magic numbers; `.web.tsx`/`.native.tsx`
   splits are used only in vendored `shared/ui`, never in features.
6. **Cross-feature duplication.** The same capabilities are re-implemented per feature — e.g.
   onboarding re-embeds settings panels (Allegro connect, auto-reply config, offer sync) as steps
   rather than sharing one component; the dedup must cross feature boundaries, not just live within a
   feature.

**Outcome:** one deep data-layer module (TanStack Query) every feature calls through a tiny
interface; a rich shared-component library so features stop re-implementing modals/cards/sections/
controls; god components decomposed to **one small component per file**; a **single convention
enforced by CI**; a **security pass**; and a **modular, multi-file rules + authoring-skills set**
so this AI-assisted repo stays coherent as agents extend it.

**Design lens (deep modules):** each new module hides a lot of behaviour behind a small interface.
Features become thin callers; complexity concentrates for locality and testability. Key seams:
the query-key + typed hook (data), `useAnchoredOverlay(triggerRef)` (overlay positioning), and the
shared component props (UI patterns).

### Decisions locked with the user

- **Data layer:** adopt `@tanstack/react-query`.
- **Hardening:** add CI + tooling + lint + **security** gates now; **do not write the test suite in
  this pass** (structural + gates only; tests slot in later against the gates).
- **Rollout:** sequenced, independently-shippable phases.
- **Free hand on architecture:** may reorder/rename `features/`, introduce new dirs/conventions.
- **Aggressive dedup:** modals, warnings, cards, sections, custom controls (e.g. settings sliders)
  all move to `shared/` or `shared/ui`.
- **Rules & skills:** split the monolithic rules doc into **multiple focused files**, and add
  **authoring skills** (e.g. "add an API domain", "add a feature", "add a shared component") since
  the repo is heavily AI-assisted.

> Note: the message-center mock scaffolding referenced in earlier audits has already been removed —
> ignore any "mock flag" landmine; the remaining Phase-0 landmine is the auth flag only.

---

## The one convention (enforced by lint from Phase 5)

- **Types:** `type` only, never `interface`; compose with `&`, not `extends`. Type all params +
  returns. No `any` — use `unknown`/generics/discriminated unions. Prefer `undefined` over `null`.
- **Functions/components:** arrow `const` only; no `function` keyword; no `React.FC`. Early returns.
- **Exports:** inline named exports; `export default` **only** in `app/` route files.
- **Files:** **one component per file** (`.tsx`); logic/helpers `.ts`. `PascalCase.tsx`,
  `useSomething.ts`. `@/` alias always. Every feature + api domain has an `index.ts` barrel;
  consumers import the barrel, never a method file.
- **UI:** only gluestack primitives from `@/shared/ui`; **theme tokens only** (`bg-*`, `text-*`,
  `border-*` with `dark:` variants) — never raw hex. Build on real primitives (`Modal`, `Popover`,
  `Menu`, `Select`) instead of hand-rolled portals (model: `shared/components/SlimDropdown.tsx`).
- **Data:** all fetching/polling/mutation goes through the TanStack Query layer. **No `setInterval`
  polling in components.** Server state → Query; session/UI state → zustand.
- **Effects:** minimize `useEffect`; event handlers first; effects only for subscriptions /
  imperative bridges.
- **Validation:** zod **only at trust boundaries** — data this codebase didn't create: API
  responses, form/user input, persisted storage, deep-link/URL params, `EXPO_PUBLIC_*` env at
  startup, and LLM/tool output. **Do not** zod-validate internal, compiler-guaranteed data (props,
  values you just constructed, function args inside a module, zustand state you set) — TypeScript
  already proves those, and a runtime `.parse()` there is pure overhead + a duplicate source of
  truth. Define each schema once per domain, `z.infer` the TS type from it (single source of truth),
  and `.parse()` only at the boundary (the api method), never in hot render paths.
- **Platform:** web is the priority target, native mobile is first-class. One source of truth for
  platform + breakpoints (`shared/lib/platform.ts`, `shared/hooks/useBreakpoint.ts`) — never derive
  `isMobile`/`isDesktop` inline. Prefer Tailwind responsive classes (`md:`/`lg:`) for pure layout;
  use JS platform branching only for behaviour CSS can't express (native modules, gestures,
  secure-store); use `.web.tsx`/`.native.tsx` file splits when two implementations diverge
  substantially; `Platform.select` for small value picks. State the override direction explicitly
  (web default → native override).
- **Dedup crosses features:** before writing a component, check `shared/` — a reusable capability
  (e.g. an Allegro-connect panel used by both settings and onboarding) lives in `shared/`, consumed
  by every feature; never copy it into a second feature.

---

## Target architecture (free-hand redesign)

Goal: every feature has the **identical shape**, `shared/` is layered by role, and there is an
explicit data layer. Rename/reorg freely to reach this.

```
frontend/
  app/                          # thin Expo Router routes only (render a View, no logic)
  features/<feature>/           # EVERY feature identical shape:
    <Feature>View.tsx           #   thin: composes sub-components + hooks
    components/                  #   one small component per file
    hooks/                       #   feature hooks = thin wrappers over the query layer
    index.ts                     #   barrel (public surface)
  shared/
    ui/                          # gluestack primitives (VENDORED — do not edit) + promoted custom
                                 #   controls that behave like primitives (Slider, OfferSelect…)
    components/                  # cross-feature composed components (Modal shell, Section, Card,
                                 #   EmptyState, NotConnectedView, WarningBanner, StateBadge, Stat…)
    hooks/                       # cross-feature hooks (useAuthGate, useAnchoredOverlay, useBreakpoint…)
    lib/                         # helpers (platform.ts, measure.ts, appToast, floatingTooltip…)
    components/panels/           # cross-feature capability panels (AllegroConnect, AutoReplyConfig…)
  api/
    <domain>/                    # one method per file + types.ts + index.ts
    queries/                     # NEW: query keys + typed query/mutation hooks + intervals
  store/                         # zustand: ONLY session/client/UI state (auth, locale, theme, flags)
  lib/  i18n/                    # unchanged
  .claude/skills/                # repo authoring skills (Phase 6)
knowledge/agent-guidance/frontend/
                                 # canonical modular frontend rule concepts
```

**Feature taxonomy** (rename toward intent; keep Expo Router route paths stable or update
`app/` wrappers in lockstep): `message-center`, `escalation-panel`, `offers`, `postbuy`,
`rule-management` (knowledge + rules + simulator), `analytics`, `dashboard`, `settings`,
`onboarding`, `waitlist`, `feedback`, `help`. Each must end with `View + components/ + hooks/ +
index.ts`. Today `onboarding` lacks `index.ts`; `onboarding`/`postbuy`/`waitlist`/`feedback` lack
`hooks/` — fix during decomposition.

---

## Working practice: rules & skills evolve WITH the code (every phase)

**Do not defer conventions to Phase 6.** Each phase that establishes a convention or practice writes
or updates the relevant rule file(s) in `knowledge/agent-guidance/frontend/` and any authoring skill in
`.claude/skills/` **as part of that phase**, and it is part of the phase's Done criteria. This repo
is heavily AI-assisted: the moment a phase lands a pattern, the next agent must be able to read the
rule and follow it. Each phase below lists an explicit **Emit** line for what it must produce. Phase
6 then only _finalizes_ — writes the index/`CLAUDE.md`, reconciles cross-links, and does the
brand/rename cleanup — it does not author the rules from scratch.

Rule of thumb: **if a phase makes you decide "we always do X this way," that decision ships as a
rule file edit in the same PR.** New reusable machinery (a data-layer hook shape, a shared-component
category, an api-domain scaffold) ships with (or updates) its authoring skill in the same PR.

## Phase 0 — Verification gates, tooling & security baseline · shippable

No behaviour change; establish the safety net and close the one live landmine.

1. **Scripts** (`package.json`): add `"typecheck": "tsc --noEmit"`, `"format": "prettier --write ."`,
   `"format:check": "prettier --check ."`. Add `.prettierrc` matching current defaults; run `format`
   once as its own commit so later diffs stay clean.
2. **CI** — `.github/workflows/ci.yml` on push/PR: `npm ci` → `lint` → `typecheck` →
   `format:check` → `build:web` → `npm audit --omit=dev --audit-level=high` (see §Security). npm cache on.
3. **Auth landmine:** set dev `.env` `EXPO_PUBLIC_DISABLE_AUTH=false`; add a build-time guard that
   **fails a production web export** when `DISABLE_AUTH === "true"` (assert in `app.config.ts` or a
   `scripts/assert-prod-env.ts` invoked by the Docker/CI build).
4. **Zero-risk dedup now:** replace the two byte-identical `features/*/hooks/useAuthGate.ts` with one
   `shared/hooks/useAuthGate.ts`; update imports + barrels.

**Emit:** seed `knowledge/agent-guidance/frontend/` with `architecture.md` (the target tree + feature shape + the
verification/CI gates as the definition of "done" for every future change) and a short root
`CLAUDE.md`/`AGENTS.md` index pointing at it. This is the floor every later phase builds on.

**Verify:** `npm run typecheck && npm run lint && npm run format:check && npm run build:web` green
locally + CI; one `useAuthGate` file remains; `knowledge/agent-guidance/frontend/architecture.md` exists and CI is the
documented gate.

---

## Phase 1 — Data-layer deep module (TanStack Query) · shippable per feature

One small interface behind which all server-state behaviour lives. Delete the hand-rolled skeleton.

**Setup**

- `npm i @tanstack/react-query`. Wrap `app/_layout.tsx` in a single `QueryClientProvider`
  (`staleTime`, `retry`, `refetchOnWindowFocus` tuned for RN + web).
- `api/queries/intervals.ts` — named cadence constants (`THREADS_POLL_MS = 300_000`,
  `MESSAGES_POLL_MS`, `ESCALATION_POLL_MS = 30_000`, `USAGE_POLL_MS = 60_000`) replacing the 4
  scattered literals.
- **Fix the transport (correctness+security):** extract the single-flight 401-refresh response
  interceptor from `api/shared/apiInstance.ts` into a shared factory and apply it to
  `api/allegro/allegroApiInstance.ts` — today Allegro calls have **no refresh/retry**, so an expired
  JWT hard-fails every threads/messages/offers call. Reuse the existing `refreshPromise` guard.

**Per-domain hooks in `api/queries/`** — query-key factory + typed `useQuery`/`useInfiniteQuery`/
`useMutation` wrappers:

```ts
export const qk = {
  threads: () => ["threads"] as const,
  messages: (threadId: string) => ["messages", threadId] as const,
  offers: (offset: number, phrase: string) =>
    ["offers", offset, phrase] as const,
  escalations: (status: StatusFilter) => ["escalations", status] as const,
  rules: () => ["rules"] as const,
  documents: () => ["documents"] as const,
  subscriptionSummary: () => ["subscription", "summary"] as const,
  escalationCount: () => ["escalations", "count"] as const,
};
```

Map the characterized variation onto Query features:

- **Polling** → `refetchInterval` (threads, messages, escalation-count, usage). Deletes every
  `loadRef`/`pollRef`/`setInterval` + the 3-way hydrated-guard (`placeholderData: keepPreviousData`
  gives it free).
- **Pagination** → offers: `useQuery` with offset in key + `keepPreviousData` (bidirectional page
  nav); messages: `useInfiniteQuery` (prepend older). Keep manual scroll-anchor logic in the
  component (presentation).
- **Allegro permission-denied** → one shared wrapper routes `isAllegroPermissionDenied(err)` to
  `allegroAuthStore.markDisconnected()`; drops per-hook `onAuthLost` threading.
- **Mutations** → `useMutation` with `onMutate` optimistic + `onError` rollback + `onSettled`
  invalidate. **Fixes the optimistic-duplicate bug** (messages pushed with no `id`; use a temp-id +
  invalidation) and standardizes escalation/rules/documents mutations.
- **Silent-catch fixes free:** `selectThread` non-permission errors and subscription-summary
  failures now surface as `query.error`, not empty states.

**Migrate feature-by-feature (each its own PR):** rewrite `useThreads`, `useMessages`, `useOffers`,
`useEscalations`, `useRules`, `useDocuments` as thin wrappers (or delete where the component can call
the query hook directly). Delete `subscriptionUsageStore` + `escalationStore` + the polling half of
`allegroAuthStore` (keep the connection _flag_ in zustand; the _check_ becomes a query). Remove the
two `setInterval`s from `NavigationWrapper`.

**Emit:** write `knowledge/agent-guidance/frontend/data-layer.md` (query-key factory, polling via `refetchInterval`,
offset vs infinite pagination, optimistic-mutation-with-rollback pattern, permission-denied wrapper,
server-vs-client-state boundary, no `setInterval` in components) **when the first feature migrates**,
and the `add-query-hook` authoring skill in `.claude/skills/` (add a key + typed query/mutation
following the established shape). Later feature migrations must follow the rule, not re-invent.

**Verify per feature:** `typecheck && lint`; drive the screen — list loads, background refetch,
pagination, an expired-token path recovers, an optimistic send appears **exactly once** after
refetch. Grep: zero `setInterval` in `features/` + `NavigationWrapper`; zero
`hydratedRef`/`hasLoadedRef`. `data-layer.md` + `add-query-hook` skill exist and match the shipped
hooks.

---

## Phase 2 — Platform foundation + shared component library (aggressive dedup) · shippable

Kill UI duplication across the whole app (**including across features**) and establish one
production-grade platform/responsive layer. Everything reusable is **one small component per file**
in `shared/`. Promote genuinely-primitive custom controls into `shared/ui`; composed patterns into
`shared/components`. Migrate all call sites, then delete the originals.

**Platform & responsive foundation** (do first — components below depend on it)

- `shared/lib/platform.ts` — the single source of truth: `isWeb`, `isNative`, `isIOS`, `isAndroid`
  constants (one definition), plus named breakpoint constants `BREAKPOINTS = { mobile: 768,
desktop: 1024 }`. Replaces every ad-hoc `Platform.OS === "web"` derivation.
- `shared/hooks/useBreakpoint.ts` — one hook returning `{ width, isMobile, isTablet, isDesktop }`
  from `useWindowDimensions` + the named breakpoints. Replaces all ~10 local `isDesktop`/`isMobile`/
  `isMobileView`/`isDesktopWeb` consts (with their inconsistent 768/1024 thresholds) and the 4 raw
  `useWindowDimensions` width checks.
- **Override discipline (production pattern):** pure layout differences → Tailwind `md:`/`lg:`
  classes (already 73 uses). Behaviour CSS can't express (secure-store, gestures, native modules,
  web portals) → `isWeb`/`isNative` from `platform.ts`. When a component's web and native
  implementations diverge substantially → split into `Component.web.tsx` / `Component.native.tsx`
  (the pattern `shared/ui` already uses) instead of a large inline `if (isMobile)` block. Small value
  picks → `Platform.select`. Consolidate the 53 scattered `Platform.OS` branches behind these.
- Web is the priority target; native is first-class — the master/detail responsive shells (message
  center, escalation panel, nav) get one shared `useBreakpoint`-driven layout, not per-feature
  re-derivation.

**Cross-feature capability panels** (dedupe across feature boundaries)

- Extract the capabilities that onboarding and settings currently duplicate into feature-agnostic
  shared components consumed by **both**: `AllegroConnectPanel` (from settings'
  `AllegroIntegration`/`AllegroConnectedStatus`/`AllegroNotConnectedStatus`), `AutoReplyConfigPanel`
  (`AutoReplySettings`), `OfferSyncPanel` (`SyncOffersSettings`). Onboarding steps and the settings
  screen then render the same panel; a fix lands once. Home them in `shared/components/panels/`.

**Positioning primitives** (unblock the overlays)

- `shared/lib/measure.ts` — `measureInWindow(ref): Promise<Rect|null>` (cross-platform) + web-only
  `domNode(ref): Element|null` (replaces `_nativeTag as any`). Replaces all **7** `.measure()` casts.
- `shared/hooks/useAnchoredOverlay.ts` — measure + web `scroll`/`resize` reposition + outside-click +
  portal-to-body, hiding what the two offer selectors duplicate wholesale.

**Overlays / modals** (10+ today)

- `shared/components/Modal.tsx` — one modal shell (header/title/close, body scroll, footer actions,
  native `Modal` + web portal). Backfills: `AllPostBuyMessagesModal`, `AllPostBuyRulesModal`,
  `AllDocumentsModal`, `AllRulesModal`, `CreateRuleModal`, `UploadDocumentModal`,
  `DocumentPreviewModal`, `PostBuyRuleFormModal`, `PostBuyVariablesModal`, `FeedbackReportModal`.
- `shared/components/ListModal.tsx` — the recurring "show the full list in a modal" (`All*Modal`
  family) built on `Modal` + a render-item prop.
- Keep `ConfirmDialog` (already shared); ensure warnings/destructive confirms route through it.

**Composed patterns**

- `shared/components/Section.tsx` — `SectionHeader` (already shared, 13 call sites) + optional
  primary action + list slot: the **title + action-button + list** pattern in `RulesSection`,
  `DocumentsSection`, `SimulatorSection`, `PostBuyView`, and several settings sections.
- `shared/components/Card.tsx` — one card with title/subtitle/media/actions slots. Backfills
  `RuleCard`, `DocCard`, `PostBuyRuleCard`, `PostBuyMessageCard`, `OnboardingCard`, `MetricCard`,
  `EscalationCard`, `UnresolvedMessagesCard` (keep feature-specific bodies; share the frame).
- `shared/components/EmptyState.tsx` + fold the **duplicated** `NotConnectedView` (message-center ≈
  offers, differ only by icon + one i18n key) into one `NotConnectedView` taking `icon`/`title`/
  `cta`; also covers `EmptyThreadPlaceholder`, `AuthCheckingSkeleton`.
- `shared/components/WarningBanner.tsx` (a.k.a. Callout) — inline warning/info/error banners with a
  `tone` prop (tokens, not hex).
- `shared/components/StateBadge.tsx` + `Stat.tsx` — unify `AuditStateBadge`, `FilterChip`,
  `ConfidenceStat`, `MetricCard`'s stat display.

**Custom controls → `shared/ui`**

- Promote `IntervalSlider` (settings) to a reusable `shared/ui`-level `Slider` wrapper (tokens, no
  hex). Promote `OfferSelect` and `SlimDropdown` alongside the other select primitives.
- `shared/components/OfferSelect.tsx` — single component replacing `ChatScopeSelector` +
  `PostBuyOfferMultiSelect` (~85% identical). Discriminated interface:
  ```ts
  type OfferSelectProps = {
    offers?: AllegroOffer[];
    loadOffers?: () => Promise<AllegroOffer[]>;
    isActive?: boolean;
    i18n: {
      searchPlaceholder: string;
      noResults: string;
      placeholder: string;
      empty?: string;
      retry?: string;
      loadError?: string;
      selectLabel?: string;
    };
  } & (
    | { multiple?: false; value: string | null; onChange: (id: string) => void }
    | { multiple: true; value: string[]; onChange: (ids: string[]) => void }
  );
  ```
  `multiple` drives trigger UI (row vs removable chips), `closeOnSelect`, and list filtering; the
  rest is shared via `useAnchoredOverlay`. i18n strings passed in (namespace-agnostic). Move
  `getImageUrl` to `api/allegro`.

**Color-token migration.** Replace every hex in `features/` and `shared/components/Skeleton.tsx:48`
with tokens. Template already in repo: `features/settings/components/AllegroConnectedStatus.tsx`
(`bg-success-0`, `text-success-500`, `dark:` variants) and `SubscriptionSettings.tsx`
(`text-error-600`, `bg-primary-50`). Known sites: `SubscriptionSettings.tsx:95-99` (COLORS map),
`IntervalSlider.tsx:83,118`, both offer selectors' `placeholderTextColor` (resolve `typography-400`
from gluestack config), `Skeleton.tsx:48`.

**Emit:** write `knowledge/agent-guidance/frontend/shared-ui.md` (the component catalogue + when to reach for each,
tokens-not-hex, dedupe-across-features, add-here-not-in-a-feature) and `knowledge/agent-guidance/frontend/platform.md`
(the `platform.ts`/`useBreakpoint` source of truth + Tailwind-vs-JS-vs-file-split override
discipline) **as these primitives land**, plus the `add-shared-component` authoring skill (one file,
named export, tokens, barrel, light/dark, both platforms; with the "does a shared one already exist?"
gate). Every later phase reuses these instead of re-deriving.

**Verify:** `typecheck && lint`; toggle light/dark on every migrated component; drive each backfilled
call site on web + a native target at mobile and desktop widths; grep zero `#[0-9a-fA-F]{6}` in
`features/`, zero `_nativeTag`, one `OfferSelect`, one `NotConnectedView`, zero local
`isMobile`/`isDesktop` derivations outside `useBreakpoint`. `shared-ui.md` + `platform.md` +
`add-shared-component` skill exist and match the shipped components.

---

## Phase 3 — God-component decomposition · shippable per component

One small component per file; data orchestration in query hooks; render split into focused
sub-components under the feature folder. Targets (largest first) + seams:

- `features/analytics/AnalyticsView.tsx` (827) — data → `hooks/` query hooks (usage/runs/run-detail;
  the 2s export poll → `refetchInterval` gated on export state); render → sub-components (continue the
  existing `MetricCard`/`AuditRunsTable`/`AuditRunInspector`/`FilterChip` grain, now on shared `Card`/
  `StateBadge`/`Stat`).
- `shared/components/NavigationWrapper.tsx` (734) — split nav shell (`NavShell`/`NavSidebar`/
  `NavDrawer`) from data (removed in Phase 1).
- `features/settings/components/SubscriptionSettings.tsx` (646) + `AutoReplySettings.tsx` (476) —
  extract sections onto shared `Section`; data via query hooks.
- `features/postbuy/PostBuyView.tsx` (564) — orchestration → new `postbuy/hooks/`; render → shared
  `Section`/`Card`/`ListModal`.
- `features/onboarding/OnboardingView.tsx` (527) + `features/waitlist/WaitlistView.tsx` (475) —
  decompose; **add missing `hooks/` dirs**.

**Close structure gaps:** add `features/onboarding/index.ts`; give `postbuy`/`waitlist`/`feedback` a
`components/`+`hooks/` as needed. Every feature ends in the identical shape.

**Verify per component:** `typecheck && lint`; drive each screen; no `features/` file over ~250 lines
(save intentional exceptions); each extracted piece is one named-export component per file.

---

## Phase 4 — Security hardening pass · shippable

Beyond the transport fix (Phase 1) and auth-flag guard + audit gate (Phase 0):

- **Schema validation at boundaries only:** validate at the trust boundaries listed in the
  conventions (API responses, form/user input, persisted storage, deep-link/URL params,
  `EXPO_PUBLIC_*` env, LLM output) — **not** internal data. Define the schema once per domain in
  `types.ts`, `z.infer` the TS type from it, and `.parse()` in the api method (or a shared `parse()`
  helper), never in render. Start with auth, billing, allegro send/reply — the money/identity/
  mutation paths — then the storage-cast in `sessionStorage.ts` (`JSON.parse(...) as AuthSession`).
  Do not add zod to props, module-internal args, or zustand state.
- **Token storage review (confirm, don't regress):** web persists nothing (httpOnly cookie refresh);
  native keeps the refresh token in `expo-secure-store`, only short-lived access token + profile in
  AsyncStorage. Keep this invariant; add a comment/guard so a future edit can't move the refresh
  token into AsyncStorage.
- **Web response hardening:** add a **Content-Security-Policy** and standard security headers
  (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`/frame-ancestors) to `nginx.conf`
  for the web export.
- **Secret hygiene:** assert no non-`EXPO_PUBLIC_` secret is referenced client-side; keep `.env`
  gitignored; document that `EXPO_PUBLIC_*` are bundled/public. Remove the unused Supabase URL/anon
  key from `.env` (dead config).
- **Error minimization:** ensure API errors surfaced to UI don't leak internal detail/stack (route
  through `extractApiError`).
- **AI-assisted safety note:** any place repo/user content is fed to an LLM (simulator, KB) treats it
  as data, not instructions — document in the security rules file (Phase 6).
- **Dependency posture:** CI `npm audit --omit=dev --audit-level=high`; take non-`--force`
  `npm audit fix`; **do not** take the Expo-major `--force` bumps here.

**Emit:** write `knowledge/agent-guidance/frontend/security.md` (token-storage invariant, `EXPO_PUBLIC_` = public / no
client secrets, zod-at-the-boundary, CSP/headers, LLM-fed-content-is-data, dependency-audit gate) and
fold the zod-at-the-boundary rule into `knowledge/agent-guidance/frontend/api-domain.md`; update the `add-api-domain`
skill to scaffold zod validation + error handling by default.

**Verify:** CI audit gate green; zod parse errors handled on the covered paths; web export served
with CSP (check response headers); grep confirms no secret-typed env outside `EXPO_PUBLIC_`;
`security.md` exists and the `add-api-domain` skill scaffolds validation.

---

## Phase 5 — One convention + turn on enforcement · shippable

1. **Mechanical conversions** (wide, low-risk):
   - `interface X {}` → `type X = {}`; `interface X extends Y {}` → `type X = Y & {}`. 9 files
     (all `api/*/types.ts` + `shared/components/Skeleton.tsx`).
   - `export function`/internal `function` → arrow `const` (~17 files; watch hoist order for internal
     components).
   - Deep api imports → barrels (`SyncOffersSettings.tsx:14-15`, `SimulatorSection.tsx:5`).
   - Drop remaining `as any`/`as unknown as` now covered by `measure.ts` typing
     (`MessageCenterView.tsx:158` `calc()` cast → typed web style).
2. **Enable ESLint rules as errors** (only after conversions land, so CI stays green):
   `@typescript-eslint/consistent-type-definitions: ["error","type"]`; arrow-only (`func-style`/
   `prefer-arrow`); `no-restricted-imports` banning `@/api/*/*`; keep `export default` out of
   non-`app/` files.
3. CI now enforces the convention on every PR forever.

**Emit:** write `knowledge/agent-guidance/frontend/typescript.md` (type-only, `&` over `extends`, no `any`,
`undefined` over `null`) and `knowledge/agent-guidance/frontend/react-components.md` (arrow-only, no `React.FC`, one
component per file, tokens, minimize effects) alongside turning the lint rules on — the rule file and
the ESLint rule that enforces it ship together, so the doc and the machine agree.

**Verify:** `lint` (new rules) + `typecheck` green; grep counts → zero for `export interface`,
`function ` in features/api, and `@/api/*/*` deep imports; `typescript.md` + `react-components.md`
exist and each has a matching enabled ESLint rule.

---

## Phase 6 — Finalize rules index, remaining skills & brand cleanup · shippable

By now **most rule files and skills already exist** — they were emitted by the phases that
established each convention (see the per-phase **Emit** lines). Phase 6 does **not** author them from
scratch; it _finalizes_: write any not-yet-created files (`api-domain.md`, `testing.md`, the
`add-feature` skill), write the index, reconcile cross-links, and fix the stale brand/setup facts.

**Finalize the rule set** in `knowledge/agent-guidance/frontend/` — confirm the full set exists and is cross-linked;
replace the single stale `rules.md`; make root `CLAUDE.md`/`AGENTS.md` a short index linking them and
keep `.cursor/rules/` pointers in sync. Expected files (most already written earlier):

- `architecture.md` — feature shape, `shared/` layering, `api/queries/`, server-vs-client state.
- `typescript.md` — type-only, `&` over `extends`, no `any`, `undefined` over `null`.
- `react-components.md` — arrow-only, no `React.FC`, one component per file, tokens-not-hex,
  gluestack-only, minimize effects.
- `data-layer.md` — TanStack Query: query-key factory, polling via `refetchInterval`, pagination,
  optimistic mutations, no `setInterval` in components.
- `shared-ui.md` — when to reach for `Modal`/`Section`/`Card`/`EmptyState`/`WarningBanner`/
  `OfferSelect`/`Slider`/capability panels; overlay positioning via `useAnchoredOverlay`;
  **add-here-not-in-a-feature** and **dedupe-across-features** rules for reusable UI.
- `platform.md` — web-priority/native-first-class stance; `platform.ts` + `useBreakpoint` as the only
  source of truth; when to use Tailwind responsive classes vs JS branching vs `.web.tsx`/`.native.tsx`
  splits vs `Platform.select`; the override direction (web default → native override); named
  breakpoints (no magic 768/1024).
- `api-domain.md` — one method per file + `types.ts` + `index.ts` barrel; zod validation at the
  boundary; error handling via `extractApiError`.
- `security.md` — token storage invariant, `EXPO_PUBLIC_` = public, no client secrets, CSP, treat
  LLM-fed content as data.
- `testing.md` — the deferred harness (jest-expo + RTL) and what to cover first; marked aspirational
  until the suite lands.

Also fix the stale facts these replace: auth is **Django JWT** (`djangoAuth.ts` + `apiInstance.ts`),
not Supabase; list all real api domains; reconcile the testing claim with reality.

**Authoring skills** in `.claude/skills/` (each: a `SKILL.md` with steps + a checklist an agent
follows end-to-end). `add-query-hook` (Phase 1), `add-shared-component` (Phase 2), and
`add-api-domain` (Phase 4) already exist — here, confirm them and add the last one:

- `add-feature` — scaffold `features/<name>/` (`View` + `components/` + `hooks/` + `index.ts`) + the
  `app/` route wrapper, wired to the data layer + shared components + platform layer.
- `add-api-domain` (created Phase 4) — scaffold `api/<domain>/` (method files, `types.ts`, zod,
  `index.ts`) + a `api/queries/` hook set + keys. Confirm it's current.
- `add-shared-component` (created Phase 2) — add to `shared/` correctly (one file, named export,
  tokens, barrel, light/dark, both platforms) with the dedupe-first gate. Confirm it's current.
- `add-query-hook` (created Phase 1) — add a query/mutation hook (key, polling, pagination,
  optimistic pattern). Confirm it's current.

**Non-docs cleanup:** finish the rename in `app.config.ts` (`name`/`slug`/`android.package`/
`ios.bundleIdentifier` "Autobot"→Superseller). **User decision needed:** slug/bundle-ID changes
affect EAS linking + any shipped native build — confirm final brand + whether a native build already
shipped before changing bundle IDs. Replace the generic Expo-template READMEs with the real setup;
add `EXPO_PUBLIC_ALLEGRO_SANDBOX` to `env.example`; archive the completed `../AUTH_MIGRATION_PLAN.md`.

**Verify:** grep zero `supabase` / `Autobot` in config; a fresh reader can set up + run from the
README; each rule file describes only modules that exist; each skill's checklist runs clean on a
scaffold dry-run.

---

## Dependency order & shippability

```
Phase 0 (gates + security baseline + landmine)  ── first (safety net)
   ├─ Phase 1 (data layer) ── per-feature PRs; carries correctness + transport-security fixes
   │     └─ Phase 3 (decompose god components) ── needs query hooks
   └─ Phase 2 (shared component library) ── parallel-able with Phase 1
         └─ Phase 3 also consumes shared Section/Card/Modal
Phase 4 (security hardening) ── after data layer (transport) stabilizes
Phase 5 (convention sweep + lint enforcement) ── after code stops moving a lot
Phase 6 (modular rules + authoring skills + rename) ── last; docs describe the final shape
```

Each phase is independently mergeable and verifiable. **No test suite is written this pass**
(deliberate); CI enforces typecheck + lint + format + build + dependency-audit + the convention
rules instead.

## Global verification (every phase)

1. `npm run typecheck && npm run lint && npm run format:check && npm run build:web` green (local +
   CI), plus the CI dependency-audit gate.
2. Drive the affected screen(s) in the running app on **both a web build and a native target** (web
   is priority, native is first-class): list load, background refetch, pagination, expired-token
   recovery, an optimistic send appearing exactly once, light/dark rendering for any color-migrated
   component, and responsive layout at mobile + desktop widths.
3. The per-phase grep assertions above.

## Out of scope (recorded)

- Writing the unit/integration **test suite** (deferred; gates added so it can slot in later).
- Product/direction work (finish the real Message Center, seller-facing analytics, notification
  preferences, simulator favorites, referral surface) — separate product decisions.
- Expo SDK 54→57 major upgrade (`npm audit --force` territory) — stack is current; not now.
- `shared/ui/*` gluestack primitives themselves — vendored/auto-generated, untouched (we add new
  custom controls alongside them, we don't edit the generated ones).

```

```

## Known duplication/target inventory (reference for executors)

- **Identical/near-identical:** `useAuthGate` (×2, identical), `NotConnectedView` (message-center ≈
  offers), the two offer selectors (~85%), the 7-site `.measure()` cast.
- **Cross-feature capabilities:** onboarding steps re-embed settings' Allegro-connect / auto-reply /
  offer-sync panels → shared `AllegroConnectPanel`/`AutoReplyConfigPanel`/`OfferSyncPanel`.
- **Platform derivations (no single source of truth):** ~10 local `isDesktop`/`isDesktopWeb`/
  `isMobile`/`isWeb`/`isMobileView` consts + 53 inline `Platform.OS` branches + magic 768/1024
  breakpoints → `shared/lib/platform.ts` + `shared/hooks/useBreakpoint.ts` + `.web.tsx`/`.native.tsx`
  splits where implementations diverge.
- **Modal family:** 10+ `*Modal`/`Dialog` components → `Modal` + `ListModal` shells.
- **Section family:** `RulesSection`/`DocumentsSection`/`SimulatorSection` + settings/postbuy → `Section`.
- **Card family:** `RuleCard`/`DocCard`/`PostBuyRuleCard`/`PostBuyMessageCard`/`OnboardingCard`/
  `MetricCard`/`EscalationCard`/`UnresolvedMessagesCard` → `Card`.
- **Controls:** `IntervalSlider` → `shared/ui` Slider; `SlimDropdown`, `OfferSelect` promoted.
- **God components:** AnalyticsView 827, NavigationWrapper 734, SubscriptionSettings 646,
  PostBuyView 564, OnboardingView 527, AutoReplySettings 476, WaitlistView 475.
- **Convention blast radius:** 9 `interface` files (all `api/*/types.ts` + Skeleton), ~17
  `function`-keyword files, deep api imports in `SyncOffersSettings`/`SimulatorSection`.
