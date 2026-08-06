---
type: Design Plan
title: OpenAI Knowledge Builder Implementation Plan
description: Active design and delivery plan for replacing mandatory knowledge-base uploads with an OpenAI-powered conversational knowledge interview and validated knowledge cards.
resource: /plans/openai-knowledge-builder.md
tags: [knowledge-builder, onboarding, openai, realtime, rag, plan]
status: active
owner: project
source_paths:
  - backend/src/knowledge_builder/
  - backend/src/ai/
  - backend/src/rag/
  - backend/src/onboarding/
  - frontend/features/onboarding/
  - frontend/features/knowledge-builder/
last_reviewed: 2026-07-15
timestamp: 2026-07-15
---

# OpenAI Knowledge Builder

## Objective

Replace the onboarding requirement to upload a global knowledge-base document
with a guided knowledge interview that feels easy to the seller while producing
safer and more structured knowledge than a document upload.

The seller should not have to know how to write a knowledge base. Superseller
first imports what it can learn from Allegro and existing materials, then asks
only about high-value gaps. Confirmed answers become versioned knowledge cards
shown next to the conversation. Existing document upload remains an optional
source, not an activation requirement.

The separate Super Seller coaching module is outside this design. It may use
knowledge-builder results in the future, but its recommendations never affect
knowledge readiness or runtime reply authorization.

## Locked decisions

- Use the OpenAI stack for voice and card extraction. Do not integrate
  ElevenLabs.
- Ship web voice first. Native iOS and Android voice follow after the web flow
  and its evaluation suite are stable.
- Use `gpt-realtime-2.1` for the first API implementation. Keep the provider
  boundary small enough to move to GPT-Live when its API becomes available.
- The realtime model conducts the conversation but is not a source of truth and
  cannot directly persist or confirm knowledge.
- Use a structured text model through the OpenAI Responses API to normalize
  conversation evidence into schema-validated card proposals.
- The Django backend owns session state, authorization, idempotency, card
  transitions, confirmation and publication.
- Knowledge cards and their revisions are canonical. RAG documents, prompt
  guardrails and tool routing are compiled runtime artifacts.
- Audio is not retained by default. Persist only the minimum redacted transcript
  and audit events required to resume, verify and troubleshoot a session.

GPT-Live-1 was announced on 2026-07-08 as a full-duplex model in ChatGPT. Its
public API was announced as forthcoming, so it is a later adapter target rather
than a dependency of the first release.

## Product experience

### Bootstrap

After Allegro connection, Superseller starts an asynchronous discovery job. It
imports offer descriptions and parameters, seller-configured after-sales
conditions, existing knowledge documents and any safe, available historical
evidence. It also attaches the current central Allegro policy version.

The entry screen reports learned coverage, for example: `We already know 64% of
your store. We need six decisions.` It must not ask the seller to start from a
blank page.

### Interview

The agent asks one high-information question at a time. Priority is based on
risk, expected frequency and uncertainty. The default topic order is:

1. delivery and order changes;
2. returns, complaints and warranties;
3. payments and invoices;
4. discounts and compensation;
5. customer communication;
6. permissions and human escalation.

After an answer, one to three proposal cards appear beside the voice stage. The
seller can confirm, correct, narrow the scope, reject or set a safe human
fallback by voice or UI. A casual acknowledgement such as `mhm` must never count
as confirmation. Confirmation is tied to a concrete revision and expected
content hash.

### Review and activation

The final review shows two separate outcomes:

- **Launch safety**: whether every mandatory P0 requirement has a safe outcome.
- **Automation coverage**: how much customer traffic Superseller expects to
  answer without escalation.

The agent runs short scenario checks against confirmed decisions. Publication
is available only when every P0 requirement is represented by one of:

- a confirmed answer;
- a healthy live lookup;
- an explicit human escalation.

`missing`, `conflict` and `stale` block publication for P0. A store may therefore
be launch-safe without claiming complete automation.

## Knowledge boundaries

### Central Allegro policy

Operational Allegro rules are system-owned, read-only and versioned separately
from seller cards. Sellers do not upload or approve the Allegro regulations.
Seller-specific cards may depend on a policy revision. A policy change marks
affected cards stale and triggers targeted revalidation instead of invalidating
the entire store.

### Seller playbook

The interview validates store-specific decisions, exceptions, permissions,
scope and escalation behavior. This is the primary output of the builder.

### Product knowledge

Offer descriptions and parameters remain product-scoped evidence. Shared facts
may be grouped into reusable scopes, but offer-specific knowledge continues to
override general shop knowledge.

### Dynamic operational facts

Order, payment, shipment and other changing state is never embedded as a static
answer. A card may route a requirement to a live Allegro tool and define the
fallback when that tool is unavailable.

## Architecture

```text
browser microphone ------------------- WebRTC media -------------------+
       |                                                               |
       | authenticated SDP offer                                       v
       v                                                OpenAI Realtime (`gpt-realtime-2.1`)
Django `knowledge_builder` -- unified `/realtime/calls` setup -------> conversation and turn-taking
tenant checks, consent-bound call lifecycle and transitions           |
       ^                                                               |
       +---- call id, sideband tool requests and provider hangup ------+
       |
       | redacted evidence + JSON Schema
       v
OpenAI Responses structured extractor/verifier
       |
       v
KnowledgeCard -> KnowledgeCardRevision -> KnowledgeEvidence
       |                                  |
       | UI read model                    | audit trail
       v                                  v
card stream and coverage            conflicts and provenance
       |
       v
validated KnowledgeSnapshot
       |
       +--> RAG fragments
       +--> deterministic guardrails
       +--> escalation routing
       +--> live Allegro tools
```

The browser sends its SDP offer to an authenticated Django endpoint. Django
uses OpenAI's unified WebRTC interface to create exactly one consent-bound call,
stores the returned call identifier and returns only the SDP answer. Media then
flows directly between the browser and OpenAI, so Django does not proxy audio.
The permanent API key never reaches the client. Keeping call setup and the call
identifier server-side lets Django reject concurrent initialization, handle
tool calls over a sideband channel and invoke the provider hangup endpoint when
the seller revokes voice consent.

The realtime model supports function calling but not Structured Outputs. Its
tool calls are therefore commands to the application, not trusted database
mutations. A separate Responses API call produces a constrained card proposal,
and the server validates the schema, tenant, allowed requirement code, scope,
evidence and state transition before saving it.

## Domain model

### `KnowledgeInterviewSession`

Stores the seller, lifecycle state, modality, voice model, prompt and tool-schema
versions, current topic, optimistic-lock version, provider session reference,
redacted resume summary and expiry/pause/completion timestamps.

Session states:

```text
new -> bootstrapping -> ready -> live <-> paused -> review
    -> compiling -> completed
```

`cancelled` and `failed` are terminal exceptions. A dropped realtime connection
pauses rather than discards the interview.

### `KnowledgeRequirement`

A versioned catalog of P0 and P1 coverage requirements. It defines topic, risk,
allowed resolution modes and whether a gap blocks publication.

### `KnowledgeCard` and `KnowledgeCardRevision`

The card is a stable logical identity. Revisions are append-only and hold the
canonical statement, customer-facing guidance, structured conditions, action
mode (`answer`, `live_lookup`, or `escalate`), scope, effective dates, review
date, confidence, content hash and confirmation metadata.

Card lifecycle:

```text
draft -> proposed -> confirmed
                  -> rejected
confirmed -> stale | superseded | conflict
```

A correction creates a new revision; it never overwrites confirmed history.

### Evidence, conflicts, coverage and snapshots

- `KnowledgeEvidence` identifies an Allegro API value, conversation statement,
  uploaded material, historical pattern or platform-policy revision supporting
  or contradicting a revision.
- `KnowledgeConflict` records competing evidence and blocks P0 publication
  until explicitly resolved.
- `KnowledgeCoverage` is the per-seller projection for each requirement:
  `confirmed`, `live`, `escalate`, `missing`, `conflict`, or `stale`.
- `KnowledgeSnapshot` contains an immutable set of confirmed revision IDs,
  compiled artifact hashes, evaluation results and the previous snapshot used
  for rollback.

## Tool contract

Version all tool schemas and allow at most three card proposals per call.

- `get_interview_context()` returns current topic, open conflicts, recent cards
  and coverage delta.
- `propose_cards()` accepts a session version, idempotency key and structured
  candidate evidence. The backend invokes the extractor and returns persisted
  proposal revision IDs plus warnings.
- `revise_card()` creates a replacement revision after validation.
- `decide_card()` confirms or rejects one exact revision and content hash.
- `resolve_conflict()` selects a supported revision or creates a corrected one.
- `set_safe_fallback()` assigns live lookup or human escalation to a requirement.
- `advance_topic()` selects the next highest-priority unresolved requirement.
- `finish_interview()` fails when blocking P0 coverage remains.

Every mutating call enforces authentication, tenant isolation, idempotency,
optimistic concurrency and allowed state transitions. Replayed or out-of-order
provider events cannot create duplicate revisions or silently overwrite a newer
seller decision.

## Backend API

The first API lives under `/api/knowledge-builder/`:

```text
POST /discovery/
GET  /discovery/status/

POST /sessions/
GET  /sessions/current/
GET  /sessions/{id}/
POST /sessions/{id}/pause/
POST /sessions/{id}/realtime-call/       # application/sdp
POST /sessions/{id}/tool-calls/

GET  /cards/
POST /cards/{id}/revisions/
POST /revisions/{id}/confirm/
POST /revisions/{id}/reject/

GET  /coverage/
GET  /conflicts/
POST /publish/
GET  /snapshots/{id}/
```

Realtime events are not durable application state. After reconnect, the client
rehydrates the current session, cards and coverage from REST. Polling through
TanStack Query is sufficient initially; replayable SSE may be added only if
polling causes a demonstrated UX problem.

## Runtime compilation

The compiler routes confirmed revisions by behavior:

- facts and procedures become card-addressable RAG fragments;
- hard constraints become deterministic prompt/rule guardrails;
- escalation cards become routing rules;
- dynamic cards become live Allegro tool routes;
- proposed, rejected, stale, conflicting and expired revisions are excluded.

The compatibility release may materialize confirmed revisions into a generated
`GlobalKBDocument`, but it must retain stable card/revision identifiers in
fragment metadata. Publication builds inactive artifacts, creates embeddings,
runs retrieval and safety smoke tests, then atomically promotes the snapshot.
Failure leaves the previously published snapshot active.

## OpenAI integration

Add a direct OpenAI client path alongside the existing OpenRouter-compatible
gateway. Do not repurpose the current synchronous chat-completions client for
Realtime.

The provider boundary exposes application-level events rather than raw vendor
events:

- session connected/disconnected;
- user/assistant transcript segment;
- interruption;
- tool call requested/completed;
- provider error and usage.

The first implementation uses `gpt-realtime-2.1`. Model, voice, instructions,
turn detection, maximum output and tool-schema version are server-controlled.
The provider session uses a pseudonymous safety identifier, never a raw user ID
or email.

When GPT-Live becomes available through the API, add it behind the same
interface and run the established Polish conversation and card-tool evaluation
suite before changing the default.

## Privacy and safety

- Show an explicit voice-processing disclosure before microphone access.
- Instruct sellers not to disclose buyer personal data during the interview.
- Do not persist raw audio by default.
- Redact transcripts before durable storage or downstream extraction.
- Store stable source references and minimal excerpts rather than complete
  historical conversations.
- Keep OpenAI credentials server-side; the client receives an SDP answer, not a
  reusable provider credential.
- Bind every Realtime call to the exact consent event that authorized it, keep a
  durable call/hangup audit record and terminate the provider call on revoke.
- Add provider request/session identifiers and cost to the existing audit
  projection without storing unsanitized audio or prompts.
- Treat imported documents and message history as untrusted evidence; they may
  not alter system instructions or tool authorization.

## Error handling

- **Realtime disconnect:** pause, retain confirmed state, rehydrate over REST and
  allow text continuation.
- **Dropped call:** close the peer connection, create a fresh consent-bound SDP
  exchange and resume from the server summary.
- **Low transcription confidence:** do not confirm high-risk cards; show the
  transcript and ask for repetition.
- **Duplicate tool call:** return the prior idempotent result.
- **Optimistic-lock conflict:** return a stable conflict code and force a state
  refresh before retry.
- **Extractor schema failure:** save no mutation, log a redacted diagnostic and
  ask a narrower question.
- **Allegro live-tool failure:** use the card's explicit human fallback.
- **Policy contradiction:** create a blocking conflict rather than silently
  preferring seller text.
- **Embedding or compilation failure:** retry asynchronously and retain the
  previous active snapshot.

## Test and evaluation plan

### Deterministic backend tests

- lifecycle and revision transitions;
- P0 readiness predicate;
- tenant isolation;
- idempotent and out-of-order tool calls;
- optimistic concurrency;
- exact confirmation semantics;
- policy-dependency staleness;
- deterministic snapshot compilation and rollback;
- exclusion of unsafe card states from runtime artifacts.

### OpenAI contract tests

- server-controlled session configuration;
- no permanent key or raw user identifier in client payloads;
- normalized event mapping;
- interruption and reconnect behavior;
- tool allowlist and JSON Schema versioning;
- provider errors never bypass backend validation.

### AI evaluations

Maintain Polish golden conversations covering conditional answers, exceptions,
corrections, negation, `nie wiem`, scope changes, dates, amounts, Allegro terms,
conflicting evidence and accidental acknowledgements. Measure card precision,
requirement recall, scope/condition accuracy, conflict detection and unsupported
confirmation rate.

Runtime regression evaluates retrieval recall, groundedness, correct escalation
and existing document-RAG scenarios. Critical unsupported replies must remain a
release blocker.

### Product and voice metrics

- onboarding completion and abandonment per topic;
- time to P0-ready;
- cards confirmed without correction;
- corrections per completed interview;
- launch safety and automation coverage;
- first-audio and interruption latency p50/p95;
- Polish/Allegro transcription error rate;
- reconnect recovery;
- cost per completed knowledge base.

## Delivery plan

### Phase 0 — contract and evaluation baseline

1. Freeze P0 requirement codes and card JSON Schema v1.
2. Instrument the existing upload-step abandonment baseline.
3. Create the provider-neutral event and tool contracts.
4. Build 20 representative Polish voice/card scenarios.
5. Verify `gpt-realtime-2.1` latency, interruption and terminology handling.

### Phase 1 — domain foundation and text-first flow

1. Create the `knowledge_builder` Django app and migrations.
2. Implement card revisions, evidence, coverage and readiness.
3. Add session, card-decision and coverage endpoints.
4. Bootstrap candidates from currently available Allegro offer data.
5. Add text interaction using the same tools as voice.

This phase is independently useful and validates the state machine without
making audio quality a dependency of knowledge correctness.

### Phase 2 — OpenAI Realtime web experience

1. Add the authenticated unified-WebRTC call endpoint and revocable call
   lifecycle.
2. Connect the Expo web client over WebRTC.
3. Implement voice state, captions, interruption and reconnect.
4. Display the live card stack and coverage map beside the conversation.
5. Keep a visible text and direct-card-edit fallback.

### Phase 3 — compilation and activation

1. Compile confirmed cards into RAG, guardrails, routing and live tools.
2. Build immutable snapshots and atomic promotion.
3. Add the scenario exam and publication gate.
4. Migrate existing uploaded global documents to secondary evidence while
   preserving the existing upload workflow.
5. Replace `global_kb_ready_at` with snapshot/P0 readiness, retaining a temporary
   compatibility projection during rollout.

### Phase 4 — pilot and hardening

1. Roll out behind a feature flag to internal accounts and 5–10 design partners.
2. Review failures weekly and promote stable cases into automated evaluations.
3. Validate privacy disclosure, retention and deletion behavior.
4. Add operational dashboards for coverage, failures, cost and latency.
5. Expand gradually only after critical safety gates pass.

### Phase 5 — native and GPT-Live readiness

1. Add native WebRTC and microphone/audio-session support through an Expo
   development build.
2. Reuse the same REST state, tool and card UI contracts.
3. Add the GPT-Live adapter when its API is publicly available.
4. Compare GPT-Live against the current Realtime baseline before promotion.

## Initial implementation slice

Implementation starts with the smallest production-shaped backend slice:

- new app registration;
- session, requirement, card, revision, evidence, coverage and snapshot models;
- migrations;
- a pure readiness service and focused tests;
- provider-neutral OpenAI Realtime configuration types and tests;
- no live network call and no customer-visible activation yet.

The next slice adds authenticated session/card/coverage APIs. The voice UI starts
only after these APIs and their state transitions are stable.

### Status on 2026-07-15

The domain foundation, migration, readiness service, authenticated session
start/resume, current-session, private card list, readiness/coverage endpoints,
and fail-closed OpenAI Realtime configuration/tool contracts are implemented.
The second slice adds an append-only, disclosure-versioned consent ledger;
tenant-safe card revision, confirmation and rejection commands with idempotency
and optimistic concurrency; a consent-bound unified-WebRTC call lifecycle with
server-side hangup; and an exportable React knowledge-card workspace. A security
review rejected reusable client secrets because they cannot reliably enforce
single-call issuance or terminate an already established call after consent is
revoked. The live voice UI remains deliberately unlinked until the provider
tool-call bridge can turn model proposals into these server-authoritative
commands. The next slice implements that bridge, seeds the P0 requirement
catalogue, adds structured extraction, and then connects WebRTC plus onboarding.

## Definition of done

- A seller can complete the mandatory knowledge step without uploading a file.
- Superseller asks only unresolved, high-value questions and can resume an
  interrupted interview without losing confirmed decisions.
- Every P0 requirement has a confirmed answer, healthy live lookup or explicit
  human escalation before publication.
- Cards show scope, source, version, status and confirmation method.
- The realtime model cannot directly persist or self-confirm knowledge.
- Only a validated snapshot can affect runtime replies.
- Existing uploaded documents remain optional evidence and backward compatible.
- Central Allegro policies are versioned and can invalidate dependent seller
  decisions safely.
- Audio is not stored by default and durable text is redacted.
- OpenAI provider errors, reconnects and duplicate events cannot corrupt seller
  knowledge.
- Product, AI, retrieval, privacy and voice release gates are measurable and
  automated where practical.

## External references

- [OpenAI GPT-Live announcement](https://openai.com/index/introducing-gpt-live/)
- [OpenAI voice-agent architectures](https://developers.openai.com/api/docs/guides/voice-agents)
- [OpenAI Realtime WebRTC](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [OpenAI Realtime server-side controls](https://developers.openai.com/api/docs/guides/realtime-server-controls)
- [OpenAI Realtime call hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup)
- [OpenAI Realtime tools](https://developers.openai.com/api/docs/guides/realtime-mcp)
- [OpenAI GPT-Realtime-2.1](https://developers.openai.com/api/docs/models/gpt-realtime-2.1)
- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

# Provenance

The design was developed with the product owner on 2026-07-15 from the existing
document-upload onboarding flow, current Django/Expo/RAG implementation and
official OpenAI product documentation. The owner selected an OpenAI-only stack
and explicitly excluded ElevenLabs and the separate Super Seller coaching module.
