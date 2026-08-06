---
type: Agent Guidance
title: Frontend API Domain Rules
description: Canonical frontend API-domain shape, zod boundary validation, snake_case to camelCase mapping, endpoint barrels, and API method rules.
resource: /agent-guidance/frontend/api-domain.md
tags: [agents, frontend, api, zod]
status: current
owner: project
source_paths:
  - frontend/api/
  - frontend/api/shared/parse.ts
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# API domains

> See [architecture.md](architecture.md) for where `api/` sits,
> [data-layer.md](data-layer.md) for the query hooks that call these methods,
> and [security.md](security.md) for the trust-boundary rationale.

Server communication lives in `api/<domain>/`. **The frontend is camelCase
everywhere.** The backend's snake_case wire shapes never leak past the api
method: they are validated at the boundary and mapped to camelCase app types.

## One endpoint = one directory

Every endpoint gets its own directory. Endpoint-specific types/schemas/mappers
live inside it; anything shared by two or more endpoints moves up to the domain
root.

```
api/<domain>/
  <endpoint>/          # one dir per endpoint (getThing/, createThing/, …)
    index.ts           # the method — one arrow-const async fn
    types.ts           # camelCase app type(s) used only by this endpoint
    schemas.ts         # zod wire schema(s) + z.infer'd `*Api` raw types
    mappers.ts         # to<X>() / parse<X>() (+ to<X>Body() for requests)
  types.ts             # camelCase types shared by 2+ endpoints
  schemas.ts           # shared wire schemas + `*Api` types
  mappers.ts           # shared mappers
  index.ts             # barrel — the domain's public surface
```

A file like `foo/index.ts` is imported as `./foo`, so barrels and query hooks
reference the endpoint by its directory name. Utility helpers with no HTTP call
(e.g. `isXPermissionDenied.ts`, `getOfferImageUrl.ts`) and shared axios
instances stay as flat files at the domain root.

Consumers import from the **barrel** (`@/api/<domain>`), never a deep file. The
query layer (`api/queries/`) is the usual caller; components never call api
methods directly.

## The three files per concern

**`schemas.ts` — the wire shape.** Define each response as a zod schema that
mirrors exactly what the backend sends (snake_case and all) and `z.infer` a raw
type with an **`Api`** postfix. Schemas never leave the domain; nothing outside
the mappers imports them.

```ts
export const thingApiSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  created_at: z.string(),
});
export type ThingApi = z.infer<typeof thingApiSchema>;
```

**`types.ts` — the app shape.** Hand-write the camelCase type the whole app
uses. No zod here.

```ts
export type Thing = {
  id: string;
  displayName: string;
  createdAt: string;
};
```

**`mappers.ts` — the boundary.** `to<X>` maps one `*Api` value to the app type;
`parse<X>` validates then maps. Request bodies go the other way with `to<X>Body`.

```ts
const toThing = (api: ThingApi): Thing => ({
  id: api.id,
  displayName: api.display_name,
  createdAt: api.created_at,
});

export const parseThing = (data: unknown, context: string): Thing =>
  toThing(parseBoundary(thingApiSchema, data, context));

/** camelCase → snake_case body the backend expects. */
export const toThingBody = (payload: ThingPayload) => ({
  display_name: payload.displayName,
});
```

When the wire shape is **already camelCase** (e.g. a payload proxied verbatim
from Allegro's own REST API), the app type equals the `Api` type structurally;
`parse<X>` just validates and returns it — no `to<X>` needed.

## The method (`<endpoint>/index.ts`)

A single arrow-`const` async function that performs one request and returns a
typed, validated result. No `function` keyword, no default export.

```ts
import { apiInstance } from "@/api/shared";
import { throwApiError } from "@/api/shared/apiError";

import { parseThing } from "./mappers";
import type { Thing } from "./types";

export const getThing = async (id: string): Promise<Thing> => {
  try {
    const response = await apiInstance.get(`/api/things/${id}/`);
    return parseThing(response.data, "things/get");
  } catch (error) {
    return throwApiError(error, "Failed to load thing");
  }
};
```

- `parseBoundary` (inside the mapper) is the trust boundary — see
  [security.md](security.md). Never parse in a render path, never zod-validate
  internal data you constructed.
- Route failures through `throwApiError` (`@/api/shared/apiError`) so the UI gets
  a clean message, not a stack.
- Use the right axios instance: `apiInstance` (`@/api/shared`) for app/JWT calls;
  `allegroApi` (`@/api/allegro/allegroApiInstance`) for Allegro-scoped calls,
  which is subject to the permission-denied guard.
- Prioritize money / identity / mutation paths (auth, billing, allegro
  send/reply) for strict schemas; loose read-only shapes can validate their key
  fields and allow `z.record(z.string(), z.unknown())` for opaque nested blobs.

## Wire vocabulary vs. field names

Rename **field names** to camelCase. Do **not** rewrite string **values** that
are part of the backend's wire vocabulary — enum members compared against the
server (`"past_due"`, `"low_confidence"`) and filter values sent as query params
keep their wire spelling.

## Barrel

`index.ts` re-exports each method and the domain's public **types** (from
wherever they now live — root or an endpoint dir). Schemas and mappers stay
internal.

```ts
export { getThing } from "./getThing";
export type { Thing } from "./getThing/types";
```

See the `add-api-endpoint` skill for the end-to-end scaffold checklist.

# Provenance

Migrated from `frontend/docs/conventions/api-domain.md` into the OKF bundle on
2026-07-09. The concept remains paired with the API authoring skills under
`frontend/.claude/skills/`.
