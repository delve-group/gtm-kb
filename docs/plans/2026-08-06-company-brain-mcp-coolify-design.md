# Company Brain MCP and Coolify design

Date: 2026-08-06

## Outcome

The repository becomes a single-process TypeScript service that exposes the existing `brain/`
catalog over MCP Streamable HTTP. The knowledge kernel remains independent of HTTP, MCP,
GitHub, SQLite, and Langfuse. Read operations are deterministic and local. The only mutation
workflow creates an isolated GitHub branch and draft pull request after validating the complete
candidate catalog; it never edits the container filesystem or the protected default branch.

The deployment target is one Coolify-managed Docker container and one persistent volume mounted
at `/app/data`. SQLite contains only encrypted authentication credentials, hashed opaque tokens,
OAuth transactions, exchange codes, and proposal receipts. GitHub remains the concurrency and
knowledge-history authority.

## Boundaries

- `src/brain/` owns discovery, parsing, indexing, retrieval, search, context selection,
  validation, and health. It may read only the configured Brain root and validates repository
  references separately from retrievable content.
- `src/mcp/` translates Zod-validated tool calls into kernel and proposal-service calls. Every
  request receives an immutable server-derived actor; tool arguments can never choose identity or
  authority.
- `src/auth/` handles constant-time shared-secret verification and the GitHub App OAuth flow with
  state and PKCE. `src/sessions/` owns the replaceable persistence interface and encrypted SQLite
  implementation.
- `src/github/` uses GitHub Git Data and Pull Request APIs. It requires the supplied base SHA to
  equal the configured branch head, applies exact caller-provided changes to a virtual repository,
  validates before remote writes, creates a unique non-force ref, and opens a draft PR.
- `src/observability/` provides structured redacted logs and fail-open Langfuse observations.
  Knowledge documents, proposed content, credentials, authorization headers, and cookies are never
  exported by default.

## Authentication and sessions

`secret`, `github`, and `hybrid` modes share one HTTP authentication boundary. Shared-secret
callers are read-only unless `ALLOW_SECRET_WRITES=true`. GitHub callers authenticate through the
configured public callback URL, never a URL reconstructed from forwarded headers. The application
stores only bearer-token hashes; GitHub access and refresh credentials use AES-256-GCM encryption.
Browser cookies are HTTP-only, SameSite=Lax, and Secure whenever `PUBLIC_BASE_URL` is HTTPS.

Because SQLite and live MCP transport state are local to one process, the Coolify service must run
exactly one replica. The full `/app/data` directory is mounted so the database, WAL, and shared
memory files survive replacement. A later store implementation can replace SQLite without changing
the authentication or MCP interfaces.

## Failure and concurrency model

Input, authorization, validation, stale-base, Git, GitHub, and internal failures use stable safe
categories and correlation IDs. Absolute paths, stack traces, upstream credential-bearing
responses, and environment values never reach MCP clients.

GitHub is the concurrency authority. Every proposal records an exact base SHA, uses a unique branch,
creates its ref without force, and never exposes a merge operation. Expected previous hashes catch
lost updates. Candidate validation and open-proposal overlap detection catch basic semantic
conflicts before writing; GitHub mergeability and checks describe conflicts discovered later.

## Deployment shape

The multi-stage Node 22 image compiles TypeScript, prunes development packages, and copies only
runtime dependencies, `dist/`, `brain/`, and legacy `knowledge/` files needed to resolve existing
source references. It runs as the built-in non-root `node` user, creates writable `/app/data`, binds
to `0.0.0.0`, honors `PORT`, and exposes a public non-sensitive `/healthz`. The process closes HTTP
and MCP connections, flushes Langfuse, closes SQLite, and exits on SIGTERM or SIGINT.

Coolify terminates HTTPS. `TRUST_PROXY=1` enables ordinary forwarded protocol/host behavior, while
OAuth callbacks and security decisions exclusively use validated `PUBLIC_BASE_URL`. Proxy buffering
must be disabled for MCP streaming and idle timeouts must exceed the 15-second MCP keepalive.
