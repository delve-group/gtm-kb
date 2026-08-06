# LinkedIn campaign recipe

## Purpose

Create a review-ready LinkedIn campaign from one short prompt by combining the Superseller Company Brain with fresh public research. The recipe drafts and recommends; it never publishes or contacts anyone.

## Minimum input

One of:

- An event name or event concept.
- A current company goal.
- A product moment or learning.

If the prompt is underspecified, use `/strategy/current-goal.md` and the freshest relevant event. Ask a question only when the missing choice materially changes the campaign, such as the publishing identity or whether a named person may be quoted.

## Required context

Read, in this order:

1. `/governance/publication-policy.md`
2. `/strategy/current-goal.md`
3. `/product/overview.md`
4. `/go-to-market/marketing/claims.md`
5. `/assets/brand-voice.md`
6. `/assets/visual-system.md`
7. `/go-to-market/marketing/linkedin-playbook.md`
8. The relevant event, people, social-account, CTA, and proof concepts

Paths beginning `/` are relative to the `brain/` bundle root.

## Workflow

1. Run catalog validation.
2. Resolve the campaign subject and list material knowledge gaps.
3. Build a scoped internal brief. Never send internal-only facts to external research tools.
4. Research current event identity, organizers, companies, people, topic language, and keyword candidates. Prefer primary public sources.
5. Separate confirmed facts, inference, and unresolved conflicts.
6. Select one primary content pillar and one optional supporting pillar.
7. Propose three angles, recommend one, and explain the choice briefly.
8. Draft a primary post and one concise alternative.
9. Rank possible tags by identity confidence, event involvement, relevance, consent, and spam risk. Omit low-confidence people from the default post.
10. Create a graphic brief and generate a branded graphic when image generation is available. Use a text-only Superseller lockup if the canonical logo remains missing.
11. Produce an evidence receipt mapping every factual public claim to a brain concept or external URL.
12. List review decisions and durable write-back candidates.

## Output location

Write the package to:

`artifacts/campaigns/YYYY-MM-DD-<slug>/`

Follow [the output contract](output-contract.md). Generated files are review-required and must not be promoted into `brain/` automatically.

## Stop conditions

Omit or flag rather than invent:

- Team or founder identity.
- Profile ownership or event attendance.
- Customer proof, metrics, prices, and availability.
- Quote and photo consent.
- Official CTA destination.
- A graphic that would require approximating the missing logo.

The final handoff must state that nothing was published.
