<div align="center">

# orgtable

### Your work, in columns that breathe.

Open-source Kanban boards: boards, lists and cards with drag and drop,<br>
in real time. Free for people and companies at orgtable.aimar.dev, or on your own server.

[![CI](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml/badge.svg)](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml)
[![License: AGPL-3.0-or-later](https://img.shields.io/badge/license-AGPL--3.0--or--later-9b411e)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/self--hosted-Docker-2496ed)](./docs/self-hosting.md)

🇬🇧 **English** · 🇪🇸 [Español](./README.es.md)

[Features](#what-it-is) · [Installation](#installation) · [Privacy](#privacy) · [Documentation](./docs/index.md) · [License](#credits-and-license)

<br>

<img src="docs/screenshots/hero.gif" alt="A board of the organization Northwind Studio at /northwind/website-launch: the card “Team photos” is dragged from the In progress list to Review, then the details of “Build the home page” open, with labels, assignees, description, due date and a checklist" width="960">

<sub>No editing: the real app with sample data, recorded in the browser.</sub>

</div>

## What it is

orgtable is a Kanban board app, free for people and companies. Use it at
**[orgtable.aimar.dev](https://orgtable.aimar.dev)**: sign up yourself or register your
organization, create your employees' accounts and share boards at addresses like
`orgtable.aimar.dev/your-company/roadmap`. Or run your own copy on any server with Docker in a
single command.

- 🗂️ **Boards, lists and cards** with drag and drop, by mouse and by keyboard. Cards have
  labels, due dates, checklists, attachments, assignees and comments.
- ⚡ **Real time.** What one person moves, everyone else sees instantly, without reloading.
- 👥 **Teams.** Per-board roles (owner, editor and viewer), notifications and due-date
  reminders.
- 🏢 **Organizations, free.** Register your company, create your employees' accounts, and give
  every board an address: `/<workspace>/<board>`. Owner, admin and member roles plus **custom
  roles** with 13 permissions, and **teams** that share boards. See
  [`docs/workspaces.md`](./docs/workspaces.md) and [`docs/roles.md`](./docs/roles.md).
- 🛡️ **Security for companies.** Two-step verification (TOTP) for every account, and per
  organization: mandatory 2FA, allowed email domains, the sessions of its employees and an
  **activity log** with CSV export.
- 🔗 **Webhooks and integrations.** Signed outgoing webhooks per organization or board, Slack,
  Discord and Teams, and incoming webhooks that create cards. See
  [`docs/webhooks.md`](./docs/webhooks.md).
- 💾 **Backups from the app.** Scheduled, to your server or your own S3, encrypted, with
  restore; a portable export/import `.zip`; and whole-instance backups for the administrator.
  See [`docs/backups.md`](./docs/backups.md).
- 🔎 **Search, filters and a calendar view**, where you drag cards to change their due date.
- 🔌 **REST API** with personal tokens and organization keys, read-only or read-write, with
  optional expiry.
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
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/landing-light.webp" alt="The public landing page in a retro style: “Your boards. Your server.”, an example board in a window, and buttons to create a free account, register a company or install it" width="100%"><br><sub><b>Landing page</b>. Free online, or on your own server.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/register-light.webp" alt="Sign-up form with the choice “For me” or “For my organization”, and the organization’s name and address" width="100%"><br><sub><b>Sign up</b> yourself or your organization, free.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/org-members-light.webp" alt="Members of the organization Northwind Studio: role summary cards, a table with each person’s role, and buttons to change the role, set a new password or remove them, plus the form to create an employee account" width="100%"><br><sub><b>Your organization</b>. Employees, roles and who can do what.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/workspace-light.webp" alt="The page of the organization Northwind Studio at /northwind with its boards" width="100%"><br><sub><b>Every organization has its address</b>: <code>/northwind/website-launch</code>.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/org-general-light.webp" alt="Organization settings: name and address, leaving the organization, and a danger zone to delete it" width="100%"><br><sub><b>Organization settings</b>, with a danger zone.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/admin-light.webp" alt="The instance administrator’s overview: service figures and every organization with its owners, members, boards and status, and buttons to suspend or delete" width="100%"><br><sub><b>Administration</b>. Figures and every workspace, never their content.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/realtime.gif" alt="Two browsers on the same board: on the left Lucía moves the card “Monthly newsletter” to To do, and on the right Marcos sees it appear immediately" width="100%"><br><sub><b>Real time</b>. Lucía moves a card and Marcos sees it instantly.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/card-dark.webp" alt="Card details in the dark theme, with labels, assignees, description, due date and a half-done checklist" width="100%"><br><sub><b>Card details</b>, in the dark theme.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/calendar-light.webp" alt="October calendar view with each card placed on its due date" width="100%"><br><sub><b>Calendar</b>. Drag a card to change its due date.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/boards-light.webp" alt="Your boards grouped by workspace: personal boards and the organization Northwind Studio" width="100%"><br><sub><b>Your boards</b>, grouped by workspace.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/settings-light.webp" alt="Settings page with side navigation: profile with your personal address, password and sessions, API tokens, appearance, privacy and data" width="100%"><br><sub><b>Settings</b>. Profile, your address, sessions and your data.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/board-dark.webp" alt="The same board in the dark theme" width="100%"><br><sub><b>Dark theme</b>, in warm charcoal.</sub></td>
  </tr>
</table>

<details>
<summary>On mobile</summary>
<br>
<p align="center">
  <img src="docs/screenshots/board-mobile.webp" alt="The board on a 390 px wide phone, with columns that scroll horizontally" width="300">
  &nbsp;
  <img src="docs/screenshots/landing-mobile-dark.webp" alt="The landing page on a 390 px wide phone in the dark theme" width="300">
</p>
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
  `ORGTABLE_AUDIT_RETENTION_DAYS`, `ORGTABLE_SOURCE_URL`, `ORGTABLE_LANDING`,
  `ORGTABLE_INSTALL_URL`, `ORGTABLE_SECRET_KEY` (two-step verification, webhooks and backups
  need it; the installer generates it), `ORGTABLE_BACKUP_DIR`, `ORGTABLE_IMPORT_MAX_MB` and
  `ORGTABLE_ALLOW_PRIVATE_TARGETS`.

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
