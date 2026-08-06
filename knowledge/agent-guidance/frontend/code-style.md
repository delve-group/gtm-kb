---
type: Agent Guidance
title: Frontend Code Style Rules
description: Canonical frontend code style rules for braces, spacing, and comments, including the lint-enforced guardrails.
resource: /agent-guidance/frontend/code-style.md
tags: [agents, frontend, lint, style]
status: current
owner: project
source_paths:
  - frontend/eslint.config.js
  - frontend/.prettierrc
  - knowledge/plans/frontend-redesign-plan.md
last_reviewed: 2026-07-09
timestamp: 2026-07-09
---

# Code style: braces, spacing & comments

> The line-level rules that keep every file readable the same way. The brace and
> spacing rules are **machine-enforced** — a green `npm run lint` means the code
> already follows them; the comment rule is a review convention. Prettier
> (`.prettierrc`) owns the rest (indentation, quotes, line width, trailing
> commas), so those are not repeated here.

## Always brace control statements — no inline `if`

Every `if` / `else` / `for` / `while` body is a **braced block on its own
lines**. Never a single-line or same-line body, even for a one-statement guard.
Enforced by `curly: ["error", "all"]`.

```ts
// no
if (!threadId) return;
if (name) formData.append("name", name);

// yes
if (!threadId) {
  return;
}

if (name) {
  formData.append("name", name);
}
```

Early returns are still encouraged — just brace them. A guard clause is a braced
`if` at the top of the function, not an inline one.

## Blank lines between blocks

Multi-line blocks **breathe**: a blank line separates each multi-line
declaration (method, component, hook) from what surrounds it, and separates a
multi-line control block from the statements next to it. Enforced by
`padding-line-between-statements` on `multiline-block-like`.

```ts
// no
export const a = () => {
  doThing();
};
export const b = () => {
  if (x) {
    y();
  }
  return z;
};

// yes
export const a = () => {
  doThing();
};

export const b = () => {
  if (x) {
    y();
  }

  return z;
};
```

Group tightly-related one-liners together; put a blank line between logical
steps. When in doubt, separate.

## Comments explain _why_, never _what_

- Write a comment only when the code cannot say it itself: a non-obvious
  rationale, a platform quirk, a best-effort fallback, an external contract, or a
  security note. `parseBoundary` docstrings, `// Web only:` notes, and
  `// …best-effort; keeps last good value on failure` are the kind that stay.
- **Do not** restate what the next line already says, and **do not** add
  `// --- section ---` banner dividers — structure the file with real code order
  and blank lines instead.
- JSDoc (`/** … */`) is for the public surface of a shared/exported API where the
  contract isn't obvious from the signature. Keep it short.

```ts
// no — restates the code / decorative banner
// --- helpers ---
// set the name on the form
formData.append("name", name);

// yes — explains a decision the code can't
// react-dom is web-only and has no installed types; require lazily to keep
// native bundles clean.
```

# Provenance

Migrated from `frontend/docs/conventions/code-style.md` into the OKF bundle on
2026-07-09. The brace and spacing rules are enforced by
`frontend/eslint.config.js`; the comment rule remains a review convention.
