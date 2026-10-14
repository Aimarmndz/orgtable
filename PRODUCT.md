# Product

## Register

product

## Users

Technical people who self-host their own tools (developers, small teams, self-hosting
enthusiasts). They work in the browser, mostly on desktop. Their main task is capturing
work and moving it between states on Kanban boards: creating cards quickly, dragging
them between lists, and opening the details to add context (description, labels, dates,
checklists).

## Product Purpose

orgtable is a self-hosted Trello alternative: boards → lists → cards with drag and drop.
Success means it feels as fluid and familiar as Trello, while being yours (your data,
your server). The product disappears behind the task.

## Brand Personality

Familiar, colorful and direct. Cheerful without being childish, with the confidence of a
polished product tool. The voice is concrete, with no marketing jargon. The interface is
available in English (the default) and Spanish, and the copy in every language follows
the same voice.

## Anti-references

- Gray, lifeless corporate UI (heavy Jira style).
- Generic SaaS dashboards: metric cards, decorative gradients, uppercase tracked
  eyebrows.
- The "made by AI" look: washed-out grays on near-whites, colored side borders as
  accents, diffuse shadows stuck to 1px borders.
- Cluttered or skeuomorphic.

## Design Principles

- **Earned familiarity.** Trello's Kanban pattern is the product's language; it is not
  reinvented, it is executed well.
- **Color lives in the content.** Board backgrounds and labels carry the color; the
  interface chrome stays neutral.
- **The board is the hero.** Headers and navigation step aside so the content leads.
- **Fluid by default.** Creating, dragging and moving happen instantly (optimistic UI),
  with no reloads or waiting.

## Accessibility & Inclusion

- AA contrast: body text ≥4.5:1. Color labels are never the only indicator (they always
  carry a name or text).
- Light and dark themes with a persistent picker.
- `prefers-reduced-motion` is respected in every transition.
- Language picker (English and Spanish) in the footer of the public pages and in
  Settings › Appearance.
