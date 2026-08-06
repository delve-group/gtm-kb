---
type: Frontend Guidance
title: Superseller visual language
description: Portable visual reference for creating interfaces and assets that look like Superseller.
resource: /frontend/design-system.md
tags: [frontend, design-system, brand, ui]
status: current
owner: project
source_paths:
  - PRODUCT.md
  - frontend/app/_layout.tsx
  - frontend/tailwind.config.js
  - frontend/shared/ui/gluestack-ui-provider/config.ts
  - frontend/shared/components/SectionHeader.tsx
  - frontend/shared/components/navigation/NavBrand.tsx
  - frontend/shared/components/navigation/navConfig.ts
  - frontend/shared/lib/webShadow.ts
  - frontend/assets/logos/logo.svg
last_reviewed: 2026-07-24
timestamp: 2026-07-24
---

# Superseller visual language

Use this reference to create a new interface, landing page, email, document, or branded asset that feels like Superseller. Preserve the visual character and semantic values. Adapt scale and composition to the medium instead of copying an app screen literally.

## Recognize the Superseller look

Superseller is a calm operations product for marketplace sellers. It should feel practical, controlled, trustworthy, and warm.

The recognizable visual formula is:

- A clean off-white canvas
- White panels with restrained borders
- Burnt-orange actions and active states
- Warm charcoal text
- Compact Inter typography
- Small Lucide-style line icons
- Mild corner radii
- Quiet shadows used after borders
- Color reserved for action, state, and meaning

The result should look focused and capable, not playful or futuristic. Superseller is an accountable assistant, not a chatbot toy.

Avoid these treatments:

- Glassmorphism
- Glossy or inflated controls
- Large pill-shaped containers
- Heavy floating shadows
- Decorative dashboard metrics
- Neon AI colors
- Purple-first AI branding
- Dense decoration that competes with the task
- Multiple equally strong calls to action

## Use the brand mark

`frontend/assets/logos/logo.svg` is the canonical Superseller mark. It is a warm orange and yellow storefront symbol with an internal gradient.

Use the mark as follows:

- Preserve its aspect ratio and original colors
- Use the SVG where the medium supports it
- Use `app-icon.png` for an opaque square application icon
- Use the generated Android and favicon assets only for their target platforms
- Pair the mark with the word “Superseller” in Inter Semibold or Bold
- Keep the mark visually separate from surrounding icons and controls
- Use the mark without a wordmark when space is constrained

The app uses a 24 px mark in its standard navigation lockup and a 40 px mark in the larger authentication lockup. A new medium may scale it, but the storefront shape must remain legible.

Do not:

- Recolor the mark to match a status
- Replace it with a generic bot icon
- Stretch, rotate, crop, or outline it
- Place it inside another orange shape
- Recreate the gradient by eye when the canonical asset is available

The logo gradient is a brand-asset exception to the product-interface rule against gradients.

## Apply the color system

The palette combines burnt vermilion orange with clean, slightly warm neutrals. The canvas reads as off-white, not beige. Dark surfaces use warm charcoal rather than flat black.

### Core colors

These values define the smallest portable Superseller palette:

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#FBFBFB` | `#272221` | Page or workspace background |
| Panel | `#FFFFFF` | `#181513` | Cards, headers, inputs, primary surfaces |
| Inset | `#F4F3F3` | `#393230` | Quiet wells, tracks, nested surfaces |
| Deeper inset | `#EAE9E9` | `#4A423F` | Selected neutral regions and separators |
| Standard border | `#E3E2E1` | `#393230` | Cards, rows, modals, and toasts |
| Strong border | `#D1D0CF` | `#4A423F` | Selectable or emphasized boundaries |
| Heading | `#171717` | `#F5F5F5` | Titles and strongest labels |
| Strong body | `#272626` | `#E5E5E5` | Primary values and dense content |
| Body | `#41403F` | `#DCDBDB` | Default copy and labels |
| Supporting copy | `#535251` | `#D5D4D4` | Descriptions |
| Secondary copy | `#747372` | `#A4A3A2` | Metadata and helper text |
| Tertiary copy | `#A4A3A2` | `#757271` | Decorative or nonessential text only |
| Solid-action text | `#FEFEFE` | `#0A0A0A` | Foreground on semantic solid colors |

### Brand orange

| Role | Light | Dark |
| --- | --- | --- |
| Soft surface | `#FFE7DF` | `#51210F` |
| Strong soft surface | `#FED3C4` | `#6C2910` |
| Primary action | `#BF4919` | `#DD6D45` |
| Hover or secondary emphasis | `#A83D0F` | `#ED9171` |
| Pressed or strong emphasis | `#8A320E` | `#FBB49B` |

Use orange for:

- The primary action
- The active navigation location
- Progress and automation
- Branded icons and highlights
- Links that belong to the product workflow

Do not use orange as decoration on every card. A page should have one clear orange emphasis hierarchy.

### Status colors

| Meaning | Light foreground | Dark foreground | Pale light surface | Dark surface |
| --- | --- | --- | --- | --- |
| Error | `#DC2626` | `#F96160` | `#FEF1F1` | `#422B2B` |
| Success | `#2A7948` | `#66B584` | `#EDFCF2` | `#1C2B21` |
| Warning | `#A16207` | `#FABB14` | `#FFFBEB` | `#423214` |
| Information | `#0B8DCD` | `#57C2F6` | `#EBF8FE` | `#1A282E` |

Status color must communicate a real state:

- Green means successful or healthy
- Amber means attention, waiting, or quota pressure
- Red means error, destructive action, or urgency
- Blue means information, an external data link, or a setup affordance

Pair status color with a label or icon. Never rely on color alone.

### Third-party theme form values

When a tool asks for a small set of brand fields, use:

| Field | Value |
| --- | --- |
| Primary | `#BF4919` |
| Secondary | `#F4F3F3` |
| Accent | `#A83D0F` |
| Button | `#BF4919` |
| Background | `#FBFBFB` |
| Dark text | `#171717` |
| Light text | `#FEFEFE` |
| Heading font | Inter |
| Body font | Inter |
| Link font | Inter |
| Button font | Inter |
| Button shape | Rounded |
| Button radius | 5 px |
| Button style | Filled |
| Button border | 0 px |

## Set typography

Inter is the Superseller typeface. The product app loads weights 400, 500, 600, and 700.

Use these stacks outside the app:

```css
font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
```

Email clients do not reliably load web fonts. Use this email-safe stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, Helvetica, sans-serif;
```

### Product typography

The app uses a compact scale:

| Role | Size | Weight | Line height |
| --- | ---: | ---: | ---: |
| Micro label | 10 px | 600–700 | 14 px |
| Metadata and helper text | 14 px | 400–600 | 20 px |
| Standard section title | 15 px | 600 | 20 px |
| Strong body and controls | 15–16 px | 500–600 | 20–24 px |
| Body copy | 16 px | 400 | 24 px |
| Top-bar title | 17 px | 600 | 24 px |
| Large section title | 19 px | 700 | 26 px |
| Page title | 22–28 px | 600 | 28–34 px |
| Large display title | 34 px | 600–700 | 40 px |

Use sentence case for headings, labels, buttons, and navigation. Reserve uppercase for 10–14 px category labels, compact badges, and table headers.

Headings use tight line heights and `#171717` in light mode. Body copy uses `#41403F`. Supporting text uses `#535251` or `#747372`.

### Typography in larger formats

A landing page or campaign asset may extend the same Inter hierarchy:

- Section headlines: 30–40 px
- Major calls to action: 38–48 px
- Hero headlines: up to 60 px
- Introductory body copy: 17–19 px

Keep the same weight, color, and spacing character. Larger type should not introduce a separate display font or exaggerated weight.

Use tighter tracking only for major headings and the wordmark. Keep body copy at normal tracking.

## Use spacing, radii, borders, and shadows

Superseller uses a 4 px spacing grid. Common gaps are 4, 8, 12, 16, 20, 24, and 32 px.

### Spacing rhythm

| Value | Use |
| ---: | --- |
| 4 px | Label and detail |
| 8 px | Icon and label, compact rows |
| 12 px | Control internals |
| 16 px | Card padding and related groups |
| 20 px | Larger card padding |
| 24 px | Page sections and mobile gaps |
| 32 px | Major separation and desktop gutters |

The product app uses 16 px mobile gutters and 32 px desktop gutters. Standard cards use 16 px padding. Primary controls target a 40 px height.

### Corner radii

The app is mildly rounded:

| Role | Radius |
| --- | ---: |
| Primitive default | 1.6 px |
| Compact row | 3.2 px |
| Control or icon well | 4.8 px |
| Standard card | 6.4 px |
| Navigation row | 8.8 px |
| Soft container | 12 px |
| Marketing card maximum | 14 px |
| Avatar, chip, or progress track | Full radius |

Avoid large-radius cards that make operational content look soft or toy-like. Pills belong to compact labels, chips, and progress tracks.

### Borders and elevation

Borders establish hierarchy before shadows:

- Standard boundary: 1 px `#E3E2E1`
- Strong boundary: 1 px `#D1D0CF`
- Default field border: 1 px `#DCDADA`
- Hovered field border: 1 px `#A19E9E`

Use this shadow for a standard web card:

```css
box-shadow:
  0 1px 3px 0 rgba(0, 0, 0, 0.06),
  0 1px 2px -1px rgba(0, 0, 0, 0.06);
```

Use this shadow for a table or tightly bounded container:

```css
box-shadow:
  0 1px 2px 0 rgba(0, 0, 0, 0.04),
  0 0 0 1px rgba(0, 0, 0, 0.02);
```

Do not combine a strong border with a strong shadow.

## Build the surface hierarchy

Use no more than three neutral surface levels in one region:

1. Canvas: off-white or warm charcoal
2. Panel: white or near-black with a border
3. Inset: a quiet neutral inside the panel

The app feels dense because related controls stay close together. It still leaves enough breathing room to scan sections quickly.

A typical Superseller composition has:

- One centered content container
- A clear page or region title
- One primary task area
- A narrower supporting or settings area when needed
- Bordered panels instead of free-floating widgets
- Divider-separated rows inside panels
- One primary action per region

Forms should not span a wide desktop container. Wide layouts belong to tables, conversations, split workspaces, and comparison content.

## Reuse the component character

These recipes describe how Superseller components look. Adapt their dimensions when the medium requires it.

### Cards and sections

A standard card uses:

- White or dark-panel background
- 1 px standard border
- 6.4 px radius
- 16 px padding
- Quiet or no shadow

A section header uses:

- A 36 px square icon well
- A 16 px line icon
- A 15 px semibold title
- An optional 18 px information control
- An optional action aligned to the opposite edge

Use a pale orange icon well with a darker orange icon for product concepts. Use status colors only when the section represents that state.

### Buttons

The primary button uses:

- `#BF4919` background in light mode
- `#A83D0F` hover
- `#8A320E` pressed
- `#FEFEFE` text
- 600 weight
- 5 px radius for portable branded forms
- A visible 2 px keyboard focus ring

Common product sizes are:

| Size | Height | Horizontal padding |
| --- | ---: | ---: |
| Extra small | 32 px | 14 px |
| Small | 36 px | 16 px |
| Medium | 40 px | 20 px |
| Large | 44 px | 24 px |
| Extra large | 48 px | 28 px |

Use a solid orange button for the main action. Use an outlined neutral button for cancel or an alternative path. Use a red solid button only after destructive confirmation.

### Fields

A standard field uses:

- 40 px height
- White or panel background
- 1 px neutral border
- 4.8 px radius when the surrounding surface uses custom component styling
- 12 px horizontal padding
- 16 px input text
- 14 px helper text
- A visible orange focus border and inset ring

Place the label above the field. Do not use placeholder text as the only label.

### Selection controls and chips

Checkboxes and radio controls use a 20 px indicator and a 2 px neutral border. Selected controls use the darker brand orange.

Chips use a full radius because they are compact filters or labels. An active chip may use a solid orange fill. Avoid using pill shapes for normal buttons and cards.

### Tables and lists

Tables and operational lists use:

- A white or dark panel
- One outer border
- Divider-separated rows
- No zebra striping by default
- 14 px headers
- 14–16 px body text
- Strong text for primary values
- Secondary text for metadata

Keep identifiers and external data links visibly actionable. Use blue and underline when orange would imply an internal primary action.

### Conversations

Message bubbles use:

- Maximum width of 80%
- Orange for the seller or active user
- White or dark panel with a border for the other participant
- 16 px horizontal and 12 px vertical padding
- 6.4 px radius
- No decorative bubble tails

Left and right alignment should communicate authorship without extra decoration.

### Modals and feedback

Modals use:

- A near-black backdrop at 50% opacity
- A bordered panel
- 24 px padding
- 8.8 px radius
- A left-aligned title
- A close control on the right
- Right-aligned footer actions

Use toasts for transient confirmation. Keep validation, blockers, and information requiring action inline.

## Choose icons and imagery

The app uses Lucide outline icons from `lucide-react-native`. Use the same line-icon character in derivative work.

Common icon sizes are 12, 14, 16, 18, 20, and 24 px. Use one icon for one meaningful action or section. Do not add icons to every line of copy.

The product interface avoids decorative illustrations. A landing page or campaign may use illustration when it explains seller work, human control, or automation boundaries.

Marketing imagery should:

- Show marketplace work rather than abstract AI
- Feel warm and grounded
- Support the story instead of filling empty space
- Keep the orange and neutral palette dominant
- Avoid neon glows, robots, brains, magic, and science-fiction imagery

Low-opacity orange gradients may appear as ambient marketing backgrounds. Keep them blurred and subtle. Do not place gradients on controls, reading surfaces, or operational app panels.

## Add motion with restraint

Product motion is functional and brief:

- Modal backdrop: 250 ms fade
- Modal content: 90% to 100% scale with a restrained spring
- Skeleton pulse: 800 ms per half-cycle
- Hover: color or border change without layout movement
- Pressed state: deeper semantic color

Do not animate table rows, form labels, or navigation geometry under the pointer.

A landing page may use slow ambient motion or short narrative transitions. Respect `prefers-reduced-motion`, and keep all content understandable without animation.

## Preserve accessibility and content behavior

Every Superseller surface should:

- Use readable semantic contrast
- Pair status color with a label or icon
- Give icon-only controls an accessible name
- Show visible keyboard focus
- Keep touch targets at least 36 px and preferably 40 px
- Preserve critical errors, prices, statuses, and action labels without truncation
- Localize customer-visible product copy in Polish and English
- Use direct operational labels such as “Open messages,” “Retry,” and “Save”
- Keep longer translated labels readable

The product app supports light, dark, and system themes. A fixed-format asset may use one theme when the medium requires it, but it must use the corresponding Superseller palette.

## Adapt the look to another medium

Carry the same identity into each medium while changing scale and layout:

| Medium | Preserve | Adapt |
| --- | --- | --- |
| Product UI | Compact type, borders, semantic colors, restrained motion | Density and responsive composition |
| Landing page | Inter, core palette, orange CTA, warm neutral surfaces | Larger headings, more whitespace, narrative imagery, subtle ambient gradients |
| Email | Core colors, logo, one orange CTA, direct hierarchy | System font stack, inline styles, fixed email-safe layout |
| Social or open graph image | Logo, Inter, core palette, clear hierarchy | Larger display type and a composed visual focal point |
| Third-party form or portal | Core color mapping, Inter, rounded filled CTA | Use the closest supported values and controls |

A derivative design should look related to the app without resembling a screenshot of the app.

## Verify a new Superseller surface

Before shipping, confirm:

- [ ] The canvas, panel, text, border, and orange values come from this guide
- [ ] Inter is used where the medium supports it
- [ ] The canonical logo remains unaltered
- [ ] Orange identifies the primary action, selection, or progress
- [ ] Status colors communicate real states
- [ ] Borders establish hierarchy before shadows
- [ ] Radii stay mild outside chips and avatars
- [ ] The design has one clear primary action per region
- [ ] Icons use a consistent outline style
- [ ] Copy is direct, concrete, and operational
- [ ] Focus, contrast, motion preferences, and translated labels are handled
- [ ] Any gradient or illustration belongs to marketing, not operational UI

## Verify implementation values

Use these files when exact app values change:

| Concern | Source |
| --- | --- |
| Theme colors | `frontend/shared/ui/gluestack-ui-provider/config.ts` |
| Typography, radii, and Tailwind mappings | `frontend/tailwind.config.js` |
| Loaded Inter weights | `frontend/app/_layout.tsx` |
| Canonical logo | `frontend/assets/logos/logo.svg` |
| Brand lockup | `frontend/shared/components/navigation/NavBrand.tsx` |
| Section-header proportions | `frontend/shared/components/SectionHeader.tsx` |
| Web elevation | `frontend/shared/lib/webShadow.ts` |
| Shared component primitives | `frontend/shared/ui/` |

# Provenance

This concept was migrated from `docs/DESIGN_GUIDELINES.md` on 2026-07-08. It was rewritten on 2026-07-24 as a portable visual reference grounded in the current product application.
