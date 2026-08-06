# Superseller Company Brain

This repository is Superseller's Git-native, agent-readable company memory. The active [Open Knowledge Format v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle lives in [`brain/`](brain/). The copied [`knowledge/`](knowledge/) bundle is retained as migration evidence and engineering reference; it is not the default context for company-wide or public-content work.

## What it does

- Keeps company, people, product, strategy, sales, marketing, event, research, and brand knowledge in reviewable Markdown.
- Separates public facts from internal guidance and marks publication approval explicitly.
- Gives Codex a one-prompt LinkedIn Campaign Studio through the repository-local `create-linkedin-campaign` skill.
- Preserves sources, freshness, ownership, and knowledge gaps instead of hiding uncertainty.
- Stores generated campaigns outside canonical knowledge and proposes durable learnings back through reviewed changes.

## Start here

1. Read [`brain/index.md`](brain/index.md).
2. Fill the explicit gaps in [`brain/people/team-directory.md`](brain/people/team-directory.md), [`brain/strategy/current-goal.md`](brain/strategy/current-goal.md), and [`brain/events/vibe-coding-summer-jam-session-02.md`](brain/events/vibe-coding-summer-jam-session-02.md).
3. Add the canonical logo described in [`brain/assets/brand-assets.md`](brain/assets/brand-assets.md).
4. Run `make validate`.
5. Ask Codex: **“Create a LinkedIn campaign for today’s VIBE CODING SUMMER JAM.”**

Generated packages appear under `artifacts/campaigns/`. Nothing is published automatically.

## Repository map

- [`brain/`](brain/) — active company brain and source of truth.
- [`recipes/`](recipes/) — reusable artifact contracts and workflows.
- [`.agents/skills/`](.agents/skills/) — repository-local Codex workflows.
- [`scripts/`](scripts/) — deterministic validation utilities.
- [`artifacts/`](artifacts/) — generated, review-required outputs.
- [`knowledge/`](knowledge/) — legacy product/engineering reference bundle.
- [`docs/plans/`](docs/plans/) — approved architecture notes.

## Safety boundary

Do not put credentials, private customer data, private messages, private LinkedIn data, or sensitive infrastructure access details in the Company Brain. Metadata is a retrieval policy, not encryption or repository access control.
