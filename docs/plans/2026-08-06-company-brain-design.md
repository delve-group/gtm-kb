# SuperSeller Company Brain Design

Date: 2026-08-06

## Product direction

The Company Brain is a Git-native operating memory for SuperSeller, not a document dump or a generic chat interface. Its first hero workflow is a one-prompt LinkedIn Campaign Studio: an agent should be able to turn a current company goal and event into a grounded post, branded graphic brief, keyword set, and ranked tagging suggestions without the user repeatedly pasting product and brand context.

The active brain will be a new Open Knowledge Format v0.2 bundle under `brain/`. The copied `knowledge/` directory remains reference material while the new catalog is curated around company-wide use. Engineering detail is discoverable through an explicit reference concept but is not part of the default public-content context. Unknown or missing facts stay visible as gaps; the system must never silently fill team members, metrics, customer proof, event participants, or LinkedIn profiles.

The design optimizes for four properties: human-readable Markdown, small context packs, safe public claims, and reviewable learning. Git provides history and collaboration. OKF provides portable concepts, provenance, trust, lifecycle, and progressive disclosure. A repository-local Codex skill supplies the campaign workflow. A future MCP adapter can expose the same catalog operations without becoming the source of truth.

## Information architecture

The bundle is organized by company questions rather than software components: `company/`, `people/`, `product/`, `strategy/`, `go-to-market/sales/`, `go-to-market/marketing/`, `events/`, `research/`, `operations/`, `engineering/`, `governance/`, and `assets/`. Each directory has an `index.md` so agents can progressively disclose only relevant concepts.

Every concept uses OKF v0.2 standard fields where applicable: `type`, `title`, `description`, `tags`, `sources`, `generated`, `verified`, `status`, and `stale_after`. Local extensions add `owner`, `visibility`, and `publication`. Visibility controls retrieval scope; publication controls whether a fact can support external copy. These fields are policy signals, not a replacement for repository access control. Secrets, credentials, customer PII, and private operational access details must never enter the bundle.

Content is kept atomic enough for useful retrieval. Product positioning, capabilities, claims, brand language, team profiles, event records, and current goals are separate concepts. Unknown sections use explicit `TODO` or `Needs confirmation` markers and remain `draft`. Existing source material is linked through `sources`, preserving provenance without copying the engineering corpus wholesale.

## Campaign workflow and data flow

The repository-local `create-linkedin-campaign` skill triggers for requests to create a SuperSeller LinkedIn post or event campaign. It reads the brain root, governance policy, current strategy, marketing playbook, brand system, relevant product concepts, team registry, and selected event. It then performs fresh public research for time-sensitive topics, keywords, organizers, and possible accounts to tag.

The workflow produces a campaign package under `artifacts/campaigns/<date>-<slug>/`: a research brief, post variants, ranked tag suggestions, a graphic brief or generated graphic, and an evidence receipt. The receipt separates internal brain sources from live external sources and records unsupported or review-required claims. Artifacts are outputs, not canonical knowledge.

After the user reviews the campaign, durable discoveries can be proposed back into the brain. Event outcomes, verified handles, approved quotes, and reusable market findings become explicit concept changes with sources. The workflow must not silently convert search results or generated prose into stable company truth. A future MCP layer can expose search, context packing, validation, health, and proposal operations while preserving this same file-and-Git data flow.

## Failure and safety behavior

Missing knowledge is a product signal. When a required team profile, event fact, CTA, metric, quote permission, or brand asset is absent, the campaign should continue with the strongest supported output and include a short blocking-gaps section. It should ask the user only when the missing choice would materially change the campaign. Unsupported metrics and customer claims are omitted.

Public research is treated as unverified until corroborated. Profile and company matches include source URLs and confidence; uncertain people are suggestions, never asserted identities. The workflow must not scrape private LinkedIn data or imply that a suggested person endorses SuperSeller. Tagging recommendations consider relevance and spam risk, and internal people can opt out through their profile concept.

Visibility filtering fails closed. A public campaign reads `public` concepts plus specifically permitted `internal` workflow guidance; it does not retrieve confidential material. Broken links, stale concepts, missing indexes, invalid frontmatter, and expired public claims are validation findings. Validation errors block a concept from trusted context but do not make the Markdown unreadable.

## Validation and testing

A deterministic validator scans the active bundle. It checks required frontmatter, OKF lifecycle values, local visibility/publication values, dates, source shapes, index coverage, internal Markdown targets, duplicate resources, and stale concepts. It reports errors separately from warnings and returns a non-zero exit code for errors. Drafts and explicit knowledge gaps are valid; accidental ambiguity is not.

The repository includes small fixtures through real concepts rather than a second fake catalog. Tests cover valid frontmatter, malformed concepts, index omissions, broken internal links, stale content, and unsafe publication combinations. The one-prompt skill is also forward-tested by giving a fresh agent a realistic campaign request and checking whether it reads the correct concepts, preserves uncertainty, performs live research, and emits the complete campaign package.

Success for the first demo is visible and falsifiable: one ordinary prompt creates a useful LinkedIn campaign package; every factual claim has a source or a review flag; the graphic follows the SuperSeller design system; tagging suggestions have reasons and confidence; and newly learned facts can be proposed back to the Git brain without overwriting canonical knowledge.
