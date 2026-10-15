# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the
project uses [Semantic Versioning](https://semver.org/). While it is `0.x`, a minor
version may include breaking changes; they are flagged under "Changed". The reasoning
behind each decision is in [`docs/DECISIONES.md`](./docs/DECISIONES.md).

## [Unreleased]

### Changed

- `ORGTABLE_WEBHOOKS_ALLOW_PRIVATE` (never released) is now `ORGTABLE_ALLOW_PRIVATE_TARGETS`
  and also covers S3 backup endpoints. docker-compose gains a `backups` volume
  (`ORGTABLE_BACKUP_DIR`).

- **Settings are pages, not anchors.** One's own settings moved from one long page with
  `#fragments` to `/settings/profile`, `/settings/security`, `/settings/tokens`,
  `/settings/appearance`, `/settings/workspaces` (new: your organizations) and
  `/settings/data`. Old `/settings#…` links still land on the right page.
- An organization's settings have an index (`/<slug>/settings`), the members moved to
  `/<slug>/settings/members` and creating an employee to its own page. On a phone the index
  is a list of sections.

### Added

- **Custom roles per organization** (`/<slug>/settings/roles`). Owners and admins create
  roles with a name, colour, description and any of 13 permissions: see every board, create,
  change visibility and delete boards, invite, manage teams, remove people, webhooks and
  apps, API keys, the activity log, data export and backups. Owner, Admin and Member stay
  as locked base roles. A custom role can never change roles, and the database refuses a
  role from another organization. See `docs/roles.md`.
- Members can be given a custom role from the members list or when their account is created.
- **Teams** (`/<slug>/settings/teams`): groups of people that get a role (reader, editor or
  manager) on some boards, private ones included. The highest of every path to a board wins,
  and a team never gives more than the person configuring it has. See `docs/teams.md`.
- **Activity log per organization** (`/<slug>/settings/audit`, `audit.view`): events grouped
  by day with category and person filters, readable names instead of ids, and a CSV export.
  Audit events now remember their workspace (older ones were backfilled). See `docs/audit.md`.
- A custom role with `boards.delete` can also delete through `DELETE /api/v1/boards/:id`.
- **Two-step verification** (TOTP) for every account: QR setup, ten single-use recovery
  codes, a second step at sign-in (`/login/verify`), replay protection, and a reset in
  _Admin › Users_ for people who lost their phone. See `docs/authentication.md`.
- **Organization security** (`/<slug>/settings/security`): require two-step verification
  for everyone who opens its boards, limit employee accounts and board invitations to some
  email domains, and see, close and reset the sessions and two-step verification of the
  accounts the organization created.
- **Webhooks** (`/<slug>/settings/webhooks`): outgoing webhooks for the whole organization
  or one board, 12 events, HMAC-SHA256 signature with a timestamp, secret rotation with 24 h
  of overlap, retries with growing waits (`POST /api/cron/webhooks`), automatic switch-off
  after repeated failures, a delivery log with request and response, test and redeliver. An
  SSRF guard refuses private addresses. See `docs/webhooks.md`.
- **Slack, Discord and Microsoft Teams** (`/<slug>/settings/integrations`): webhooks whose
  message is already written for the chat, escaped so nothing can ping everyone.
- **Incoming webhooks**: a secret URL (`POST /api/hooks/in/<token>`) that creates cards with
  labels, due date and assignee.
- **Backups of an organization** (`/<slug>/settings/backups`): daily, weekly or monthly at
  its own hour and time zone, kept on this server or in its own S3-compatible bucket,
  encrypted with AES-256 by default, with a history to download and restore from. Export to a
  readable `.zip` and import one into any organization (people matched by email, never
  created). Importing and restoring take a backup first; restoring is all-or-nothing.
- **Instance backups** (`/admin/backups`) for the administrator: every table and file, with
  the same schedule, destinations and restore. New cron job `POST /api/cron/backups` (hourly).
- **Organization API keys** (`/<slug>/settings/api-keys`, `ot_org_…`): keys of the
  organization rather than of a person. They only reach its boards, at most as an editor,
  expire if you want, stop working when their creator leaves, and their use is logged.
- **Brand of an organization** (`/<slug>/settings/general`): logo (PNG/JPEG/WebP, type read
  from the bytes, SVG refused), brand colour with a preview, and the organization's time zone.
  The logo replaces the initials in the settings menu and the list of organizations.
- **`ORGTABLE_SECRET_KEY`**: encrypts the secrets the app must read back (AES-256-GCM).
  `install.sh` generates it, also for existing installations. See `docs/security.md`.
- **Public landing page** at `/` for visitors without a session, in a retro look: what
  orgtable is, a free account on the instance (while sign-up is open) and the one-line
  installer for your own server. `ORGTABLE_LANDING` (`auto` by default: only while
  sign-up is open; `on`; `off`) and `ORGTABLE_INSTALL_URL` configure it. See
  `docs/landing.md`.
- CI builds the production Docker image.

### Fixed

- The Docker image builds from a clean clone again (`public/` is tracked).

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
