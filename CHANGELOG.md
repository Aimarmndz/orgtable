# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/). While it is `0.x`, a minor
version may include breaking changes; they are flagged under "Changed". The reasoning
behind each decision is in [`docs/DECISIONES.md`](./docs/DECISIONES.md).

## [0.2.0] — 2026-10-14

### Added

- Optional open sign-up per instance (`/register`), with consent and anti-abuse limits.
  Closed by default.
- Operator legal details in *Admin › Instance* and public privacy, terms, cookies and
  legal notice pages.
- Redesigned settings: profile, password change, open sessions, appearance, personal
  data download and account deletion.
- Scheduled cleanup `POST /api/cron/maintenance` and the
  `ORGTABLE_AUDIT_RETENTION_DAYS` variable.
- Account menu in the top bar. Boards show their cards and members.
- Per-instance `robots.txt`, Open Graph and a custom icon.
- **English and Spanish interface**, English by default. The language comes from the
  picker (footer and Settings › Appearance), the account's preference or the browser.
  Notifications are written in each recipient's language. Translations live in
  `locales/<code>/*.json`, and adding a language is documented in `locales/README.md`.
- `pnpm test` checks that every language has the same messages, placeholders and plural
  forms as English (`test/i18n.test.ts`).
- README with screenshots and GIFs, a Spanish README (`README.es.md`) and
  `docs/privacy.md`.

### Changed

- **License: AGPL-3.0-or-later** with an attribution term (section 7(b)). It replaces the
  previous proprietary license.
- Bricolage Grotesque and Figtree typefaces (OFL) instead of Cabinet Grotesk and Satoshi.
- `ORGTABLE_SOURCE_URL` sets the "Source code" link. If you deploy a modified version,
  point it to your fork.
- The code, tests, documentation and commit messages are in English. The public REST API
  answers in English.
- `next` 16.3.8 and patched `sharp` and `source-map-js` (security advisories).
- The `20261014171630_registration_and_legal` and `20261014175506_user_locale`
  migrations are applied automatically on startup.

## [0.1.0]

Boards, lists and cards with drag and drop, multi-user with roles, real time,
attachments, search, calendar, notifications, public API with tokens, card collaboration,
due-date reminders and filters. Details in [`docs/roadmap.md`](./docs/roadmap.md).
