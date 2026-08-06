---
name: create-linkedin-campaign
description: Create a complete, evidence-backed LinkedIn campaign package from the Superseller Company Brain and fresh public research. Use when Codex is asked to create, draft, prepare, or research a Superseller LinkedIn post, event recap, launch post, founder post, campaign graphic, keyword set, hashtag set, or list of people and company accounts to tag. Also use when the user asks for the one-prompt LinkedIn Campaign Studio or wants campaign learnings proposed back into the Company Brain.
---

# Create LinkedIn campaign

Create a review-ready campaign from one normal prompt. Ground internal facts in `brain/`, research time-sensitive facts live, generate the complete artifact package, and never publish or contact anyone.

## Locate the source of truth

Resolve the repository root three directories above this skill. Read:

1. `../../../AGENTS.md`
2. `../../../brain/index.md`
3. `../../../recipes/linkedin-campaign/recipe.md`
4. `../../../recipes/linkedin-campaign/output-contract.md`

Treat `brain/` as canonical company context. Use `knowledge/` only when an active brain concept explicitly cites it and more source detail is necessary. Never retrieve legacy operational or engineering material for ordinary public copy.

## Execute the workflow

1. Run `make validate` from the repository root. Continue past warnings; treat errors in required campaign concepts as unsupported knowledge and state the limitation.
2. Resolve the subject from the prompt. If absent, use `brain/strategy/current-goal.md` and the freshest relevant event concept.
3. Read the publication policy, current goal, product overview, claims registry, brand voice, visual system, LinkedIn playbook, and only the relevant event, people, CTA, proof, and social-account concepts.
4. List material knowledge gaps privately before drafting. Ask one question only if a missing choice would materially change the result; otherwise continue and surface the gap in the package.
5. Research current event, organization, person, topic, keyword, hashtag, and platform facts on the live web. Prefer official and primary sources. Record direct URLs and dates.
6. Keep internal-only facts out of web queries and public output. Separate confirmed facts, inference, and unresolved conflicts.
7. Choose one primary content pillar and at most one supporting pillar. Propose three angles and recommend one.
8. Draft a primary post and concise alternative in the user's language unless they request another. Preserve **Superseller** spelling and the calm, practical, controlled voice.
9. Rank tag candidates using identity confidence, actual involvement, relevance, consent, and spam risk. Omit low-confidence people from the default post. Never infer endorsement from a public profile.
10. Create the graphic brief from the visual system. Generate a raster graphic when image generation is available, then inspect it. Do not fabricate the missing canonical logo; use a text-only Superseller lockup and disclose the limitation.
11. Map every factual public claim and graphic element to a brain concept or external URL. Flag all `review-required`, stale, inferred, or unsupported material.
12. Create a write-back proposal for durable verified learnings. Do not edit canonical brain concepts unless the user separately approves the proposal.

## Write the campaign package

Create `artifacts/campaigns/YYYY-MM-DD-<slug>/` and follow the output contract exactly:

- `campaign.md`
- `research.md`
- `tags.md`
- `graphic-brief.md`
- `evidence.md`
- `writeback-proposal.md`
- `graphic.png` or `graphic.jpg` when generated

Use the current date in the user's timezone. Keep external citations as Markdown links. Generated output is always review-required.

## Fail closed

Omit or explicitly flag rather than invent:

- Team or founder identities.
- Profile ownership, event attendance, or speaker roles.
- Customer proof, metrics, prices, availability, or compliance guarantees.
- Quote, tagging, and photo consent.
- Official acquisition destinations.
- Event dates when sources conflict.
- A canonical logo that is not present in the repository.

Do not scrape private LinkedIn data. Do not publish, upload, tag, message, follow, connect, or contact anyone.

## Hand off

Lead with the completed campaign and link every created file. Show the generated graphic inline when present. Summarize the strongest angle, required human decisions, and any write-back candidates. State explicitly that nothing was published.
