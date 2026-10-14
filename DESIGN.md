# Design

orgtable's visual system. Aesthetic: **warm editorial**. The chrome lives in warm
neutrals (sand, paper, espresso) with a single **terracotta** accent; content color
(board backgrounds and labels) uses a muted, cohesive palette. Tokens are in OKLCH,
defined in `app/globals.css` (Tailwind 4 `@theme`), with light and dark themes.

## Color

Strategy: **restrained in the chrome, muted and cohesive in the content**. The base
interface is warm and neutral; the only accent is terracotta (saturation < 80%). No neon
purple, no glows, no pure black (the "ink" is a warm espresso).

### Neutrals (chrome)

| Role | Light (OKLCH) | Dark (OKLCH) | Use |
|-----|---------------|----------------|-----|
| `--bg` | 0.965 0.013 74 | 0.205 0.012 52 | App background (sand / warm charcoal) |
| `--surface` | 0.992 0.005 80 | 0.25 0.014 52 | Cards, panels, modals (paper) |
| `--surface-2` | 0.94 0.015 74 | 0.30 0.016 52 | Inputs, hovers |
| `--column` | 0.95 0.014 72 | 0.23 0.013 52 | Board column background |
| `--ink` | 0.27 0.022 52 | 0.95 0.012 75 | Main text (≥4.5:1) |
| `--ink-muted` | 0.49 0.026 55 | 0.73 0.02 68 | Secondary text (≥4.5:1) |
| `--border` | 0.88 0.016 72 | 0.36 0.016 55 | Subtle borders, dividers |

### Accent and intent

| Role | Light | Dark | Use |
|-----|-------|--------|-----|
| `--accent` | 0.56 0.125 42 | 0.68 0.115 45 | Primary action, focus, selection (terracotta) |
| `--accent-ink` | 0.99 0.01 80 | 0.2 0.02 50 | Text on accent |
| `--danger` | 0.52 0.18 28 | 0.71 0.16 30 | Delete, error |
| `--success` | 0.48 0.1 145 | 0.72 0.1 150 | Confirmations |

### Board and label colors (content)

A **muted** editorial palette (clay, olive, plum, ochre, brick, slate), not vibrant, in
`app/lib/colors.ts`. Boards use L≤0.54 and labels L≈0.52–0.57 so white text on top is
legible. On a colored board background, columns are paper with a touch of translucency
(`bg-column/95`) and cards are solid `--surface` with a **side rule** tinted with the
color of their first label.

## Typography

Two families with character, both under the **SIL OFL 1.1** license (Google Fonts).
`next/font` downloads them at build time and serves them from the app itself (see
`app/layout.tsx`):

- **Bricolage Grotesque** (`--font-display`, `font-display` utility): headings and the
  brand. Tight tracking (`tracking-tight`), weights 700–800. Hierarchy through weight and
  color, not oversized type.
- **Figtree** (`--font-sans`): interface and body, weights 400/500/600/700.
- **Geist Mono** (`--font-mono`): tabular numbers, metadata, counters.

Only fonts that can be redistributed with the code (OFL or similar) are allowed: the
repository is public and AGPL. Satoshi and Cabinet Grotesk (Fontshare, ITF FFL) were
removed for that reason.

Banned: Inter and generic serifs. Fixed rem scale, ratio ~1.2. `text-wrap: balance` on
headings. Uppercase only for micro-labels (≤2 words, e.g. column and section headers).

| Token | Size / weight / family | Use |
|-------|-------------------------|-----|
| Page display | 1.875–3rem / 700–800 / Bricolage | "Your boards", board title, login |
| Subtitle | 1.25rem / 700 / Bricolage | Modal title |
| Body | 0.875rem / 400–500 / Figtree | Card text, forms |
| Micro-label | 0.625–0.75rem / 600 / Figtree (uppercase) | Column/section headers |

Copy must fit every language: Spanish strings are often longer than English ones, so
labels and buttons must not rely on a fixed width.

## Components

Consistent vocabulary. Every control defines `default / hover / focus-visible / active /
disabled`.

- **Primary button**: `--accent` background, `--accent-ink` text, 8px radius, no glow;
  tactile feedback `active:translate-y-px`; focus with an `--accent` ring.
- **Subtle/ghost/danger button**: transparent or `--surface-2`; same tactile feedback.
- **Input**: `--surface` background, `--border` border, label above, error below; focus
  with border + `--accent` ring.
- **Card**: `--surface`, 8px radius, 1px border, tinted shadow ≤8px; 3px side rule in the
  color of the first label; labels shown as `dot + NAME`. If it has a checklist, a slim
  **progress bar** on the face shows progress at a glance (accent while in progress,
  `--success` when complete) + a `done/total` counter.
- **Column**: translucent paper over the board background, 16px radius, small-caps
  header.
- **Label**: pill in a muted palette color, full radius, legible text.
- **Modal**: `<dialog>`/portal; darkened backdrop; scale + fade on entry; wide diffuse
  shadow tinted with the ink color.
- **Empty state**: shows what to do (not "there is nothing here"), with an SVG icon
  (never an emoji).

Radii: inputs/buttons 8px, cards 8px, columns 16px, modals/panels 16px, pills/labels
full.

## Layout

- **App shell**: thin translucent top bar with the brand and the instance name; on the
  right, search, notifications, theme and the **account menu** (initials in a terracotta
  circle) with profile, sessions, privacy, administration and sign out. It is a native
  `popover` anchored below the button.
- **Access** (login, sign-up): asymmetric split with the terracotta brand panel
  (`BrandPanel`, with a board thumbnail) on one side and the form on the other; it
  collapses to one column below `lg`. Below it, the public footer with the legal links,
  the language picker and the attribution.
- **Settings and legal pages**: side navigation (a column from `md`, a scrollable row on
  mobile) and content in `--surface` cards with a 16px radius. Long text uses
  `.legal-prose` (in `globals.css`) with a maximum measure of ~68ch.
- **Columns**: horizontal flex, fixed width (~18rem), scroll-x; cards in a vertical flex
  with internal scroll-y.
- **Boards (index)**: grid `repeat(auto-fill, minmax(15rem, 1fr))`, each board in its
  muted color, a subtle gradient for title legibility, the card count and the members'
  initials when shared.
- **Semantic z-index**: texture(0) → content(10) → bar(20) → modal-backdrop(30) →
  modal(40) → toast(50).

## Motion

150–250 ms, `ease-out`. Motion communicates state (hover, drag, modal opening, button
tactile feedback), never decoration. `prefers-reduced-motion`: crossfade or instant. No
orchestrated loading sequences.

## Texture

Subtle global paper grain: a fixed `body::before` layer, `pointer-events: none`,
`multiply` (light) / `screen` (dark) blending at low opacity. Only on a fixed
pseudo-element — never on scrolling containers, so the GPU does not repaint on scroll.

## Landing (retro)

The public page at `/` (`app/components/landing/`, see `docs/landing.md`) has its own
look on purpose: it sells the product, the app stays out of the way. It is **retro**:
the same warm palette (sand, paper, espresso, terracotta) drawn like an old desktop.

- **Windows**: `.retro-window`, a 2px outline in `--retro-edge`, 4px radius and a hard
  6px offset shadow in `--retro-shadow` (no blur). Title bar `.retro-titlebar`: pinstripes,
  a square close box and the title on a plain plate in pixel type. Used for the example
  board, each feature (named like old files: `BOARDS.EXE`, `LIVE.SYS`…) and the terminal.
- **Buttons**: `.retro-btn`, chunky with a 4px hard shadow that shrinks as the button is
  pressed (`:active` moves it 3px into its shadow). 48px tall, focus ring in the accent.
- **Terminal**: dark in both themes, like a real one: `--terminal` with amber
  `--phosphor` text and a soft glow (`.crt-text`), a blinking caret (`.crt-caret`). Amber
  on espresso stays well above 7:1.
- **Type**: Bricolage Grotesque for headlines (as in the app), Figtree for body, and two
  more OFL faces loaded only by the landing (`app/components/landing/fonts.ts`):
  **Silkscreen** (`font-pixel`) for micro-labels, window titles and kickers, and
  **VT323** (`font-terminal`) for the terminal.
- **Texture**: a dot grid (`.landing-dots`) instead of the paper grain, and a terracotta
  ticker that scrolls (still with reduced motion; screen readers get it once as text).
- **Dark theme**: the same tokens; outlines lighten (`--retro-edge`) and the hard shadows
  go almost black so they read as depth, not as glow.
- The example board uses the real board and label colours (`app/lib/colors.ts`); icons
  are inline SVG in the palette, never emoji.

These classes live in the "Landing" section of `app/globals.css` and are used nowhere
else.

