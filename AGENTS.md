# Superseller Company Brain agent entry point

The canonical company-wide knowledge bundle starts at [`brain/index.md`](brain/index.md). Read the smallest relevant indexes and concepts before acting.

## Retrieval rules

- Treat `brain/` as canonical for company, product, strategy, sales, marketing, people, events, research, and brand work.
- Treat `knowledge/` as legacy reference material. Do not use a legacy claim in public content until it is represented in `brain/` with current provenance and publication metadata.
- For public artifacts, follow [`brain/governance/publication-policy.md`](brain/governance/publication-policy.md) and fail closed on unsupported claims.
- Never infer missing team members, handles, metrics, customers, quotes, event participants, URLs, or permissions.
- Preserve the canonical spelling **Superseller**.
- Research all time-sensitive external facts at execution time and cite public sources.

## LinkedIn campaign requests

Use the repository-local `create-linkedin-campaign` skill for LinkedIn posts, event campaigns, keyword research, tagging recommendations, and branded campaign graphics. Store generated work under `artifacts/campaigns/`; do not publish or contact anyone.

## Knowledge updates

- Use OKF v0.2 fields and the local profile in [`brain/governance/schema.md`](brain/governance/schema.md).
- Update the nearest `index.md` and [`brain/log.md`](brain/log.md) with meaningful changes.
- New external research begins as draft or review-required knowledge.
- Never turn generated prose or a search result into approved company truth without human verification.
- Run `make validate` after changes.
