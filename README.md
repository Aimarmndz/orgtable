<div align="center">

# orgtable

### Your work, in columns that breathe.

Open-source Kanban boards: boards, lists and cards with drag and drop,<br>
in real time, with your data wherever you decide. A Trello alternative you can host yourself.

[![CI](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml/badge.svg)](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-9b411e)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/self--hosted-Docker-2496ed)](./docs/self-hosting.md)

🇬🇧 **English** · 🇪🇸 [Español](./README.es.md)

[Features](#what-it-is) · [Installation](#installation) · [Privacy](#privacy) · [Documentation](./docs/index.md) · [License](#credits-and-license)

<br>

<img src="docs/screenshots/hero.gif" alt="An orgtable board: the card “Team photos” is dragged from the In progress list to Review, then the details of “Build the home page” open, with labels, assignees, description, due date and a checklist" width="960">

<sub>No editing: the real app with sample data, recorded in the browser.</sub>

</div>

## What it is

orgtable is a Kanban board app. Use it on a public instance with free sign-up, or run your
own on any server with Docker in a single command.
<!-- TODO: link the official public instance URL here once it is published; Aimar decides
it. -->

- 🗂️ **Boards, lists and cards** with drag and drop, by mouse and by keyboard. Cards have
  labels, due dates, checklists, attachments, assignees and comments.
- ⚡ **Real time.** What one person moves, everyone else sees instantly, without reloading.
- 👥 **Teams.** Per-board roles (owner, editor and viewer), notifications and due-date
  reminders.
- 🔎 **Search, filters and a calendar view**, where you drag cards to change their due date.
- 🔌 **REST API** with personal tokens, read-only or read-write, with optional expiry.
- 🔐 **Optional open sign-up and GDPR built in.** Legal pages adapt to each instance, and
  everyone can download or delete their own data from the settings.
- 🌍 **English and Spanish.** The interface follows your browser language, and you can
  change it from the footer or from *Settings › Appearance*. Translations are welcome: see
  [`locales/README.md`](./locales/README.md).
- 🌗 **Light and dark themes**, accessible by keyboard and screen reader, comfortable on
  mobile.
- 🐳 **Self-hostable.** The installer sets up Docker and generates the secrets, and a
  wizard creates the admin account.

## The app

<table>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/realtime.gif" alt="Two browsers on the same board: on the left Lucía moves the card “Monthly newsletter” to To do, and on the right Marcos sees it appear immediately" width="100%"><br><sub><b>Real time</b>. Lucía moves a card and Marcos sees it instantly.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/card-dark.webp" alt="Card details in the dark theme, with labels, assignees, description, due date and a half-done checklist" width="100%"><br><sub><b>Card details</b>, in the dark theme.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/calendar-light.webp" alt="October calendar view with each card placed on its due date" width="100%"><br><sub><b>Calendar</b>. Drag a card to change its due date.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/boards-light.webp" alt="Board index with each board's color, card count and the initials of its members, plus the account menu" width="100%"><br><sub><b>Your boards</b>, with who is on each one.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/settings-light.webp" alt="Settings page with side navigation: profile, password and sessions, API tokens, appearance, privacy and data, and about" width="100%"><br><sub><b>Settings</b>. Profile, sessions, tokens and your data.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/board-dark.webp" alt="The same board in the dark theme" width="100%"><br><sub><b>Dark theme</b>, in warm charcoal.</sub></td>
  </tr>
</table>

<details>
<summary>On mobile</summary>
<br>
<p align="center"><img src="docs/screenshots/board-mobile.webp" alt="The board on a 390 px wide phone, with columns that scroll horizontally" width="320"></p>
</details>

## Requirements

**To host it on a server:**

- Linux with internet access.
- Docker and Docker Compose v2 (`docker compose`). If Docker is missing, the installer
  installs it.
- A free port, `3000` by default.
- For real use: a domain and a reverse proxy with HTTPS (Caddy or nginx).

**To develop:**

- Node.js 22, the version used by CI and the Docker image.
- pnpm 11, enabled with `corepack enable`. The exact version is in the `packageManager`
  field of `package.json`. Do not use npm or yarn.
- Docker, for the development PostgreSQL database.

## Installation

### On a server

```bash
curl -sSL https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh | bash
```

The installer detects or installs Docker, generates the secrets (`.env` with `600`
permissions) and starts the app. Then open `http://<your-server-ip>:3000` and complete the
setup wizard, which creates the admin account.

Over plain HTTP, the password and the session travel unencrypted. For real use, put HTTPS
in front of it following
[`docs/self-hosting.md`](./docs/self-hosting.md#https-and-domain-reverse-proxy). The full
guide and the manual installation are in [`docs/installation.md`](./docs/installation.md).

### Locally, for development

```bash
git clone https://github.com/Aimarmndz/orgtable.git && cd orgtable
corepack enable
pnpm install

# Development PostgreSQL on port 5433
docker run -d --name orgtable-dev-pg \
  -e POSTGRES_USER=orgtable -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=orgtable \
  -p 5433:5432 postgres:17-alpine

# Minimal .env: the app requires SESSION_SECRET (at least 16 characters)
printf 'DATABASE_URL=postgresql://orgtable:devpass@localhost:5433/orgtable\nSESSION_SECRET=%s\n' \
  "$(openssl rand -hex 32)" > .env

pnpm exec prisma migrate dev     # applies the migrations
pnpm exec prisma generate        # generates the Prisma client
pnpm dev                         # http://localhost:3000
```

More details in [`docs/contributing.md`](./docs/contributing.md).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server with hot reload. |
| `pnpm build` / `pnpm start` | Builds for production and serves the build. |
| `pnpm lint` | ESLint. |
| `pnpm typecheck` | Type check (`tsc --noEmit`). |
| `pnpm test` | Unit tests (no database). |
| `pnpm test:integration` | Integration tests against a real PostgreSQL database whose name ends in `_test` (see [`docs/testing.md`](./docs/testing.md)). |
| `pnpm exec prisma migrate dev` | Creates and applies migrations in development. |
| `pnpm exec prisma migrate deploy` | Applies pending migrations. The container does this on startup. |
| `scripts/backup.sh` · `scripts/restore.sh` · `scripts/update.sh` | Backup, restore and update of a Docker installation (see [`docs/operations.md`](./docs/operations.md)). |
| `POST /api/cron/reminders` · `POST /api/cron/maintenance` | Due-date reminders and cleanup of expired data. Triggered by an external cron job with `CRON_SECRET` (see [`docs/operations.md`](./docs/operations.md#scheduled-tasks)). |

## Environment variables

Every variable is documented in
[`docs/installation.md`](./docs/installation.md#environment-variables), and the commented
template is [`.env.example`](./.env.example).

- **Required:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`,
  `SESSION_SECRET`.
- **Optional:** `APP_PORT`, `CRON_SECRET`, `TRUSTED_PROXY_HOPS` and the `ORGTABLE_*`
  settings: `ORGTABLE_TIMEZONE`, `ORGTABLE_UPLOAD_DIR`, `ORGTABLE_REALTIME_PG_NOTIFY`,
  `ORGTABLE_AUDIT_RETENTION_DAYS` and `ORGTABLE_SOURCE_URL`.

## Deployment

Docker Compose builds the image on the server itself: the app plus PostgreSQL, with no
database port exposed. Migrations are applied on startup.

- Running in production, HTTPS and reverse proxy: [`docs/self-hosting.md`](./docs/self-hosting.md).
- Backups, restore, updates and cron: [`docs/operations.md`](./docs/operations.md).
- The image and the orchestration: [`docs/docker.md`](./docs/docker.md).
- Opening the instance to the public with free sign-up: the checklist is in
  [`docs/privacy.md`](./docs/privacy.md#checklist-for-opening-a-public-instance).

## Privacy

orgtable keeps only what your account and boards need. There are no analytics, no ads and
no tracking cookies: just one session cookie (plus a language cookie when you pick a
language).

- **Whoever runs an instance is the data controller.** They enter their details under
  *Admin › Instance*, and the pages `/legal/privacy`, `/legal/terms`,
  `/legal/cookies` and `/legal/notice` show them. Anything missing appears as "not
  provided", never made up.
- **Everyone exercises their own rights** from *Settings › Privacy and data*: download all
  their data as JSON, or delete their account together with their boards and attachments.
- **Short, automatic retention.** Sessions expire after 7 days, notifications are deleted
  after 180 days and the security log after 90 (configurable).

Technical details and legal basis in [`docs/privacy.md`](./docs/privacy.md).

## Documentation

All documentation lives in [`docs/`](./docs/), indexed in
[`docs/index.md`](./docs/index.md): architecture, database, authentication and
authorization, the [public API](./docs/api/public-api.md), the
[decision log](./docs/DECISIONES.md) and [how to contribute](./docs/contributing.md).

## Contributing

Contributions are welcome. Please read [`docs/contributing.md`](./docs/contributing.md)
first. Code, comments, docs and commit messages are in English. Every commit carries a
`Signed-off-by` line ([DCO](https://developercertificate.org/), with `git commit -s`).

Translations are especially welcome: adding a language means copying one folder and
translating JSON files, with no code knowledge needed. See
[`locales/README.md`](./locales/README.md).

Report security issues through [`SECURITY.md`](./SECURITY.md), never in public issues.

## Credits and license

Created by **Aimar** ([github.com/Aimarmndz](https://github.com/Aimarmndz)). Built with
[Next.js](https://nextjs.org), [React](https://react.dev),
[Prisma](https://www.prisma.io), [PostgreSQL](https://www.postgresql.org),
[dnd-kit](https://dndkit.com) and [Tailwind CSS](https://tailwindcss.com). It uses the
typefaces [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque),
[Figtree](https://fonts.google.com/specimen/Figtree) and
[Geist Mono](https://fonts.google.com/specimen/Geist+Mono), all under the SIL OFL 1.1.

Licensed under the **GNU AGPL-3.0-or-later** with an additional term under section 7(b):
modified versions must keep the attribution "Created by Aimar (github.com/Aimarmndz)" in
the footer of the public pages and in the "About" section of the settings. You may use,
modify and host it, commercially too. If you offer it as a service, you must publish your
source code under the same license. See [`LICENSE`](./LICENSE).
