# Design system

This document describes **orgtable**'s visual system: its aesthetic, the color tokens,
the dark theme, the content palettes and the reusable UI components. It is an operational
summary; the full design decisions live in [`DESIGN.md`](../DESIGN.md) and
[`PRODUCT.md`](../PRODUCT.md).

---

## Aesthetic and principles

orgtable is a **self-hosted Kanban board app** (boards → lists → cards with drag and
drop). It should feel as fluid and familiar as Trello, while being yours. The aesthetic is
**warm editorial**: warm neutrals (sand, paper, espresso) with a single **terracotta**
accent.

The core principle is:

> **Color lives in the content; the chrome is neutral.**

Board backgrounds and labels carry the color, in a muted and cohesive palette; the base
interface (bars, panels, cards, forms) stays neutral and warm (a *restrained* strategy).
The board is the hero: headers and navigation step aside so the content leads.

**Anti-references** (what we avoid): lifeless gray corporate UI, generic SaaS dashboards
with decorative gradients and uppercase eyebrows, and the "AI-made look" (washed-out grays
on near-whites, colored side borders used as accents, diffuse shadows stuck to 1px
borders).

### Accessibility

- **AA contrast**: body text meets ≥4.5:1 (the `--ink` and `--ink-muted` tokens are
  calibrated for it in both themes; `test/contrast.test.ts` checks the tokens in
  `app/globals.css`).
- **Color labels are never the only indicator**: they always carry a name or text.
- **Light and dark themes** with a persistent picker.
- **`prefers-reduced-motion`** is respected globally in `globals.css` (see
  [Motion](#motion)).

---

## Semantic tokens (OKLCH)

Tokens are defined in [`app/globals.css`](../app/globals.css) in **OKLCH** (better
perceptual control of lightness and chroma than RGB/HSL). They are exposed to Tailwind 4
through `@theme inline`, which maps each CSS variable to a `--color-*` usable as
`bg-surface`, `text-ink`, `border-border`, and so on.

```css
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-column: var(--column);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-ink: var(--accent-ink);
  --color-danger: var(--danger);
  --color-success: var(--success);
  --font-sans: var(--font-figtree);
  --font-display: var(--font-bricolage);
  --font-mono: var(--font-geist-mono);
}
```

### Neutrals (chrome)

| Token | Light | Dark | Use |
|-------|-------|--------|-----|
| `--bg` | `0.965 0.013 74` | `0.205 0.012 52` | App background (sand / warm charcoal) |
| `--surface` | `0.992 0.005 80` | `0.25 0.014 52` | Cards, panels, modals (paper) |
| `--surface-2` | `0.94 0.015 74` | `0.3 0.016 52` | Inputs, hovers, secondary backgrounds |
| `--column` | `0.95 0.014 72` | `0.23 0.013 52` | Board columns |
| `--ink` | `0.27 0.022 52` | `0.95 0.012 75` | Main text (≥4.5:1) |
| `--ink-muted` | `0.49 0.026 55` | `0.73 0.02 68` | Secondary text (≥4.5:1) |
| `--border` | `0.88 0.016 72` | `0.36 0.016 55` | Subtle borders and dividers |

### Accent and intent

| Token | Light | Dark | Use |
|-------|-------|--------|-----|
| `--accent` | `0.49 0.13 40` | `0.68 0.115 45` | Primary action, focus, selection (terracotta) |
| `--accent-hover` | `0.44 0.13 40` | `0.74 0.115 45` | Accent hover |
| `--accent-ink` | `0.99 0.01 80` | `0.2 0.02 50` | Text on accent |
| `--danger` | `0.52 0.18 28` | `0.71 0.16 30` | Delete, error |
| `--success` | `0.48 0.1 145` | `0.72 0.1 150` | Confirmations, progress |

> All values are `oklch(L C H)`. Every token has a light/dark pair: the theme picks one by
> reassigning the variables under `:root` or `.dark`. `--danger` and `--success` are dark
> enough to keep 4.5:1 on their own 10–15 % tinted backgrounds too (alerts, overdue badge).

---

## Typography

All fonts are **SIL OFL 1.1** (Google Fonts), loaded with `next/font/google` in
[`app/layout.tsx`](../app/layout.tsx). Next downloads them at build time and serves them
from the app itself, so there are no requests to Google at runtime.

- **Bricolage Grotesque** (`--font-display`, `font-display` utility): headings and brand.
- **Figtree** (`--font-sans`): interface and body text.
- **Geist Mono** (`--font-mono`): tabular numbers, metadata and counters.

---

## Dark theme

The dark theme is **class-based**: a `.dark` class on `<html>` reassigns every color
variable. Tailwind activation is declared with `@custom-variant`:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

This makes utilities such as `dark:block` or `dark:hidden` apply when the element is
inside a tree with the `.dark` class, instead of depending on `prefers-color-scheme`. That
way the user can **force** a theme regardless of the system preference.

### Persistent choice

The [`ThemeToggle`](../app/components/theme-toggle.tsx) component toggles the class and
stores the choice in `localStorage`. It needs no React state: the two icons (sun/moon) are
shown through CSS based on the `.dark` class (`dark:block` / `dark:hidden`). Settings ›
Appearance offers the same choice with a third option, "system", which removes the stored
value and follows the device.

```tsx
function toggle() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  localStorage.setItem("theme", next ? "dark" : "light");
}
```

### Anti-flash script (anti-FOUC)

If the theme were applied from React after hydration, the wrong theme would **flash** on
first paint. To avoid it, [`app/layout.tsx`](../app/layout.tsx) injects an **inline script
in `<head>`** (with the CSP nonce) that runs before the first paint: it reads
`localStorage`, falls back to `prefers-color-scheme` when no preference is stored, and adds
the `.dark` class when needed.

```js
(function(){
  try {
    var t = localStorage.getItem('theme');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (t !== 'light' && m)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
```

`<html>` has `suppressHydrationWarning` because the script changes the class before React
hydrates, which would otherwise trigger a mismatch warning.

---

## Content palettes

Defined in [`app/lib/colors.ts`](../app/lib/colors.ts). These are **content** colors (not
chrome): muted editorial tones (clay, olive, plum, ochre, brick, slate) with lightness low
enough for **white text** on top to stay legible (≥4.5:1).

### Board color: `BOARD_COLORS`

Six hues for board backgrounds:

```ts
export const BOARD_COLORS = {
  blue: "oklch(0.5 0.07 248)",
  green: "oklch(0.5 0.07 150)",
  purple: "oklch(0.48 0.09 330)",
  amber: "oklch(0.54 0.09 62)",
  rose: "oklch(0.52 0.12 33)",
  teal: "oklch(0.5 0.06 200)",
} as const;
```

Related helpers:

- `pickBoardColor(seed)`: a **deterministic** color from an id (simple hash), used to give
  a stable color to a board created without an explicit color.
- `boardBackgroundFor({ id, background })`: uses the chosen color or, if there is none, a
  stable one based on the `id`.

### Label color: `LABEL_COLORS`

Eight colors for labels (all with L ≈ 0.52–0.57 → legible white text):

```ts
export const LABEL_COLORS = {
  green: "oklch(0.53 0.09 150)",
  lime: "oklch(0.56 0.1 128)",
  amber: "oklch(0.56 0.1 65)",
  red: "oklch(0.53 0.15 30)",
  purple: "oklch(0.5 0.11 330)",
  blue: "oklch(0.52 0.09 250)",
  teal: "oklch(0.52 0.07 200)",
  pink: "oklch(0.55 0.12 350)",
} as const;
```

`labelBackground(color)` returns the background color of a label pill (falling back to
`blue`). The keys are exposed as `LABEL_COLOR_KEYS` to draw the color picker when creating
a label (see [`docs/card-detail.md`](./card-detail.md)).

---

## UI components

A small, consistent vocabulary. Radii follow the scale in `DESIGN.md` (inputs, buttons and
cards 8px; columns and panels 12px; modal 16px; pills fully rounded).

### Button

[`app/components/ui/button.tsx`](../app/components/ui/button.tsx): a presentational button
(no `"use client"`, valid in both server and client components) with four variants:

| Variant | Style |
|----------|--------|
| `primary` | `bg-accent text-accent-ink hover:bg-accent-hover` |
| `ghost` | `text-ink-muted hover:bg-surface-2 hover:text-ink` |
| `danger` | `text-danger hover:bg-danger/10` |
| `subtle` | `bg-surface-2 text-ink hover:bg-border` |

Shared base: `rounded-lg`, `px-4 py-2`, `text-sm font-medium`, `transition` with a slight
press (`active:translate-y-px`), focus ring `focus-visible:outline-accent` and a `disabled`
state (`opacity-60`, `pointer-events-none`).

```tsx
<Button>Save</Button>                 {/* primary by default */}
<Button variant="subtle">Add</Button>
<Button variant="danger">Delete</Button>
```

### Input and Textarea

[`app/components/ui/input.tsx`](../app/components/ui/input.tsx) exports `Input` and
`Textarea` with identical styles: `--surface` background, `--border` border, `--ink` text,
a muted placeholder, and focus shown with an accent border plus a ring
(`focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25`).

```tsx
<Input type="date" name="dueDate" />
<Textarea name="description" rows={4} />
```

---

## Motion

Transitions of **150–250 ms** with `ease-out`. Motion communicates state (hover, modal
opening, a card entering), never decorates. `globals.css` holds the `overlay-in` (backdrop
fade) and `dialog-in` (fade plus a slight `translateY`/`scale`) keyframes used by the
detail modal.

The reduced-motion preference is respected globally:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Scrollbars are also slimmed on fine pointers (`scrollbar-width: thin`) because board
columns scroll often.

---

See also: [`DESIGN.md`](../DESIGN.md) · [`PRODUCT.md`](../PRODUCT.md) ·
[`docs/card-detail.md`](./card-detail.md).
