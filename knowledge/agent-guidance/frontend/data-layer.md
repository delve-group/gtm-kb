---
type: Agent Guidance
title: Frontend Data Layer Rules
description: Canonical TanStack Query data-layer rules for server state, query keys, polling, pagination, optimistic mutations, and feature-hook boundaries.
resource: /agent-guidance/frontend/data-layer.md
tags: [agents, frontend, tanstack-query, data-layer]
status: current
owner: project
source_paths:
  - frontend/api/queries/
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Data layer (TanStack Query)

> Written in Phase 1 of the
> [frontend redesign plan](../../plans/frontend-redesign-plan.md), when the
> first features migrated off the hand-rolled `loading/error/poll` skeletons.
> All server state flows through this layer. See [architecture.md](architecture.md)
> for where it sits.

## The one rule

**All fetching, polling, pagination and mutation of server state goes through
`api/queries/`.** No feature or component hand-rolls a `loading/error/poll`
skeleton, and there is **no `setInterval` polling in components or stores** —
polling is a query's `refetchInterval`.

- Server state → TanStack Query (`api/queries/`).
- Session / client / UI state → zustand (`store/`): auth, locale, theme, flags,
  and small view state (e.g. the Allegro connection flag). Never server data.

## Provider & client

A single `QueryClient` (`api/queries/queryClient.ts`) is provided once in
`app/_layout.tsx` via `QueryClientProvider`. Defaults are tuned for RN + web:
short `staleTime`, `retry: 1` (auth refresh is handled by the axios interceptor,
not by query retries), `refetchOnWindowFocus: false`.

## Query-key factory

Every key comes from `api/queries/keys.ts` (`qk`). Keys are `as const` tuples
ordered least- to most-specific so a partial key invalidates a subtree
(`["escalations"]` invalidates every status filter). Never inline a raw key
array in a hook.

```ts
qk.threads(); // ["threads"]
qk.messages(threadId); // ["messages", threadId]
qk.offers(offset, phrase); // ["offers", offset, phrase]
qk.escalations("open"); // ["escalations", "open"]
```

## Poll cadences

Named constants live in `api/queries/intervals.ts` (`THREADS_POLL_MS`,
`MESSAGES_POLL_MS`, `ESCALATION_POLL_MS`, `USAGE_POLL_MS`,
`PENDING_DOCUMENT_POLL_MS`). Pass them to `refetchInterval`; never write a bare
number or a `setInterval`.

Conditional polling (poll only while work is pending) is a function form of
`refetchInterval` that reads the query's own data:

```ts
refetchInterval: (query) =>
  query.state.data?.some(isPending) ? PENDING_DOCUMENT_POLL_MS : false;
```

## Mapping the old skeleton onto Query features

| Old hand-rolled thing           | Query feature                                     |
| ------------------------------- | ------------------------------------------------- |
| `setInterval` + `loadRef`       | `refetchInterval: SOME_POLL_MS`                   |
| `hydratedRef` / `hasLoadedRef`  | `placeholderData: keepPreviousData` + `isLoading` |
| offset pagination (page nav)    | offset in the key + `keepPreviousData`            |
| infinite scroll (prepend older) | `useInfiniteQuery` + `fetchNextPage`              |
| manual reload after a write     | `invalidateQueries` in `onSettled`                |
| optimistic push (no id) bug     | temp-id insert + invalidate → shows exactly once  |

- `isLoading` is true only before the first data arrives; on background refetch
  it stays false (that is the no-spinner-reflash guard, for free).
- Keep presentation state (scroll anchoring, reply drafts, mobile master/detail)
  in the component/feature hook. Only server state lives in the cache.

## Pagination

- **Offset / page nav** (offers): put the offset in the query key and use
  `keepPreviousData` so the current page stays visible while the next loads.
- **Infinite / prepend-older** (messages): `useInfiniteQuery`, newest page first,
  older pages via `fetchNextPage`; derive the flat list from `data.pages`.

## Optimistic mutations

`useMutation` with cache writes, not local component state:

- `onMutate` / an explicit cache write (`setQueryData`) inserts the optimistic
  item with a **temporary id**.
- On error, roll it back (remove by temp id) and restore the draft.
- On success/settled, `invalidateQueries` so server truth replaces the temp item
  — which is why an optimistic send now appears **exactly once**.

Escalation/rules/documents mutations follow this shape (see
`api/queries/escalations.ts`, `rules.ts`, `documents.ts`).

## Allegro permission-denied

Allegro queries wrap their fn in `withAllegroAuthGuard`
(`api/queries/allegroAuthGuard.ts`): a permission-denied (403) response flips
the shared `allegroAuthStore` connection flag to disconnected once, then
rethrows so the error still surfaces on `query.error`. Features no longer thread
an `onAllegroAuthLost` callback by hand.

## Feature hooks are thin wrappers

A `features/*/hooks/use*.ts` hook composes the `api/queries/` hooks and adapts
them to what the View needs (localized error strings, toasts, local UI state).
It contains no `axios`/`fetch`, no `setInterval`, and no bespoke cache. If a
component can call the query hook directly, skip the wrapper.

See the `add-query-hook` skill for the step-by-step when adding a new one.

# Provenance

Migrated from `frontend/docs/conventions/data-layer.md` into the OKF bundle on
2026-07-09. It documents the current `frontend/api/queries/` deep module and
the `add-query-hook` skill checklist.
