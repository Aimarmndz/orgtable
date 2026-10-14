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

🇪🇸 [Español](./README.md) · 🇬🇧 **English**

<br>

<img src="docs/screenshots/hero.gif" alt="An orgtable board: the card «Fotos del equipo» is dragged from In progress to Review, then the details of «Maquetar la home» open, with labels, assignees, description, due date and a checklist" width="960">

<sub>No editing: the real app with sample data, recorded in the browser.</sub>

</div>

## What it is

orgtable is a Kanban board app. Use it on a public instance with free sign-up, or run your
own on any server with Docker in one command. The interface is in Spanish for now
(internationalization is on the [roadmap](./docs/roadmap.md)).

- 🗂️ **Boards, lists and cards** with drag and drop, by mouse and by keyboard. Cards have
  labels, due dates, checklists, attachments, assignees and comments.
- ⚡ **Real time.** What one person moves, everyone else sees instantly, without
  reloading.
- 👥 **Teams.** Per-board roles (owner, editor and viewer), notifications and due-date
  reminders.
- 🔎 **Search, filters and a calendar view**, where you drag cards to change their date.
- 🔌 **REST API** with personal tokens, read-only or read-write, with expiry.
- 🔐 **Optional open sign-up and GDPR built in.** Legal pages adapt to each instance, and
  everyone can download or delete their own data from the settings.
- 🌗 **Light and dark**, accessible by keyboard and screen reader, comfortable on mobile.
- 🐳 **Self-hostable.** The installer sets up Docker and generates the secrets, and a wizard
  creates the admin account.

<table>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/realtime.gif" alt="Two browsers on the same board: on the left one person moves a card and on the right another sees it appear immediately" width="100%"><br><sub><b>Real time</b>: one person moves a card, the other sees it instantly.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/card-dark.webp" alt="Card details in the dark theme" width="100%"><br><sub><b>Card details</b>, dark theme.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/calendar-light.webp" alt="Calendar view with cards on their due dates" width="100%"><br><sub><b>Calendar</b>: drag to reschedule.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/settings-light.webp" alt="Settings page with profile, sessions, API tokens, appearance and data" width="100%"><br><sub><b>Settings</b>: profile, sessions, tokens and your data.</sub></td>
  </tr>
</table>

## Install

On a Linux server with internet access (Docker is installed if missing):

```bash
curl -sSL https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh | bash
```

Then open `http://<your-server-ip>:3000` and complete the setup wizard. For real use, put
HTTPS in front of it. Everything else (requirements, manual install, local development,
commands, environment variables, deployment and operations) is in the
[Spanish README](./README.md) and in [`docs/`](./docs/index.md). The code is in English;
the docs are in Spanish.

## Privacy

orgtable keeps only what your account and boards need: no analytics, no ads, no tracking
cookies, only one session cookie.

- **Whoever runs an instance is the data controller.** They enter their details under
  *Administración › Instancia*, and the legal pages show them. Anything missing appears as
  «not provided», never made up.
- **Everyone exercises their own rights** from *Ajustes › Privacidad y datos*: download
  all their data as JSON, or delete their account together with their boards and
  attachments.
- **Short, automatic retention.** Sessions expire after 7 days, notifications are deleted
  after 180, and the security log after 90 (configurable).

Details: [`docs/privacy.md`](./docs/privacy.md).

## Credits and license

Created by **Aimar** ([github.com/Aimarmndz](https://github.com/Aimarmndz)). Built with
Next.js, React, Prisma, PostgreSQL, dnd-kit and Tailwind CSS. Fonts: Bricolage Grotesque,
Figtree and Geist Mono, all under the SIL OFL 1.1.

Licensed under the **GNU AGPL-3.0-or-later** with an additional term under section 7(b):
modified versions must keep the attribution "Created by Aimar (github.com/Aimarmndz)" in
the footer of the public pages and in the "About" section of the settings. You may use,
modify and host it, commercially too. If you offer it as a service, you must publish your
source code under the same license. See [`LICENSE`](./LICENSE).

Contributions are welcome: read [`docs/contributing.md`](./docs/contributing.md) and sign
off your commits ([DCO](https://developercertificate.org/), `git commit -s`). Report
security issues through [`SECURITY.md`](./SECURITY.md).
