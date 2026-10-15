# Roadmap

This page lists what orgtable already does and where it is heading. Plans can change as
the project evolves and as people use it; the order of planned work is indicative.

Every feature follows the same principles: orgtable stays self-hosted, needs no mandatory
external services, keeps the server as the only authority on permissions, and builds on
what already exists (Server Actions + Data Access Layer + Prisma, role-based access
control and the real-time bus).

If you want to work on something here, open an issue first so we can agree on the
approach. See [`contributing.md`](./contributing.md).

## Shipped

### Boards, lists and cards

- Create, rename and delete boards, lists and cards.
- Drag and drop for lists and cards, by mouse, touch and keyboard, with an optimistic UI
  and fractional indexing so a move writes a single row. See
  [`drag-and-drop.md`](./drag-and-drop.md).
- Card details: description, color labels, due dates with an overdue warning, and
  checklists with a progress bar. See [`card-detail.md`](./card-detail.md).
- Attachments stored on disk (a Docker volume) and downloaded through an authorized
  route. See [`attachments.md`](./attachments.md).
- Board export and import as JSON.

### Collaboration

- Board members with roles (owner, editor, viewer), checked by the server on every
  action; viewers get a read-only interface. See [`authorization.md`](./authorization.md).
- Real-time sync between everyone on a board over Server-Sent Events, with an optional
  PostgreSQL `LISTEN/NOTIFY` bridge for several app instances. See
  [`realtime.md`](./realtime.md).
- Card assignees (board members only) and comments. See
  [`card-collaboration.md`](./card-collaboration.md).
- In-app notifications with a bell and unread counter, delivered live. See
  [`notifications.md`](./notifications.md).
- Due-date reminders, triggered by an external cron job. See
  [`reminders.md`](./reminders.md).

### Finding and viewing work

- Global search across boards and cards, limited to what each person can see, with links
  that open a card directly. See [`search.md`](./search.md).
- Board filters by label, assignee and due-date status. See [`filters.md`](./filters.md).
- Calendar view with a monthly grid; dragging a card to another day changes its due date.
  See [`calendar.md`](./calendar.md).

### Public API

- REST API (`/api/v1`) for boards, lists and cards, authenticated with personal access
  tokens that are stored hashed and shown only once.
- Tokens act with their owner's permissions, can be read-only or read-write, and can
  expire. See [`api/public-api.md`](./api/public-api.md).

### Accounts, administration and security

- Setup wizard on first start that creates the admin account. See
  [`setup-wizard.md`](./setup-wizard.md).
- JWT sessions backed by a session table, so signing out, resetting a password or an
  admin action revokes them immediately. See [`authentication.md`](./authentication.md).
- User management for admins, sign-in rate limiting and an audit log. See
  [`admin.md`](./admin.md) and [`operations.md`](./operations.md).
- Optional open sign-up per instance, with consent and anti-abuse measures.
- Account settings, one page per section: profile, password and sessions, two-step
  verification (TOTP), API tokens, appearance, your organizations, data export and account
  deletion.

### Organizations

- Settings with an index and one page per section, behind a single tenant door. See
  [`workspaces.md`](./workspaces.md).
- Custom roles with 13 permissions, and teams that share boards. See [`roles.md`](./roles.md)
  and [`teams.md`](./teams.md).
- Security policy (mandatory 2FA, allowed email domains, employee sessions), activity log with
  CSV, brand (logo, colour, time zone) and organization API keys. See [`audit.md`](./audit.md).
- Signed outgoing webhooks per organization or board, Slack/Discord/Teams and incoming
  webhooks. See [`webhooks.md`](./webhooks.md).
- Backups (scheduled, local or S3, encrypted, restore), export and import, and instance
  backups. See [`backups.md`](./backups.md).
- Security headers, hardened dependencies and authorization tests. See
  [`security.md`](./security.md).

### Privacy and legal

- Operator details entered once by the admin feed the privacy policy, terms, cookie
  policy and legal notice pages.
- Everyone can download all their data as JSON or delete their account.
- Scheduled cleanup of expired sessions, notifications and audit entries. See
  [`privacy.md`](./privacy.md).

### Interface

- Light and dark themes, keyboard and screen reader support, and a layout that works on
  phones. See [`design-system.md`](./design-system.md).
- Interface in English and Spanish, chosen from the browser language or a picker in the
  footer and in Settings › Appearance. New languages can be added without touching code.
  See [`../locales/README.md`](../locales/README.md).

### Self-hosting and operations

- One-command installer that sets up Docker and generates the secrets. See
  [`installation.md`](./installation.md).
- Multi-stage Docker image with automatic migrations on startup and a health endpoint.
  See [`docker.md`](./docker.md).
- Backup, restore and update scripts. See [`self-hosting.md`](./self-hosting.md) and
  [`operations.md`](./operations.md).
- Released under the AGPL-3.0-or-later with an attribution term. See
  [`../LICENSE`](../LICENSE).

## Planned

### PWA and mobile

- Installable progressive web app: manifest, icons and a service worker with a basic
  offline shell.
- Mobile polish for the board and the dialogs: touch dragging, full-width columns and
  touch targets of at least 44 px.

### Automations

Rules of the form "when X happens, do Y" inside a board, in the style of Trello's Butler,
without external services.

- Triggers: card moved to a list, label added or removed, due date approaching or
  reached, checklist completed.
- Actions: move, assign, set a label or a due date, add a checklist, notify.
- Rules run on the existing event bus, with the board's permissions, a per-event limit
  to prevent loops, and an audit trail. Only board owners can create them.

### More board views

- Table view: every card of a board in a sortable, filterable table (title, list,
  assignee, due date, labels), next to the Board and Calendar views.
- Swimlanes: group the board into rows by label or by assignee.
- Both reuse the existing board filters.

### Templates, duplication and archiving

- Board templates, and duplicating boards, lists and cards.
- Archive instead of delete for boards, lists and cards, with an archive view and
  restore.

### Card activity

- An activity history on each card, visible to board members: created, moved, renamed,
  commented, assigned, due date changed.
- Optionally, an activity feed per board, updated in real time.

### Integrations

- Email-to-card, and webhook settings reachable from each board's menu.

### Accessibility

- A full pass on focus handling, ARIA roles and screen reader announcements for drag and
  drop, dialogs and notifications, plus a contrast review.

### More languages

- Community translations beyond English and Spanish. The guide is in
  [`../locales/README.md`](../locales/README.md).

## Ideas / later

- Optional single sign-on with OpenID Connect, alongside the built-in sign-in.
- Passkeys (WebAuthn) as a second factor or instead of passwords.
- Observability: a metrics endpoint (Prometheus), structured logs and a readiness check.
- Streaming exports and imports for organizations with gigabytes of attachments.
- Password policies and maximum session length per organization.

## Smaller improvements

- Email and Web Push for notifications and reminders, with per-user notification
  preferences. With email in place: address verification for open sign-up and password
  recovery without an admin.
- Full-text search with PostgreSQL (`tsvector` + GIN) and saved quick filters.
- A wider public API (checklists, labels, attachments, members, moving and reordering,
  creating assignees and comments), API rate limiting and an OpenAPI reference.
- Transferring board ownership, so deleting an account does not take shared boards with
  it.
- Card covers and colors, and Markdown in descriptions.
- CSV export of a board, in addition to JSON.
- Reactions on comments.
