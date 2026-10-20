# Decision log

Technical decisions of the project, most recent first. Each entry has a date, context,
decision, alternatives considered and consequences. Architecture decisions made before
this log (ADR 0001–0015) remain in [`docs/decisions/`](./decisions/); this file is the
living log from 2026-09-24 onwards.

---

## 2026-10-20 — A workspace switcher instead of the instance name in the top bar

**Context.** The top-left corner showed the instance name and always led to `/boards`, which took
people out of the organization they were in, and an organization's settings were several hops away.

**Decision.** A switcher from the first segment of the URL: the current workspace (logo or
initials), a list of the person's workspaces, *All boards*, the current organization's settings
and *Create an organization*. The account menu lists the settings of each organization, and each
organization board shows a gear next to the organization's name. The gear, and the board menu's
*Organization settings*, only appear for members (`BoardDTO.inOrganization`): a guest got a 404.

**Alternatives considered.** Keeping the instance name and pointing it at the current workspace:
still no way to switch, and the name said nothing about where one was.

**Consequences.** The instance name is no longer in the signed-in top bar; it is still the
two-factor issuer and appears on the legal pages.

---

## 2026-10-15 — Backups in the app: a readable zip, S3 by hand, and atomic restores

**Context.** The owner chose all four: organization export/import, scheduled backups, the
organization's own S3, and instance backups for the administrator. Until now backups were
`scripts/backup.sh` (pg_dump on the host), useless to an organization on a shared instance.

**Decision.**
- One format for an organization's export and backup: `organization.json` (people by email,
  local ids) plus `attachments/`, zipped with `fflate`. Readable, portable between instances,
  and without secrets (webhooks and keys are left out).
- Import adds; restore replaces boards, teams and roles inside the import's transaction. People
  are matched with current members only: an import never creates accounts, which would let a
  file grant access. Both take a safety backup first and stop if it fails.
- Instance backups dump every table found in the catalog as JSON and restore them in
  foreign-key order, breaking the one nullable cycle; only into the same set of migrations.
- Destinations: a directory (its own docker volume) or S3 via a ~100-line SigV4 client over the
  webhooks' SSRF-guarded HTTP, tested against the AWS documentation's signature. Files are
  encrypted (AES-256-GCM, `ORGTABLE_SECRET_KEY`) by default.
- Scheduling: an hourly cron call; each scope at its own hour in its own time zone, claimed
  before running; retention only prunes scheduled backups.

**Alternatives considered.**
- pg_dump from the app: needs the binary in the image and gives a whole-database file an
  organization must never get.
- The AWS SDK: megabytes of dependency for put/get/delete.
- Streaming zips: simpler buffers are enough at the sizes orgtable targets; revisit if
  organizations with gigabytes of attachments appear.

**Consequences.** Large imports need the reverse proxy to accept the body
(`ORGTABLE_IMPORT_MAX_MB`, nginx `client_max_body_size`). Restoring an instance signs everyone
out. A future schema change must keep `insertionPlan` able to order the tables (any new cycle
needs a nullable column).

---

## 2026-10-15 — Webhooks: a delivery table, signed bodies and an SSRF guard in the lookup

**Context.** The owner asked for webhooks "per organization and per board", ready-made Slack,
Discord and Teams integrations, and incoming webhooks. orgtable has no job queue (ADR 0004)
and must not become a way to call the operator's own network.

**Decision.**
- `WebhookDelivery` is the queue: one row per event and webhook with the body already
  rendered, claimed with `FOR UPDATE SKIP LOCKED` and a lease. Sent at once in the background;
  retries (1 min … 6 h, six attempts) by `POST /api/cron/webhooks`, like the other cron jobs.
  Fifteen final failures in a row switch the webhook off.
- Signature `t=<ts>,v1=<HMAC-SHA256("<ts>.<body>")>`, Stripe-style, with a second `v1` during
  a 24 h rotation window. Secrets encrypted with `ORGTABLE_SECRET_KEY`.
- Scope: organization-wide webhooks only carry boards shared with the whole organization;
  private boards need a board webhook made by someone who can open the board.
- Slack, Discord and Teams are webhooks with a format, not OAuth apps: one sentence in the
  creator's language, escaped per chat (Discord `allowed_mentions`, Slack `&lt;`).
- SSRF: https only, and every address checked inside the socket's `lookup` (catches DNS
  rebinding), plus IP literals before connecting; tests found that Node skips `lookup` for
  literals. `ORGTABLE_ALLOW_PRIVATE_TARGETS=1` for targets on the operator's network.
- Incoming: a hashed secret token per list, acting on behalf of its creator, rate limited.

**Alternatives considered.**
- A queue (Redis, pg-boss): more infrastructure for a few events a minute; the table also gives
  the delivery log for free.
- Slack/Discord OAuth apps: need registering an app per instance; incoming webhook URLs work
  for everyone today.
- Validating the URL only when saved: DNS can change after.

**Consequences.** Without the webhooks cron job, failed deliveries are only retried when
another event is sent. Every new board mutation should call the emit helpers.

---

## 2026-10-15 — An organization's security policy is enforced in access.ts

**Context.** The approved Security page: mandatory two-step verification with an adoption bar,
allowed invite domains, and the open sessions of the team.

**Decision.**
- `Workspace.requireTwoFactor` is checked where access is decided: `accessibleBoardsWhere`
  gets one more condition (the organization does not require it, or the user has it, reached
  through any of their membership rows) and `effectiveBoardRole` returns null. Lists, pages,
  API, search, real time and attachments follow without changes.
- Turning it on requires the actor to have 2FA, so nobody locks themselves out.
- `Workspace.allowedEmailDomains`, exact matches, applied to new employee accounts and to
  board invitations on the organization's boards.
- Sessions and 2FA reset only for accounts the organization created, the same boundary as
  password resets: the devices of people who signed up on their own are not the employer's
  to see.
- Only base owners and admins: security is not one of the 13 permissions.

**Alternatives considered.**
- Showing every member's sessions: the design hinted at it, but an organization does not
  own the accounts people registered themselves.
- Blocking at sign-in: a person may belong to several organizations with different rules.
  Closing the boards is precise and reversible.
- Password policies (length, breached-password check) and maximum session length are left
  for later; they apply to accounts, which can belong to several organizations.

**Consequences.** Guests of a 2FA organization need 2FA too.

---

## 2026-10-15 — Two-step verification with TOTP, and an encryption key for secrets

**Context.** The design's Security page lets an organization require two-step verification,
so accounts need it first. Webhooks and S3 backups, coming next, also store secrets the app
must read back. The owner chose AES-256-GCM with `ORGTABLE_SECRET_KEY` from `.env`.

**Decision.**
- `app/lib/crypto/secrets.ts`: AES-256-GCM, key derived with HKDF from
  `ORGTABLE_SECRET_KEY` (≥ 32 characters), a context string as additional data so a
  ciphertext only opens in its own row, versioned format. Features that need it are off
  (and say so) without the key; `install.sh` generates it for new and existing installs.
- TOTP implemented over `node:crypto` (`app/lib/totp.ts`, checked against the RFC 4226 and
  6238 vectors): SHA-1, 6 digits, 30 s, ±1 step. `qrcode` draws the QR on the server.
- The secret waits encrypted until the first code confirms it. Ten recovery codes, stored
  as SHA-256, each removed atomically when used. `totpLastStep` refuses replays.
- Sign-in: the password step sets a 10-minute signed `pending_2fa` cookie (purpose and a
  password-hash fingerprint inside), never a session. Five wrong codes send the person back
  to the password.
- Turning it off needs password and code; the instance admin can reset it.

**Alternatives considered.**
- WebAuthn/passkeys: stronger, but needs HTTPS and a much larger flow; TOTP covers what the
  design asks and works with every phone. Passkeys can come later.
- An `otplib`-style dependency: the algorithm is a dozen lines and test vectors exist.
- Storing secrets hashed: they must be read back (to compute the codes, to sign webhooks).
- Key in the database: a dump would then hold both lock and key.

**Consequences.** Losing `ORGTABLE_SECRET_KEY` makes every encrypted secret unreadable (2FA
must be set up again, webhooks re-created). It belongs with the backups and must never change.

---

## 2026-10-15 — The organization's activity log is the instance log, filtered

**Context.** The design has an activity log per organization. The instance already had one
(`AuditLog`, `/admin/audit`), but events did not say which organization they belonged to.

**Decision.**
- `AuditLog.workspaceId`, a soft reference (no FK) with an index on
  `(workspaceId, createdAt)`. `recordAudit` derives it from the target (workspace, or a
  board's workspace) or takes it explicitly. A migration backfilled older events.
- One log, two views: the instance admin keeps seeing everything; an organization sees its
  rows with `audit.view`. No second table to keep in sync.
- Categories come from the action's name, with an SQL prefix list for filtering and a unit
  test that checks both agree.
- Details show names only for ids of the same organization, and the CSV export neutralises
  formula cells.

**Alternatives considered.**
- A separate per-organization event table: duplicates writes and retention.
- A foreign key with `SET NULL`: deleting an organization would erase which organization the
  instance's own "deleted" event was about.

**Consequences.** New organization events should use `targetType: "workspace"` or `"board"`,
or pass `workspaceId`, and follow the `workspace.<area>_<verb>` naming so they fall into the
right category.

---

## 2026-10-15 — Teams grant board roles, decided in access.ts

**Context.** The approved design has teams (Design, Development, Sales) with members and board
access as Reader, Editor or Manager. Without them, sharing six private boards with five people
is thirty invitations, and nothing stays in sync when someone joins.

**Decision.**
- `Team`, `TeamMember` and `TeamBoard` with a `role` per board. A team grant is one more path in
  `access.ts` (`accessibleBoardsWhere`, `effectiveBoardRole`); the highest path wins. The board
  lists and the board's people panel compute the same way.
- Every foreign key carries `workspaceId`: `TeamMember → WorkspaceMember(workspaceId, userId)`
  (cascade, so leaving the organization leaves its teams), `TeamBoard → Board(workspaceId, id)`
  (a new unique index on Board) and both → `Team(workspaceId, id)`.
- Managing teams is the `people.teams` permission. A team never gives more than the person
  configuring it has: only boards they can open, with a role up to their own effective role.

**Alternatives considered.**
- Teams that add people as explicit `BoardMember` rows: access would not end when someone
  leaves the team, and the rows would drift from the team.
- Teams across organizations: they belong to one organization like everything else.

**Consequences.** Removing someone from a team or deleting a team takes the access away
immediately. `access.ts` grows one OR; the queries that compute a role from rows
(`getBoardSummariesForUser`, `getBoardPeople`) include the teams too.

---

## 2026-10-15 — Custom roles as permission sets on top of three locked base roles

**Context.** The owner asked for "a place to edit roles". The three workspace roles (Owner,
Admin, Member) were hard-coded: a company could not, for instance, let accounting read the
activity log without making them admins of everything.

**Decision.**
- Thirteen named permissions in four groups (`app/lib/permissions.ts`), the ones of the
  approved design. Owner and Admin hold all of them; Member holds `boards.create`.
- Base roles stay, locked: they carry the escalation rules that already work (who appoints
  admins, the last owner) and the things no permission covers (renaming or deleting the
  organization).
- A custom role is a full permission set that **replaces** the member defaults, so it can
  also restrict ("read-only staff"). It is only allowed on top of MEMBER, which the database
  enforces with a `CHECK`.
- `people.roles` exists in the catalogue but is base-only. A custom role that could assign
  roles could assign itself Admin; keeping role changes with owners and admins removes the
  whole class of escalation bugs. Stored permissions are filtered by what the editor holds
  and sanitized again on every read.
- The member→role foreign key is composite, `(workspaceId, customRoleId)`, so a role of
  another organization cannot be attached even by a buggy service. It is `NO ACTION`, not
  `RESTRICT`, so deleting an organization cascades through members and roles in one
  statement. Deleting a role clears it from its members first, in the same transaction.
- `boards.view_all` grants VIEWER on private boards inside `access.ts`, the single place
  that decides access. `boards.visibility` and `boards.delete` are checked in their actions
  on top of "can open the board". `boards.create` gates the board form, the import and
  `POST /api/v1/boards`.

**Alternatives considered.**
- Editable base roles: changing what "Admin" means silently would change every existing
  member's power at once, and the escalation rules depend on the base hierarchy.
- Custom roles that add to Member instead of replacing it: simpler, but no way to make a
  read-only role.
- Per-permission rows (a join table): more joins on every access check for no gain; a
  `text[]` column with `has` filters works in both Prisma and SQL.

**Consequences.** New features add their permission to the catalogue (and its label in
`locales/*/workspaces.json`). Every place that turns a membership into board access goes
through `boardRoleFromMembership`. The roles pages are in
`app/(app)/[workspace]/settings/roles/`.

---

## 2026-10-15 — Settings as pages, and one door per organization

**Context.** The owner's verdict on the settings: choosing a section "sends me down the
screen when it should load a different section". `/settings` was one long page whose menu
jumped to `#fragments`, and an organization's settings mixed the members list with the form
to create an employee at the bottom. The coming features (custom roles, teams, webhooks,
backups, security, keys) need a place each, and orgtable is multi-tenant: every one of them
must stay inside its organization.

**Decision.**
- Every section is a page with its own address. One's own settings:
  `/settings/{profile,security,tokens,appearance,workspaces,data}`; `/settings` opens the
  profile, or the page an old `/settings#<fragment>` link meant (the fragment never reaches
  the server, so a small client component maps it; `app/lib/settings-paths.ts`).
- An organization's settings get an index (`/<slug>/settings`), `members`, `members/new` and
  `general`. Menu and index come from ONE list (`app/components/settings/org-nav.tsx`), so a
  section cannot be in one and missing from the other. On a phone the index is the way in
  and other pages show a single "back" link, as designed.
- Tenant isolation keeps the current model (one database, `/<slug>/…`), made strict:
  `requireOrgSettings(slug)` is the only door of the organization's settings. It resolves
  the slug together with the person's membership and answers the same 404 for "does not
  exist", "not yours" and "personal workspace". Services keep re-checking membership and
  look rows up by `{ id, workspaceId }`.
- The design was approved first in a Claude Design canvas ("orgtable — Panel de empresa").

**Alternatives considered.**
- Keeping the single page and making the menu filter it with JavaScript: the address would
  still not say where you are, and the back button would not work.
- A database or schema per tenant: far more operations work (migrations ×N, backups, the
  instance admin's view) for a self-hosted app whose tenants are small; strict checks at the
  three doors give the isolation without it.
- Redirecting `/settings` on the server: the fragment is not sent, so `/settings#data` would
  always land on the profile.

**Consequences.** New settings sections are a page plus one entry in `org-nav.tsx`. Links to
`/settings#…` in old emails or bookmarks keep working.
`test/integration/tenant-isolation.int.test.ts` is where cross-tenant cases go as features
land.

---

## 2026-10-14 — A public landing page at `/`, retro, off for private instances

**Context.** orgtable could not be presented to anyone: `/` sent every visitor to the
sign-in screen. The official instance wants to explain what the project is, offer a free
account and show how to install your own copy.

**Decision.**
- `/` shows a landing page to visitors without a session. Whether it shows is
  `ORGTABLE_LANDING`: `auto` (default) only while sign-up is open, `on`, `off`. A
  self-hosted private instance (sign-up closed, the default) behaves exactly as before.
- The "free account" offer is tied to the same switch as `/register`: with sign-up
  closed the page never promises it, even with `on`.
- The install command comes from `ORGTABLE_INSTALL_URL` (default: the original
  `install.sh`). Only `https`, and only characters a shell does not interpret, because
  visitors paste it into bash.
- `proxy.ts` makes exactly `/` public (not a prefix), and `robots.txt` allows `/$` when
  sign-up is open.
- Retro look over the existing palette (DESIGN.md, "Landing"), with two more OFL fonts
  (Silkscreen, VT323) loaded only by the landing. The design was laid out first in a
  Claude Design canvas.

**Alternatives considered.**
- An instance setting in *Admin › Instance* instead of an environment variable: needs a
  migration and a form for something an operator sets once; it can come later.
- Always showing the landing: a private instance would advertise a free sign-up it does
  not offer.
- A separate static site: two deployments, and the "free account" button could not know
  whether sign-up is open.

**Consequences.** Two new optional variables (compose, `.env.example`, CI check). The
copy button is the only client code of the page. The install command works only while
the repository is public.

---

## 2026-10-14 — English routes, anchors and parameters; repository fully in English

**Context.** Translating the interface left some Spanish behind in places users see:

- the legal routes `/legal/privacidad`, `/legal/condiciones` and `/legal/aviso-legal`;
- the settings anchors `#perfil`, `#seguridad`, `#apariencia`, `#datos` and `#acerca`;
- the `/login?cuenta=borrada` parameter after an account is deleted.

The `locale` cookie was also written in two places with different flags: the language
picker set `secure` on HTTPS, sign-in did not.

**Decision.**
- Use English paths and anchors in every language:
  - `/legal/privacy`, `/legal/terms`, `/legal/cookies` and `/legal/notice`;
  - `#profile`, `#security`, `#api`, `#appearance`, `#data` and `#about`;
  - `/login?account=deleted`.

  URLs are identifiers, not interface text. These routes had never been released, so
  no redirects are needed.
- One helper, `setLocaleCookie()` in `app/i18n/cookie.ts`, writes the cookie for both
  callers: one year, `SameSite=Lax`, and `Secure` when the request came over HTTPS, like
  the session cookie.
- "Created by" in Settings › About uses the same message as the public footer, so the
  attribution reads the same in both places. LICENSE 7(b) allows translating these two
  words.
- The rest of the repository was translated as well:
  - code comments and tests, with English expectations in tests by default and new tests
    for each language;
  - scripts and their operator messages, configuration and CI comments;
  - the demo data used for the README media;
  - documentation, this log and the ADRs.

  The README is English, with a Spanish `README.es.md`, and the roadmap no longer uses
  internal milestone numbering.

**Alternatives considered.**
- **Localized URLs** (`/legal/privacidad` for Spanish, `/legal/privacy` for English).
  Same pages under two names, links that change with the language, and nothing gained,
  because the language does not come from the URL.
- **Keeping the old routes with redirects.** Nothing was ever published under them.

**Consequences.**
- The README screenshots and GIFs were retaken in English (`scripts/readme-media/`).
- Notifications stored before this change keep their Spanish text.
- Integration tests now cover the request language, the cookie, the account preference
  and per-recipient notifications (`test/integration/locale.int.test.ts` and others).

---

## 2026-10-14 — Bilingual interface (English and Spanish), easy to translate

**Context.** The owner is preparing the public release. A Spanish-only interface, with
internal milestone wording, is not professional for a public project. The app has to
support several languages, and anyone should be able to contribute a translation without
knowing the code.

**Decision.**
- **Messages in JSON, one folder per language** (`locales/<code>/<area>.json`), which
  translators and tools such as Weblate or Crowdin already know.
  - English (`en`) is the reference and the fallback: a missing message shows in English,
    so a partial translation never breaks the app.
  - Adding a language means copying `en/`, translating it and adding one line to
    `locales/index.ts`. The guide is in `locales/README.md`.
- **Values are plain data.** Strings carry `{placeholders}`, plurals are objects
  (`{ one, other, … }`, chosen with `Intl.PluralRules`), and markup uses simple tags
  (`<link>…</link>`) rendered by `rich()`. With no functions inside, the dictionary of the
  current language travels from the root layout to Client Components as props
  (`I18nProvider`), and the client bundle never imports the dictionaries.
- **Language of a request**: the `locale` cookie set by the picker, else
  `Accept-Language`, else English. `User.locale` (migration `..._user_locale`) stores the
  account's choice: it restores the cookie on sign-in and decides the language of the
  notifications written for that person.
- **zod schemas carry message keys** (`"errors.validation.titleRequired"`), resolved with
  `issueMessage(m, issue)`, so they stay language-independent.
- **The public REST API answers in English only.** It is for programs.
- **CI check** (`test/i18n.test.ts`). Every registered language must have the same keys
  as English, the same placeholders and tags, and the plural forms its grammar needs.
- **Language picker** with one submit button per language, which works without
  JavaScript. It sits in the footer of the public pages and in Settings › Appearance.
- **No dependency.** About 150 lines of our own code.

**Alternatives considered.**
- **next-intl.** Mature (ICU, middleware), but it is a dependency for what native `Intl`
  plus a few helpers already cover. Its locale-prefixed routes (`/en/...`) would also break
  every existing link and the deep-links of notifications.
- **Messages as TypeScript objects.** Type-safe for developers, but harder for
  translators, and invisible to translation tools.
- **Language in the URL.** Better for SEO, but almost everything is behind sign-in. The
  few public pages work with the cookie and Accept-Language.

**Consequences.**
- Every visible text in the app moves to `locales/`. The work is split by area: auth and
  legal; shell, settings and admin; boards; server messages and notifications.
- Notifications already stored stay in the language they were written in.
- Following the owner's decision, everything in this repository is in English from now on:
  code comments, tests, documentation and commits. This deliberately departs from the
  owner's global rule of Spanish documentation, for this repository only.

---

## 2026-10-14 — Next 16.3.8 and patched sharp and source-map-js

**Context.** Running the CI locally before pushing, `pnpm audit --prod --audit-level high`
failed on three new advisories published after the last review:

- GHSA-cjq9-62q9-8jv4: SSRF in Next's image optimization (`next` < 16.3.8);
- GHSA-wq5f-xc86-pv6w: `sharp` < 0.35.5, through `next`;
- GHSA-68fv-2mgg-jv7q: `source-map-js` < 1.2.2, through `postcss`.

The same step would also fail on `main`.

**Decision.**
- Bump `next` and `eslint-config-next` to 16.3.8. These are patch releases.
- Add two `overrides` in `pnpm-workspace.yaml`: `sharp@<0.35.5` and
  `source-map-js@<1.2.2`. Even with next 16.3.8, the lockfile kept the old transitive
  versions although the ranges allow the patched ones.

**Alternatives considered.**
- **next 16.4.x.** A minor release with more changes than a security fix needs. It goes in
  its own commit after reading its changelog.
- **Ignoring the advisories.** The Next.js one affects any deployment that serves images.

**Consequences.** `pnpm audit --prod --audit-level high` passes again; only the
previously documented ignored advisory remains. Remove the two overrides once next ships
the patched versions itself.

---

## 2026-10-14 — Own icon, instance-aware robots.txt and Open Graph

**Context.** The favicon was the default triangle from the Next template, and `public/`
held the template's SVGs (Next and Vercel logos), unused. A public repo should not carry
other companies' brands. There was no `robots.txt` either: a private instance could end
up indexed starting from its login page.

**Decision.**
- `app/icon.svg` with the brand's "o" on terracotta. `app/favicon.ico` and the template
  SVGs are deleted.
- Dynamic `app/robots.ts`. With registration closed it asks for `Disallow: /`. With
  registration open it allows only `/login`, `/register` and `/legal/`. `/robots.txt` is
  public in `proxy.ts`.
- Basic Open Graph metadata in the root layout: name, description and language.

**Alternatives considered.**
- **Static `robots.txt`.** It would have to serve a private instance and a public one
  equally.
- **Sitemap.** It needs the instance's absolute public URL, which the app does not know.
  One more variable (`ORGTABLE_PUBLIC_URL`) for three public pages is not worth it for now.
- **Open Graph image.** Left for when the official instance and its domain exist.

**Consequences.** Test of `robots()` in `registration.int.test.ts`.

---

## 2026-10-14 — Visual README with real screenshots and GIF

**Context.** To publish the project, the README had to show the app, like vibe-gambling's
does: main GIF, gallery, features, privacy and credits. Without losing the fixed structure
(what it is, requirements, installation, commands, variables and deployment).

**Decision.**
- **Screenshots and GIF of the real app**, recorded with Playwright (headless Brave) on a
  production build and a separate database (`orgtable_demo`) with sample data: fictional
  people with `@example.com` emails, which is a reserved domain. The GIFs are assembled
  with Pillow using a shared palette and no dithering: 0.5 MB for the main one and 0.1 MB
  for the realtime one.
- Screenshots in **WebP** at 1600 px (30–55 KB each) in `docs/screenshots/`.
- `README.md` in Spanish, like the rest of the documentation, and a shorter `README.en.md`
  for people arriving from outside.
- The link to the official public instance stays as a `TODO` in the README: its URL does
  not exist yet.

**Alternatives considered.**
- **Mockups instead of screenshots.** They go stale and do not prove the app works.
- **MP4 video in the README.** GitHub only plays it if it is uploaded as an issue
  attachment, not from the repo.
- **Recording on the development DB.** It would mix real test data with the demo.

**Consequences.** If the interface changes a lot, the screenshots have to be regenerated
with the scripts in `scripts/readme-media/`: demo seeding, Playwright, and GIF and WebP
assembly. Their instructions are in their README. `playwright-core` is installed
separately so it is not added to the project's dependencies.

---

## 2026-10-14 — Account menu in the navbar and boards with context

**Context.** The top bar piled up, loose, the Administration link, the settings gear, the
email and "Sign out" ("Salir"). On mobile they did not fit and the instance name got cut
off. On the index, board cards only showed the title, and importing from JSON competed in
prominence with "Create board".

**Decision.**
- The bar keeps search, notifications, theme and a **button with the initials** that
  opens a menu with name and email, links to profile, password and sessions, privacy and
  data, administration (admins only) and "Sign out" ("Cerrar sesión"). It uses the
  browser's `popover` API: no custom JavaScript, closing on outside click or Escape. It is
  anchored with anchor positioning, and where that is not supported it falls back to the
  top right.
- The cards on `/boards` show the number of cards and, if the board is shared, the
  initials of up to 4 members. The names are included as hidden text for screen readers.
  It uses a new query, `getBoardSummariesForUser`, so as not to change what
  `GET /api/v1/boards` returns.
- Import moves into a collapsed `<details>`.

**Alternatives considered.**
- **Menu as a client component with its own focus management.** More code for what the
  native popover already solves.
- **Keeping the email visible in the bar.** It takes space on every screen and is
  already in the menu.

**Consequences.** `app/lib/initials.ts` with its test. Checked at 375 and 1280 px.

---

## 2026-10-14 — Redesigned settings and accounts in each person's hands

**Context.** With registration open, every person has to be able to manage their account
without asking the admin. `/settings` only had API tokens: you could not change your name,
email or password, see your sessions, or exercise your GDPR rights.

**Decision.** `/settings` gets a side navigation (a scrollable row on mobile), designed
first on a design canvas, with these sections:

- **Profile.** Changing the email requires the current password, so that a stolen session
  cannot hijack the account.
- **Password and sessions.** Changing the password signs out the other sessions and keeps
  the current one. Tokens are kept: the person creates them themselves. Open sessions are
  listed with a readable browser name (`app/lib/user-agent.ts`) and can be closed one by
  one or all at once.
- **API tokens** (unchanged) and **Appearance**: light, dark or system, with the same
  `localStorage` key as the anti-flicker script.
- **Privacy and data.**
  - JSON export (`/api/account/export`, browser session only) with everything the person
    owns and everything they wrote on other people's boards, without hashes.
  - Account deletion with password: it deletes the person's own boards along with their
    attachment files, the rest goes by cascade, and the audit `detail` that named the
    person is emptied.
  - The last ADMIN account cannot be deleted. The check locks the admin rows with
    `FOR UPDATE`, with a concurrency test.
- **About**: version, source code, license and the license attribution.

The logic lives in `services/account.ts`, without request context, like the rest of the
services.

**Alternatives considered.**
- **Transferring shared boards instead of deleting them.** It is kinder to the team, but
  requires choosing to whom, and the app has no ownership transfer. For now the warning
  says how many boards are deleted. Left as an improvement.
- **Also exporting through the API with a token.** A leaked token would pull the full
  account dump. Export stays limited to the browser session.

**Consequences.** Tests in `test/integration/account.int.test.ts`: profile, password,
sessions, export, deletion with attachments, last admin and two admins at once. Other
people's notifications may keep the deleted person's name until they expire (180 days).
The privacy policy says so.

---

## 2026-10-14 — Open registration, legal pages and data cleanup (GDPR)

**Context.** The owner is going to host a public instance with free registration and wants
anyone to be able to run their own. Until now only the admin created accounts, and there
was no privacy policy, terms or retention periods.

**Decision.**
- **Optional registration per instance.** `InstanceConfig.registrationOpen`, closed by
  default. It is opened in `/admin/instance` and only if the controller and the contact
  email are set, which art. 13 GDPR requires. `isRegistrationOpen()` checks it again on
  every sign-up. New accounts are MEMBER.
- **Consent.** Mandatory checkbox, unchecked by default, with links to the policy and the
  terms. `User.termsAcceptedAt` is stored. Next to the form there is a first information
  layer: controller, purpose and rights.
- **Anti-abuse without external services.**
  - Trap field (honeypot).
  - 5 sign-ups per hour per IP, if there is a trusted proxy.
  - 30 per hour across the whole instance, counted after validation so that a typo does
    not use up quota.
  - A concurrent sign-up with the same email (P2002) responds like a normal duplicate,
    not with a 500.
- **Operator legal details** (`InstanceConfig.operator*`, hosting, backup days) editable
  by the admin. The pages `/legal/{privacidad,condiciones,cookies,aviso-legal}` describe
  what this code does, with the periods taken from the same constants as the cleanup.
  Anything missing is shown as "not specified", never made up. That way they work for the
  official instance and for any self-hosted instance.
- **Cleanup** via `POST /api/cron/maintenance` (same `CRON_SECRET` as the reminders,
  shared authorization in `app/lib/api/cron.ts`):
  - audit log after `ORGTABLE_AUDIT_RETENTION_DAYS` days (90 by default);
  - closed or expired sessions after 30 days;
  - notifications after 180 days.
- **Public footer** with legal links, source code (`ORGTABLE_SOURCE_URL`, validated) and
  the license attribution, on login, registration, setup and legal pages.
- **Minimum age of 14** in the terms: it is the age of digital consent in Spain (art. 7
  LOPDGDD).

**Alternatives considered.**
- **Email verification.** It needs SMTP, which is still in the backlog. Without it,
  registration reveals whether an email already has an account. The sign-up limit slows
  down mass enumeration.
- **External CAPTCHA (Turnstile, hCaptcha).** It adds a third party that sees every
  visitor and forces expanding the policy and the CSP. It stays as an option if real spam
  shows up.
- **Fixed legal texts in Markdown.** They would be false as soon as someone else hosted
  their instance or changed a period.
- **Cookie banner.** There is only strictly necessary technical storage (art. 22.2 LSSI).
  A banner is unnecessary as long as there is no analytics.

**Consequences.**
- Migration `20261014171630_registration_and_legal`, new columns only.
- For the cleanup to run, the maintenance cron has to be scheduled, like the reminders
  one (`docs/operations.md`).
- Tests in `test/integration/registration.int.test.ts` and `maintenance.int.test.ts`.
- The legal texts were drafted by Claude, not a lawyer: a professional should review them
  before opening the public instance.
- The official instance's operator details are filled in by the owner in
  `/admin/instance`. They are not in the repo.

---

## 2026-10-14 — OFL fonts instead of the Fontshare ones

**Context.** The interface used Satoshi and Cabinet Grotesk, from Fontshare, with the
`.woff2` files inside the repo (`app/fonts`). Their license, the ITF Free Font License 2.0
(read from the `FFL.txt` included in the official download), forbids distributing the
files "through another [...] repository [...] publicly accessible servers" and giving them
to third parties. Publishing the repo under the AGPL, and having others run their own
instance, is exactly that.

**Decision.** They are replaced by **Bricolage Grotesque** (headings) and **Figtree**
(interface), both under the SIL OFL 1.1, loaded with `next/font/google` as was already done
with Geist Mono. Next downloads them at build time and serves them from the app itself: at
runtime there are no requests to Google and the CSP does not change. `app/fonts` is
deleted. I chose them for their closeness to the previous character: a display grotesque
with editorial personality and a warm geometric sans for body text. They were tried out
first on the design canvas.

**Alternatives considered.**
- **Keeping Fontshare, loading the fonts from its API.** The license also forbids making
  them available to third parties from a service, and it would add an external CDN to an
  app meant to be hosted without dependencies.
- **Copying the OFL `.woff2` files into the repo.** It works just as well, but
  `next/font/google` was already in use and avoids maintaining binary files.

**Consequences.**
- The Docker build needs internet access to download the fonts. It already needed it for
  Geist Mono, so nothing changes.
- Earlier commits still contain the Fontshare `.woff2` files. If the repository is made
  public with its full history, those files remain accessible. Removing them requires
  rewriting history (`git filter-repo`) and force-pushing. That is destructive and is the
  owner's call.

---

## 2026-10-14 — AGPL-3.0-or-later license with attribution

**Context.** The owner wants to publish orgtable as open source: anyone can use, modify
and host it, as long as they keep it open and give credit. Until now the proprietary
license of MARA-KASSA SL (ADR 0016) applied. The repository was transferred the same day
to the personal account `Aimarmndz`.

**Decision.** `LICENSE` becomes the official GNU AGPL-3.0 text (downloaded from gnu.org,
unchanged) followed by additional terms under section 7(b), the same ones used by
vibe-gambling, another project by the author:

- Copyright holder: "Aimar (https://github.com/Aimarmndz)", with the "or any later
  version" option.
- Anyone who distributes the app or offers a modified version over a network must keep
  "Created by Aimar (github.com/Aimarmndz)" in the footer of the public pages (login,
  registration, legal pages) and in "About" in the settings.
- `package.json` declares `AGPL-3.0-or-later`. The CI step that prevented mentioning the
  AGPL now checks the opposite: that `LICENSE` and `package.json` match, that the
  attribution term is still there and that no remnants of the proprietary license are left.
- Contributions are *inbound = outbound* with DCO (`git commit -s`), without assignment of
  rights. The assignment clause goes away, which was of doubtful validity anyway.

**Alternatives considered.**
- **MIT or Apache-2.0.** They give credit, but do not require keeping the code open: a
  third party could offer orgtable as closed SaaS. That is what the owner wants to avoid.
- **GPL-3.0.** It does not cover network use: hosting a modified version without
  distributing it would not require publishing the code. The AGPL (section 13) does.
- **AGPL without 7(b) terms.** The copyright notice is already kept in the code, but
  nothing would require the credit to be visible in the interface of someone else's
  instance.

**Consequences.**
- The AGPL requires every instance to offer its source code to its network users. The app
  links to the code from the footer and from the settings; whoever modifies the app must
  point that link to their own code (`ORGTABLE_SOURCE_URL` variable).
- Copies distributed while the proprietary license applied do not change license. From
  now on the AGPL applies to all history that is published.
- Ownership: the previous license was in the name of MARA-KASSA SL and the new one in the
  name of Aimar, as the owner asked ("giving me credit"). If the rights belong to the
  company, the assignment to Aimar should be put in writing, or the company should be
  listed as the holder alongside the attribution. That is the owner's call.

---

## 2026-09-24 — Moving a card left/right with the keyboard arrows

**Context.** While testing the final build in the browser, a card picked up with Space did
not move with the left arrow. `sortableKeyboardCoordinates` filters the "to the left"
targets by comparing against the card's edge, and the edge of its own column is 8 px
earlier: the card's own column came out as the closest target and the card went back to
its place. Moving right worked because the card's own column is never to the right.

**Decision.** `boardKeyboardCoordinates` also resolves left/right for cards: it takes as
reference the edge of the column containing the card's center, jumps to the neighboring
column and, within it, to the vertically closest card, or to the column if it is empty.
Up/down still use `@dnd-kit/sortable`.

**Alternatives considered.** Wrapping `droppableContainers` to remove the card's own
column before calling `sortableKeyboardCoordinates`: it depends on the internal shape of
`DroppableContainersMap` and would still pick targets by corners instead of by column.

**Consequences.** Tests with synthetic rectangles in `test/board-collision.test.ts` (they
fail with the previous code). Verified with Playwright: the card moves to an empty column
on the left and back to the right, and the change is persisted in the database.

---

## 2026-09-24 — Restoring attachments without deleting before checking the archive

**Context.** The procedure in `docs/operations.md` for restoring attachments was
`rm -rf /data/uploads/* && tar xzf - -C /data`: it deleted all attachments before reading
the archive, without checking it and without a prior backup, exactly what
`scripts/restore.sh` avoids for the database. With a truncated `.tar.gz`, the current
attachments were lost and only whatever `tar` managed to extract remained. Also, `/*` does
not include hidden files.

**Decision.** Only the documentation changes, with three steps: `gzip -t` and `tar tzf`
on the archive on the host, `scripts/backup.sh` as a prior backup, and extraction to
`/data/uploads/.restore` inside the volume itself. The current attachments are only
replaced if `tar` finishes successfully (`set -e`), and `find` is used so hidden files are
included. The temporary directory lives inside the volume because `/data/uploads` is the
mount point and cannot be deleted or renamed.

**Alternatives considered.**
- An option in `scripts/restore.sh` or a `scripts/restore-uploads.sh` with confirmation,
  prior backup and stopping/starting the app with `trap`. It is the most consistent with
  the database, but it touches the operations scripts and their tests, which are outside
  this batch. Left as an improvement.
- Keeping the command with just a warning in front of it: it still deleted before
  checking.
- Extracting outside the volume (e.g. `/tmp`) and copying afterwards: the copy can fail
  halfway with the attachments already deleted, whereas inside the same volume `mv` is a
  rename.

**Consequences.** Tested against the app image, on a temporary volume: with a truncated
archive `tar` fails, the previous attachments (hidden ones included) stay intact and only
`.restore` is left, which the next attempt deletes; with a good archive they are all
replaced. The procedure is still manual: nothing forces steps 1 and 2.
## 2026-09-24 — Space on a calendar chip does not open the card

**Context.** The calendar chip is a `<button>` with an `onClick` that opens the card, plus
dnd-kit's `KeyboardSensor`, which picks up and drops with Space. dnd-kit only cancels the
keydown, but a native button activates on the Space keyup (Firefox does so even when the
keydown was cancelled): picking up or dropping the chip could also open the modal. The
board card does not suffer from this because it is a `div role="button"` that handles the
keyboard by hand.

**Decision.** If the chip is draggable (`canEdit`), its `onKeyUp` cancels Space
(`preventSpaceActivation` in `app/components/board/calendar-view.tsx`). Without edit
permission it is left alone: Space still opens the card. Enter does not change: the button
activates on keydown, which dnd-kit already cancels on drop.

**Alternatives considered.** Turning the chip into a `div role="button"` with the same
keyboard logic as `CardItem`: it is more consistent with the board, but it is a bigger
change (focus, activation and attributes by hand) for the same effect.

**Consequences.** Unit test in `test/calendar-view.test.ts` (Space is cancelled, Enter and
the arrows are not). The Firefox behavior is only checked by hand.

---

## 2026-09-24 — Calendar drag overlay in a portal to `document.body`

**Context.** The calendar's `DragOverlay` was rendered inside the panel, which has
`backdrop-blur-sm`. `backdrop-filter` makes that panel the containing block of its
`position: fixed` descendants, and dnd-kit positions the overlay with `fixed` and viewport
coordinates. The overlay came out offset (by the height of the app and board headers), the
drop animation returned to the wrong point and `overflow-y-auto` clipped it.

**Decision.** In `app/components/board/calendar-view.tsx`, the `DragOverlay` is rendered
with `createPortal(…, document.body)`. It is mounted only in the browser
(`useSyncExternalStore` with a server snapshot of `false`, the same pattern as `CardItem`)
and always, not only while a card is active, so that the drop animation finishes. The
portal keeps the React context, so it stays inside the `DndContext`.

**Alternatives considered.**
- Removing `backdrop-blur-sm` from the panel: it changes the design (the user's decision),
  and any future `transform`, `filter` or `will-change` on an ancestor would break it
  again.
- Moving the `DragOverlay` out of the panel but inside the scroll container: it does not
  protect against other ancestors with those properties.

**Consequences.** The overlay follows the pointer without clipping. Test
`test/calendar-view.test.ts`: the server render does not touch `document` (it fails if the
portal is mounted without the guard). The actual positioning is only checked by hand in
the browser.
## 2026-09-24 — Error notice removed on submit in user, token and import forms

**Context.** `create-user-form.tsx`, `create-token-form.tsx` and `import-board-form.tsx`
left the `role="alert"` notice mounted between submissions. A second identical error
(creating a user with an existing email twice, importing the same invalid JSON twice) did
not change the DOM and the screen reader did not announce it.

**Decision.** The same pattern as `login-form.tsx` and the members panel:
`state.error && !pending`. In create user, the email's `aria-describedby` only points to
the notice while it is visible, so it does not reference a non-existent id during
submission.

**Alternatives considered.** Adding a counter or a key to the notice to force it to be
reinserted: more state for what `pending` already does.

**Consequences.** While submitting, the previous error is not shown (the button already
says "Creating…"/"Importing…"). `test/form-error-reannounce.test.ts` checks it in the HTML
of the three forms.

---

## 2026-09-24 — Members panel: invite role after an error, repeated error and backdrop

**Context.** Three bugs in the invite form and the members `<dialog>`
(`app/components/board/members-panel.tsx`):
- After an error ("no account exists…") the role silently reverted to Editor: React
  resets the form after the action, but does not apply the new `defaultValue` to an
  already mounted `<select>`. After correcting the email, the person joined with write
  access even if Viewer had been chosen.
- The `role="alert"` notice stayed mounted between submissions: a second error with the
  same text did not change the DOM and the screen reader did not announce it.
- The `::backdrop` fade was visible with reduced motion: the `prefers-reduced-motion` rule
  in `globals.css` does not cover `::backdrop`.

**Decision.**
- `<select name="role" key={inviteRole}>`: the key remounts the select with the returned
  role. `inviteRole` only reuses `values.role` if it is in `ASSIGNABLE_BOARD_ROLES`;
  otherwise (e.g. OWNER), it falls back to Editor. It is the same pattern as
  `create-token-form.tsx`.
- The notice is rendered with `state.error && !pending`, like `login-form.tsx` and
  `setup-form.tsx`: it is removed while submitting and an identical error is inserted
  again.
- `backdrop:motion-safe:animate-[overlay-in_150ms_ease-out]`, same as `card-modal.tsx`.

**Alternatives considered.**
- A controlled `<select>` with `useState`: it would have to be synced with `state.values`
  in an effect and reset after a successful invite; the key solves it without new state.
- Adding `*::backdrop` to the `prefers-reduced-motion` rule in `globals.css`: it touches a
  shared file when `motion-safe:` is enough.

**Consequences.** The key-based remount has no automated test: without jsdom,
`renderToStaticMarkup` already marked the correct role before the fix.
`test/members-panel.test.ts` covers the fallback to Editor with a non-assignable role, the
removal of the notice while submitting and the backdrop class.
## 2026-09-24 — Confirming a list deletion without announcing how many cards it has

**Context.** The "Yes" button of the delete-list confirmation
(`app/components/board/list-column.tsx`) announced "Yes, delete list X and its N cards"
using `list.cards.length`. With active filters, `BoardView` passes `ListColumn` only the
visible cards, so a list with 12 cards and one visible announced "and its 1 cards", and on
confirming all 12 were deleted by cascade.

**Decision.** The `aria-label` says "Yes, delete list X and all its cards", with no number.
The visible counter in the header still shows the filtered cards.

**Alternatives considered.** Passing `ListColumn` a `totalCards` prop from the unfiltered
lists in `board-view.tsx` and handling singular/plural agreement: it gives the exact
number, but forces touching `BoardView` and how it builds the filtered lists for a text
only the screen reader hears; "all" ("todas") already makes the scope of the deletion
clear.

**Consequences.** The screen reader does not say how many cards are deleted; anyone who
wants to know has the counter (without filters). Test in `test/list-column-delete.test.ts`.
## 2026-09-24 — Realtime: maximum time for the CLOSED stream check

**Context.** `keepEventSourceOpen` scheduled the retry when `probe()` finished, and
`probeStatus` did a `fetch` with no timeout (the browser's has none). If the check never
answered (a proxy holding the connection while the app starts up, or `verifySession`
waiting for a pool connection during the same DB failure that caused the 500), the source
was never recreated and realtime was lost until a reload. Unmounting did not abort the
in-flight check either.

**Decision.** `PROBE_TIMEOUT_MS` (10 s) in `app/lib/realtime/reconnect.ts`. `probe`
receives an `AbortSignal` and a timer races it (`Promise.race`): when it fires it aborts
the signal and the result is treated as "no status" (retry with backoff, no
`onAccessDenied`). Unmounting aborts the signal. `probeStatus(url, signal)` returns
`null` if the signal is aborted.

**Alternatives considered.**
- Only `AbortSignal.timeout` inside `probeStatus`: the retry would still depend on the
  injected `probe` honouring the signal.
- `AbortSignal.any` to chain signals: Safari lacks it until 17.4; they are chained with a
  listener instead.

**Consequences.** With a hung server, each retry takes up to 10 s longer than the
backoff. Tests in `test/realtime-reconnect.test.ts`: a `probe` that never resolves, abort
on unmount, and `probeStatus` with the signal aborted against a real HTTP server.

---

## 2026-09-24 — Realtime: a single refresh per tab for the board and the notification bell

**Context.** On `/board/[id]` the notification bell (layout) and `BoardRealtime` (page)
each have their own `EventSource` and debounce. `router.refresh()` repaints the whole
tree, layout included, and both streams drop and come back at the same time (15 min
maximum lifetime, restart, sleep): every reconnection caused two full renders of the
board. The consequence "one `router.refresh()` per reconnection" from the entry "Resync
the board and the bell when the EventSource reconnects" did not hold on
that page.

**Decision.** `scheduleRefresh` in `app/lib/realtime/reconnect.ts`: a module-level timer
(200 ms) shared by both components for events, reconnections and access denied, instead
of each one's local timer. It is not cancelled on unmount: that would cancel the refresh
requested by the other component, and a `router.refresh()` after unmounting only
refreshes the current route.

**Alternatives considered.** Have the bell skip the refresh when a `BoardRealtime` is
mounted: the layout does not know which page is below it, and outside the board the
refresh is needed.

**Consequences.** A single `router.refresh()` per reconnection and tab, also every 15 min.
The redirect after a revocation arrives about 200 ms later. Grouping test in
`test/realtime-reconnect.test.ts`.

---

## 2026-09-24 — Realtime: do not refresh blindly when the stream ends up CLOSED

**Context.** When the stream ended up `CLOSED`, `BoardRealtime` and `NotificationsBell`
called `router.refresh()`. The premise of the entry "Recreate the EventSource when the
browser stops retrying" ("the page did not redirect") was false: in Next 16, if the RSC
request of a refresh gets a non-OK response or fails at the network level, the router
does a full navigation (`fetch-server-response.js`, `doMpaNavigation`). With the proxy's
502 during `scripts/update.sh`, or a 500 from a transient DB failure, every open tab
ended up on the error page and any unsaved work was lost.

**Decision.** `keepEventSourceOpen` receives `probe` and `onAccessDenied` instead of
`onClosed`. When the stream is `CLOSED`, `probeStatus(url)` sends a GET to the same
endpoint, aborted as soon as the headers arrive; only on 401/403 is `onAccessDenied`
called (refresh to redirect to `/login` or `/boards`). On a 5xx, a network error or a
failure of the check itself it only retries with backoff; when the stream reopens,
`onReconnect` resyncs with the now-healthy server.

**Alternatives considered.**
- `HEAD` for the check: in the App Router it is derived from the GET and would open the
  stream anyway.
- Have the SSE routes answer 200 with an `event: revoked` before closing: cleaner, but it
  touches `sse.ts` and both routes, and does not cover the 401 of a reconnection.

**Consequences.** Each `CLOSED` costs one extra request to the endpoint (with a 200, the
stream opens and closes immediately). Tests in `test/realtime-reconnect.test.ts`
(5xx/network do not notify, 401/403 do, unmount during the check, and `probeStatus`
against a real HTTP server). Described in `docs/realtime.md`.
## 2026-09-24 — `CARD_DESCRIPTION_MAX` in a dependency-free module (`limits.ts`)

**Context.** The card modal imported `CARD_DESCRIPTION_MAX` from `app/lib/validators.ts`
for the textarea's `maxLength`. It was the only `"use client"` component importing
`validators.ts`, so zod ended up in the board's client bundle just for a number. Also,
`validators.ts` uses `Buffer` in `passwordSchema`, which does not exist in the browser.

**Decision.** The constant lives in `app/lib/limits.ts`, with no imports. The modal
imports it from there and `validators.ts` imports and re-exports it, so the schemas,
actions and tests keep using `validators.ts` unchanged. A unit test
(`test/client-imports.test.ts`) fails if a `"use client"` component imports zod or
`validators.ts`, or if `limits.ts` gains imports.

**Alternatives considered.** Duplicating the `5000` in the modal: two sources of truth
that can drift apart. Splitting `validators.ts` into client and server schemas: more
change than needed for one constant. Checking only with `pnpm build`: leaves nothing in
place to stop it from happening again.

**Consequences.** Limits the UI needs are added to `limits.ts`. The test only looks at
direct imports: an indirect chain to zod is not detected.

---

## 2026-09-24 — `updateCard` returns the error and does not revalidate unchanged descriptions

**Context.** `cardDetailsSchema` caps the description at `CARD_DESCRIPTION_MAX` (5000),
but `updateCard` did `return;` silently when validation failed, and the modal's textarea
had no `maxLength`. Pasting 6000 characters saved nothing and, when React reset the
form, the text disappeared. Also, cards with descriptions predating the limit (over
5000) could no longer change their due date from the modal, because the form resends
the description and the whole thing failed.

**Decision.**
- `updateCard(prev, formData)` returns `CardDetailsState` for `useActionState`: `{}` if
  it saves, or `{ error, description, dueDate }` with what was sent, to rehydrate the
  form. The modal shows the error (`role="alert"`) and disables the button while saving.
- The textarea has `maxLength={CARD_DESCRIPTION_MAX}` (now imported from `limits.ts`,
  see the entry above).
- The server normalises `\r\n` to `\n` before validating: the browser sends line breaks
  that way, but `maxLength` counts them as one character.
- If the received description equals the stored one (after normalising and trimming),
  its length is not validated and it is not rewritten; only the date is updated. The rule
  "if anything fails validation, nothing is saved" still holds.

**Alternatives considered.** Validating and saving description and date separately: it
would save one part and silently lose the other. A controlled textarea: forces manual
syncing with changes arriving via realtime. Moving the constant to a module without zod:
touches files outside this change (see consequences).

**Consequences.** The `updateCard` signature, the error messages and the
unchanged-description rule are in `docs/card-detail.md`. The problem of importing
`validators.ts` from the modal was solved later (entry above).

---

## 2026-09-24 — Client IP with a port, and a warning for a misconfigured proxy

**Context.** With `TRUSTED_PROXY_HOPS > 0`, `pickClientIp` returned null if the
X-Forwarded-For value did not pass `isIP` or if the header had fewer values than
declared proxies. A null `ip` disables the per-IP login limit and leaves `AuditLog.ip`
empty, without any log. Some proxies (Azure Application Gateway, IIS ARR) write the IP
with the source port (`1.2.3.4:5678`, `[2001:db8::1]:443`), so the operator believed the
limit was active when it was not.

**Decision.**
- `resolveClientIp` (pure) returns the IP or the reason there is none
  (`missing-header`, `too-few-values`, `not-an-ip`); with hops = 0 there is no reason.
- Before `isIP`, the port is stripped from `a.b.c.d:port` and from `[v6]:port` with
  strict regular expressions, and the result is validated again. It does not split on the
  last `:`, which would break an IPv6 address without brackets.
- `pickClientIp` (same signature, used by `clientIp()` in `audit.ts`) emits a
  `console.warn` once per reason and process, with `hops` and the number of values,
  without the header or any IP.

**Alternatives considered.** Putting the warning in `clientIp()` in `app/lib/audit.ts`
(out of scope for this change; the effect is the same in `pickClientIp`). Rate-limiting
the warning per minute: more state for the same result; seeing it once in the log is
enough. Accepting the value with the port as is: it would give a different rate-limit key
per connection.

**Consequences.** Proxies that append the port work without changing the configuration.
A misconfigured proxy leaves a warning in the log on the first login, documented in the
`TRUSTED_PROXY_HOPS` table in `docs/operations.md`.

---

## 2026-09-24 — A single session mechanism in the integration tests

**Context.** When merging the review batches, two ways of faking the session coexisted:
the shared stub `test/stubs/next-headers.ts` with `loginAs()` (authentication batch) and
a separate `vi.mock("next/headers")` in seven files, with the helper
`test/integration/action-session.ts`. With both together, 61 tests failed, because
`resetDb()` calls the stub's `__clearCookies()` and the local mocks did not export it.

**Decision.** All integration tests use the shared stub and `loginAs()` from
`helpers.ts`. `action-session.ts` and the local cookie jars are deleted;
`realtime.int.test.ts` keeps a wrapper that returns the session id, which it needs to
revoke the session. None of them replaces the DAL: the six that still did
(`board-metadata`, `members`, `collaboration`, `tokens`, `admin-users`,
`position-collation`) switch to `loginAs()`, so the real `requireBoardAccess`/
`requireAdmin` guard runs. `admin-users` only replaces `redirect()` from
`next/navigation`, to read the URL. `members.int.test.ts` adds a test that an EDITOR or
a VIEWER cannot manage members, which could not be written with the DAL replaced. The
unit test `test/metadata.test.ts` does replace the DAL, because it has no DB.

**Alternatives considered.** Having each local mock re-export the stub with
`importOriginal`: fixes the failures, but leaves two ways to log in and two different
test secrets. Keeping the `vi.mock("@/app/lib/dal")` in the six files and only fixing
their comments: the guard on the member actions would remain untested.

**Consequences.** 32 files and 210 integration tests green. A new test with a session
only needs `await loginAs(user.id)`; if another role is needed, the user is seeded with
that role instead of replacing the DAL.

---

## 2026-09-24 — Collation "C" on the position columns

**Context.** Fractional indexing keys (base62 `0-9A-Za-z`) only sort correctly byte by
byte. `ORDER BY position` used the DB collation: on postgres alpine (musl, the
development DB) it is byte by byte, but on glibc (the CI's Debian image, Ubuntu, managed
services) `en_US.utf8` puts `Zz` after `a0l`. Result: a card dragged to the top reappears
at the bottom on refresh, and `createCard`/`createList`/`addChecklist`/`addChecklistItem`
(which look up the last one with `ORDER BY position DESC`) generate duplicate keys. It
also happens with appends alone: after `aZ` comes `aa`, which that collation sorts before
`aB`...`aZ`, so from the 38th element on `aa` is repeated.

**Decision.**
- Migration `20260924000000_position_collate_c` (created with `migrate dev --create-only`
  and written by hand): `ALTER COLUMN "position" TYPE TEXT COLLATE "C"` on `List`, `Card`,
  `Checklist` and `ChecklistItem`. Rebuilds `Card_listId_position_idx`.
- A comment in the migration and in `schema.prisma` (`List.position`), because Prisma does
  not model collation; `prisma migrate diff` shows no drift.
- ADR 0002 extended under "Consequences" (the single source for the why and for how to
  detect keys that are already duplicated).
- Test `test/integration/position-collation.int.test.ts`: checks the collation of the four
  columns (fails without the fix on any server) and the order/no duplication of cards and
  lists with `a0`, `a0V`, `a0l`, `Zz`, and of checklists and items with 37 appends
  (`a0`...`aa`) (these fail without the fix on a glibc/ICU DB; verified with a temporary
  ICU DB and with `ORDER BY ... COLLATE "en-US-x-icu"`).

**Alternatives considered.**
- Sorting in JS or with `localeCompare`: scatters the rule across every query and does not
  fix the `findFirst ... DESC` used for appends.
- Creating the DB with `LC_COLLATE=C`: does not help existing installations or managed
  DBs where creation is not under our control.
- Reassigning already duplicated keys in the migration: touches production data; left as
  the owner's decision, with a prior backup (detection query for the four tables in
  ADR 0002).

**Consequences.** Every new position column must be created with `COLLATE "C"` by hand in
its migration. glibc installations that already have duplicate keys keep them until they
are reassigned; the order between two equal keys remains undefined.

---
## 2026-09-24 — Fixed CSP for .svg files

**Context.** The `proxy.ts` matcher excludes `.*\.svg$`, so SVGs do not get the nonce
CSP, and `next.config.ts` only set a CSP on `/api/**`. The SVGs in `public/` were served
without `Content-Security-Policy`: opened directly, an SVG is a document that can run
scripts on the app's origin.

**Decision.** A `/:file(.*\\.svg)` rule in `headers()` in `next.config.ts` with
`default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'` (its inline styles
work; scripts, external resources and framing do not). `test/next-config.test.ts`
resolves the rules with `buildCustomRoute` from the Next router (the same compiler it
uses at runtime) instead of comparing prefixes, so that regex parameters are understood,
and checks `/file.svg` and `/icons/logo.svg`.

**Alternatives considered.**
- Removing the `.svg` exclusion from the `proxy.ts` matcher: the proxy would add the page
  CSP (with nonce) to every SVG, plus the cost of running on every image request.
- Deleting the SVGs in `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`,
  `window.svg`): they are leftovers from the Next template and nothing in `app/` uses
  them, but deleting them is the owner's call. The rule also covers any future SVG.

**Consequences.** An SVG served by the app cannot load external fonts or images or run
scripts when opened directly. Loaded with `<img>`, an SVG never runs scripts and its CSP
plays no part, so normal use is unaffected.

## 2026-09-24 — pg pool timeout and Prisma singleton in production too

**Context.** `PrismaPg` created the `pg.Pool` with the defaults:
`connectionTimeoutMillis: 0`, so with the pool exhausted (10 connections) the next
request waited forever; Prisma 7 no longer applies Prisma 6's 5 s `connect_timeout`.
Also, the client was only stored on `globalThis` outside production, and Turbopack
evaluates the module once per layer (route handlers and RSC/SSR): two pools.

**Decision.**
- `buildPoolConfig()` exported from `app/lib/prisma.ts`: `connectionTimeoutMillis` 5 s
  and `idleTimeoutMillis` 10 s (pg-pool's default, made explicit so it does not change by
  accident). `onPoolError` logs only the error message (never the connection string). The
  adapter already listened to the pool's `error` event, so the process did not crash: the
  handler makes an idle connection's failure show up in the log and not only in the
  adapter's debug output.
- `globalForPrisma.prisma = prisma` always, like `bus.ts` and `rate-limit.ts`.
- `test/integration/prisma-pool.int.test.ts`: the exported client is created with
  `buildPoolConfig()` and `onPoolError` (`PrismaPg` is wrapped with `vi.doMock`); with
  `max: 1` and 200 ms, a query while a transaction holds the connection fails with a
  timeout; in production two evaluations of the module return the same client.

**Alternatives considered.**
- `max` configurable via environment variable: not needed yet.
- `statement_timeout`: would cut off large exports or imports without a measured value.
- A 30 s `idleTimeoutMillis`: no measurement justifies keeping idle connections open
  longer than pg's default.
- Testing the timeout with the real 5 s: every suite run would take 5 s longer; the wiring
  is already checked by the exported-client test.

**Consequences.** With the pool saturated, a request fails after 5 s with a timeout error
instead of hanging. A single pool per process.

## 2026-09-24 — Per-page titles and a login page without mentioning the license

**Context.** Every route had the same `<title>` "orgtable" (WCAG 2.4.2). Also, the login
screen ("Open source · AGPL-3.0", "open-source and self-hosted") and the meta description
said the app is open source under AGPL, but the license in force is the proprietary one
in `LICENSE` (owner's decision, commit 27c1ba9).

**Decision.**
- `app/layout.tsx`: `title: { template: "%s · orgtable", default: "orgtable" }`.
  `/login` exports "Sign in" and `/setup` "Initial setup"; the remaining pages are covered
  by other batches.
- Meta description: "Self-hosted Kanban boards, a Trello alternative".
- Login: the paragraph says "Self-hosted Kanban boards..." and the footer becomes "Kanban ·
  Self-hosted", with no mention of a license.
- `test/metadata.test.ts` checks the resolved titles, the description, and that the login
  HTML does not say open source or AGPL.

**Alternatives considered.**
- Removing the footer from the brand panel: it changed the composition (`justify-between`
  with three blocks).
- Putting a copyright notice in the footer: the legal text is for the owner to provide.

**Consequences.** Every new page must export its `title`; without it, it inherits
"orgtable".

## 2026-09-24 — 11 MB body limit for Server Actions

**Context.** Next 16 cuts a Server Action's body at 1 MB before running it.
`uploadAttachment` accepts 10 MB (`MAX_ATTACHMENT_BYTES`) and `importBoard` 5 MB, so any
attachment or import over 1 MB failed with a generic error. Also, `proxy.ts` runs on page
routes and Next only buffers 10 MB of their body: anything beyond that reaches the action
truncated, with no error.

**Decision.** `experimental.serverActions.bodySizeLimit` and
`experimental.proxyClientMaxBodySize` set to 11 MB (in bytes) in `next.config.ts`. The
extra megabyte covers multipart overhead and lets a file slightly over 10 MB reach the
action and get its own message instead of a 413. `test/next-config.test.ts` checks that
the limit exceeds `MAX_ATTACHMENT_BYTES` plus the overhead and that the proxy's matches.

**Alternatives considered.**
- Uploading attachments through a route handler under `/api` that authenticates before
  reading the body: this is the real fix, but it changes the upload architecture; the
  owner decides (noted in the backlog in `docs/security.md`).
- Importing `MAX_ATTACHMENT_BYTES` in `next.config.ts`: `storage.ts` is `server-only` and
  pulls in `node:fs`; the number is left with a comment and guarded by the test.

**Consequences.** The limit is global and applies before authentication: anyone can send
11 MB to an action. If the attachment maximum changes, this number must be raised (the
test fails if it falls short).
## 2026-09-24 — Return focus to the ✕ when canceling a board deletion

**Context.** When canceling "Delete? Yes / No" ("¿Borrar? Sí / No") (with "No" or with
Escape) the form unmounted with focus inside it and the ✕ was re-rendered without it:
focus fell to `<body>` and keyboard or screen reader users lost their place in the
`/boards` grid. The ✕ also stayed invisible (`opacity-0`), because there was no longer
focus inside the card.

**Decision.** `DeleteBoardButton` keeps a ref to the ✕ and a `restoreFocus` flag that
only cancellation sets to `true`; a `useEffect` on `confirming` consumes it and calls
`focus()`. The second click ("Yes" submits) is unchanged.

**Alternatives considered.**
- `autoFocus` on the ✕: every board in the grid would have it and the last one would
  steal focus on page load.
- Keeping the ✕ mounted and hiding the confirmation with CSS: changes the corner's layout
  and focus would still have to be moved by hand.

**Consequences.** After canceling, focus returns to the ✕ and `group-focus-within` keeps
it visible. `test/delete-board-button-focus.test.ts` covers it with a local hooks harness
(no jsdom): it fails with the previous version and checks that the initial mount does not
steal focus. Not tested in a browser or with a screen reader.

## 2026-09-24 — Per-page title on /boards, /board/[id] and /search

**Context.** All routes shared the `<title>` "orgtable", so tabs and history entries were
indistinguishable. The root template (`%s · ...`) belongs to the root layout batch; only
these pages' titles go here.

**Decision.**
- `export const metadata` with "Your boards" on `/boards` and "Search" on `/search`. The
  search query does not go in the title: it would end up in history and in tabs.
- `/board/[id]` uses `generateMetadata`, which reads the name with `getBoardTitleForUser`
  (`app/lib/queries.ts`, wrapped in `React.cache`). It shares the `boardAccessWhere`
  filter (owner or member) with `getBoardWithLists`, the same guard as the page. Without
  access or if the board does not exist, the generic title "Board".

**Alternatives considered.**
- Reading the title with `prisma.board.findUnique` without a filter: the `<title>` is
  resolved separately from the page and would leak another user's board name even though
  the page returns 404.
- Reusing `getBoardWithLists` in `generateMetadata`: loads the full board just to read
  the title.

**Consequences.** One more lightweight query per board visit.
`test/integration/board-metadata.int.test.ts` pins that the owner and members see the
name, and that a non-member or a nonexistent id get "Board".

## 2026-09-24 — AA contrast for --danger/--success and labeled fields on /boards

**Context.** `--success` (oklch 0.57 0.1 145) gave 3.86:1 on `--bg` and 3.72:1 in the
`bg-success/10 text-success` notices. `--danger` was borderline in its notices (4.48:1)
and in the overdue badge `bg-danger/15` (4.15:1 light, 4.45:1 dark). The
`Input`/`Textarea` placeholder (`text-ink-muted/70`) was at ~3.2:1. On `/boards`, the
new-board field and the JSON import field had no accessible label, and the import error
was not announced.

**Decision.**
- Tokens, the minimum for 4.5:1 with margin: light `--danger` 0.55→0.52 and `--success`
  0.57→0.48 (the finding's proposal); dark `--danger` 0.70→0.71. Dark `--success` is
  unchanged. `DESIGN.md` updated.
- `test/contrast.test.ts` reads the tokens from `app/globals.css`, converts OKLCH to sRGB
  and requires 4.5:1 for ink, ink-muted, accent, danger and success on bg, surface,
  surface-2 and column, for the notices at 10 % and the badge at 15 %, and for accent-ink
  on accent, in both themes.
- Placeholder in `app/components/ui/input.tsx` set to `text-ink-muted` (6.2:1).
- `aria-label` on the two fields on `/boards` and `role="alert"` on the import error.
- `title` with the full instance name in the top bar, which is truncated on mobile. The
  rest of the bar's responsive adjustment was already on main.

**Alternatives considered.**
- Changing only `--success` and leaving `--danger` just under 4.5:1 in its notices.
- Visible `<label>` elements: they change the layout of the `/boards` header; the
  placeholder already describes the field visually.

**Consequences.** Green and red slightly darker in the light theme, also in the
`bg-success`/`bg-danger` fills of other components (checklist bar, checkboxes). The test
warns if a hue change breaks contrast. Other placeholders with `text-ink-muted/70`
(search-box, card-modal) are out of scope for this batch.

## 2026-09-24 — Board deletion needs a second click and is owner-only

**Context.** On `/boards`, each board's ✕ was a single-click `<form action={deleteBoard}>`
that cascade-deleted lists, cards and attachments. It had `opacity-0` and only appeared
on hover, so on touch screens it was invisible but a tap on the corner triggered it. It
was also rendered on boards where the user was only a member, and there `deleteBoard` did
nothing and gave no feedback.

**Decision.**
- Client component `app/(app)/boards/delete-board-button.tsx`: the ✕ is a
  `type="button"` that turns into an inline "Delete? Yes / No"; only "Yes" submits the
  form. Focus moves to "No" and Escape cancels.
- It is rendered only if `board.ownerId === user.id`, the same rule `deleteBoard` applies
  on the server.
- Export and delete are always visible on screens without hover
  (`[@media(hover:none)]:opacity-100`) and when reached with the keyboard
  (`group-focus-within`).

**Alternatives considered.**
- `window.confirm` (the pattern in `user-row-actions.tsx`): the button cannot be styled
  or translated, and the project rule asks for inline confirmation.
- Showing the ✕ to members with an error message: it would offer an impossible action.

**Consequences.** A board can no longer be lost with a single tap. The corner actions take
fixed space on mobile. The second-click behavior has no interaction test (no jsdom or
e2e); `test/delete-board-button.test.ts` checks that the initial state cannot submit
anything.
## 2026-09-24 — Card modal: native `<dialog>`, dates and delete confirmation

**Context.** The card modal (`app/components/card/card-modal.tsx`) did not manage focus
(Tab walked through the board behind it, no accessible name), the comment time caused a
hydration error when opened via `?card=` (server in UTC, browser in its own zone), the
read-only due date was shown as raw ISO, the label and item toggles ignored failures, and
"Delete card" deleted on the first click.

**Decision.**
- Native `<dialog>` with `showModal()` in a layout effect and `close()` in its cleanup
  (before React removes the node, so the browser returns focus to the card). Escape via
  `onCancel`; a click outside is detected with `e.target === dialog`, because the
  `<dialog>` fills the viewport and acts as the scroll container.
- Comment time: only after hydration (`useSyncExternalStore`), in the browser's zone and
  `es-ES`; before that, a `<time dateTime>` with no text.
- Due date: `Intl` `es-ES` with `timeZone: "UTC"` (it is midnight UTC).
- Toggles: `runToggle` returns a message for a `role="alert"` shown next to what failed
  (under the labels, or under the items of each checklist), not at the top of the modal,
  which scrolls; it rethrows Next's internal errors with `unstable_rethrow` (public API,
  not the internal `isRedirectError`).
- Deletion: inline confirmation with a second click ("Delete the card?" Yes, delete / No),
  with focus moved to the new control at each step.
- Unselected labels: only `opacity-55` is removed (text at ~2.2:1) and the color fill is
  kept; the state is told apart by the ✓, the ring and `aria-pressed`. `aria-pressed` on
  the colors too; color names in Spanish.
- The backdrop fade lives in `::backdrop` with `motion-safe:`: the global reduced-motion
  rule in `globals.css` does not cover `::backdrop`.
- Pure logic in `app/components/card/card-modal-helpers.ts` so it can be tested in node.

**Alternatives considered.**
- Trapping focus by hand or with a library: `showModal()` already makes the background
  inert.
- `suppressHydrationWarning` on the time: it silences the warning but leaves the wrong
  text.
- Hard-coding `Atlantic/Canary` on the client: it is self-hosted and each user has their
  own zone.
- `window.confirm`: it blocks and does not follow the app's style.
- Unselected label as an outline with a color dot: a design change nobody asked for;
  removing the opacity is enough.
- Adding `*::backdrop` to the rule in `globals.css`: `motion-safe:` solves it without
  touching a shared file.

**Consequences.** With `?card=` the `<dialog>` arrives closed in the server HTML and opens
on hydration (a moment without the modal). The dialog behavior (focus, Tab, Escape,
click outside) has no automated test: the project has no jsdom or e2e; it is pending
manual verification. The label picker in `filter-bar.tsx` should use the same style as
this one (fill without opacity).
## 2026-09-24 — Members panel with native `<dialog>`

**Context.** The members panel was a `div role="dialog"` with no initial focus, no focus
trap, no focus return on close and no accessible name. Invitation errors and confirmations
were not announced, and the email field was cleared on failure.

**Decision.**
- `<dialog>` opened with `showModal()`: the browser puts focus inside and makes the rest
  inert. Escape (`cancel`) and a click on the backdrop call `onClose`; the actual close is
  done by the parent when it unmounts it. On unmount it is closed and focus is returned to
  whoever had it, by hand, because the browser does not restore it if the `<dialog>`
  leaves the DOM.
- `aria-labeledby`/`aria-describedby` with `useId`.
- Error with `role="alert"`, removed while submitting (see "Members panel: invite role
  after an error...", above); success in an always-mounted `role="status"` region.
- The email uses `defaultValue` with the `values` the action returns on failure. The role,
  in addition, remounts the `<select>` with a key (see the same entry).

**Alternatives considered.**
- A JavaScript focus trap or a dialog library: the modal `<dialog>` already provides it
  with no dependencies.
- Listening to the `<dialog>`'s `close` event: in development, Strict Mode's double mount
  fires it when the effect is cleaned up and would close the freshly opened panel.

**Consequences.** No new visible text. Still needs manual verification with keyboard and
screen reader (there is no e2e infrastructure). The card modal still uses the old pattern
(another batch).

---

## 2026-09-24 — Reminders: UTC day, 7-day window and a single overdue notice

**Context.** Overdue cards were notified every day forever and the run grew without
bound. The start of the day was computed in the server's zone even though `dueDate` is
midnight UTC: with a negative zone, a card due today showed up as "Task overdue" and the
text showed the previous day. The formatting used the `es` locale.

**Decision.**
- The day is counted in UTC and the date is formatted with `es-ES` and `timeZone: 'UTC'`
  (it is a calendar date).
- "Due soon": at most one notice per day. "Task overdue": a single notice, from the UTC
  day after the due date, and only for cards that became overdue in the last 7 days.
- Only assignees who are still board members are notified.
- `created` only counts the notifications that `notify()` actually saved.
- Tests for the cron endpoint (503/401/200) are added without modifying `route.ts`.

**Alternatives considered.**
- Using `ORGTABLE_TIMEZONE` for the due day: `dueDate` has no time or zone; any other zone
  would shift the chosen date.
- Notifying overdue cards with no age limit: endless daily notices.
- Fake timers in the tests: they do not affect the `createdAt` set by the database.

**Consequences.** Cards overdue for more than 7 days stop generating notices. An overdue
card produces a single overdue notice. Tests in `test/integration/reminders.int.test.ts`
and `cron-reminders.int.test.ts`.

---

## 2026-09-24 — Removing a member deletes their assignments; no notices to non-members

**Context.** `removeBoardMember` only deleted the `BoardMember` row. The assignments
(`CardAssignee`) stayed, and `addComment` and the reminders notified every assignee: the
removed person kept receiving card titles and up to 140 characters of each comment. In
addition, `updateBoardMemberRole` and `removeBoardMember` did not check how many rows
changed: with someone else's `userId`, a non-existent change was audited and notified
(revealing the board title). They did not publish on the realtime bus either.

**Decision.**
- `removeMemberFromBoard` (`app/lib/services/members.ts`) deletes the membership and the
  board's assignments in one transaction and returns how many memberships it deleted.
- The role and removal actions do not audit or notify if nothing changed (0 rows; for the
  role, also not if the user already had that role).
- Defense in depth: `addComment` only notifies assignees who are still members, which
  covers the orphaned assignments that already exist (the reminders, in their own entry).
- The three member actions use `revalidateBoard` (revalidates and publishes on the bus).
- `addBoardMember` returns `values` with what was submitted when there is an error, so the
  form is not cleared.
- The action tests replace `requireBoardAccess` with `vi.mock` only in their own file,
  without touching the global `next/headers` stub.

**Alternatives considered.**
- Cleaning up the orphaned assignments in production right away: it is an operation on
  real data that the owner decides (with a backup and a dry run). The membership filter
  neutralizes them in the meantime.
- Deleting them with a trigger or an `onDelete` in the database: there is no direct
  relation between `CardAssignee` and `BoardMember`; it would require a migration for
  something a transaction solves.

**Consequences.** The pre-existing orphaned rows remain in the database (no effect on
notices, but still visible as avatars on the card) until they are cleaned up. Tests in
`test/integration/members.int.test.ts` and `collaboration.int.test.ts`.

---

## 2026-09-24 — `notify` reports whether it saved the notification

**Context.** `notify()` had an empty `catch`: if the insert failed there was no trace, and
the reminders cron counted the notice as created anyway, so `POST /api/cron/reminders`
returned a false `created`.

**Decision.** `notify()` is still best-effort (it never throws), but it returns
`Promise<boolean>`: `true` as soon as the row is saved (even if publishing on the bus,
which has its own `try`, fails afterwards) and `false` otherwise. The failure is logged
with `console.error` with the type, ids and error code, without title or body (they carry
user text).

**Alternatives considered.**
- Rethrowing the error: it would break the mutation that triggers the notice (commenting,
  inviting...).
- Logging the full error message: it may include query values.

**Consequences.** Callers that ignore the result do not change. The cron only counts saved
notices. Test in `test/integration/notifications.int.test.ts`.

---
## 2026-09-24 — Recreate the EventSource when the browser stops retrying

**Context.** Behind a TLS proxy (nginx, Caddy), a restart with `scripts/update.sh` makes
the proxy answer 502 to the SSE stream. On a non-200 response, the browser leaves the
`EventSource` in `CLOSED` and does not retry. The client only did `router.refresh()`:
since the session was still valid the page did not redirect, and the board and the
notification bell were left without realtime until a reload.

**Decision.** `keepEventSourceOpen` (`app/lib/realtime/reconnect.ts`) manages the
`EventSource` lifecycle in `BoardRealtime` and `NotificationsBell`: it registers the
handlers, refreshes on every open except the first (also on recreated sources) and, if
the source ends up `CLOSED`, does `router.refresh()`, closes it and creates another after
an exponential backoff from 3 s to 30 s that resets on open. The effect cleanup closes the
source and cancels the pending retry. If access was revoked, the refresh redirects and the
unmount stops the retries. It is tested with an `EventSource` test double in
`test/realtime-reconnect.test.ts` (there is no jsdom).

**Alternatives considered.**
- Recreating the source inside each component: duplicates the timer logic in two places
  and cannot be tested without a browser.
- Retrying without backoff or with a short fixed interval: hammers the server while it
  starts up.
- Only documenting the limitation: restarting with `update.sh` is the usual operation.

**Consequences.** If the server rejects with 401/403 and for some reason the page does not
redirect, it retries every 30 s at most (a cheap request the server rejects again). Each
reopen after `CLOSED` causes two refreshes (the one on `CLOSED` and the one on reopen);
accepted for simplicity.

## 2026-09-24 — Notification times only after mount

**Context.** The bell's relative time depends on the browser's time and zone. Today the
list is only rendered when the dropdown opens (already on the client), but nothing
prevented a future change from rendering it in SSR with different text.

**Decision.** Same pattern as the comments: `useSyncExternalStore` (server `false`, client
`true`) and the relative text only once the component is mounted, inside a
`<time dateTime>`. The absolute date uses `Intl.DateTimeFormat("es-ES")` in the browser's
zone.

**Alternatives considered.** `suppressHydrationWarning`: hides the warning but leaves the
server text.

**Consequences.** During hydration the time is empty for a moment.

## 2026-09-24 — Refresh the notification counter from the Server Action

**Context.** Opening a notification that has a board did not call `router.refresh()`, and
`markNotificationRead` revalidated nothing: the shared layout was not re-rendered and the
unread counter stayed the same.

**Decision.** `markNotificationRead` and `markAllNotificationsRead` call `refresh()` from
`next/cache` (Next 16, Server Actions only) after the `updateMany`, and the client-side
`router.refresh()` calls are removed. `test/stubs/next-cache.ts` exports `refresh` as a
no-op.

**Alternatives considered.**
- `router.refresh()` also when there is a board: it competes with the `router.push` and
  depends on the client remembering it on every call.
- `revalidatePath("/", "layout")`: invalidates more than needed.

**Consequences.** The server decides the refresh. The badge can only be checked in the
browser; the integration test (`notifications-read.int.test.ts`) checks the data and that
`refresh()` is requested.

## 2026-09-24 — Resync the board and the bell when the EventSource reconnects

**Context.** The server does not resend missed events (there is no `Last-Event-ID`), and
the client did nothing on reconnect: after the laptop was suspended or the server
restarted, the board and the notification counter showed stale data.

**Decision.** `createReconnectRefresher` (`app/lib/realtime/reconnect.ts`): on every
EventSource `open` except the first, the same debounced refresh as an event is triggered.
If the EventSource ends up `CLOSED` (the server answered 401/403), `router.refresh()` is
called so the page redirects.

**Alternatives considered.**
- `Last-Event-ID` with an event history on the server: requires storing events per
  channel (memory or table) for a benefit a refresh already covers.
- Refreshing on every `open`, including the first: an extra render on page load.

**Consequences.** One `router.refresh()` per reconnection (also every 15 min because of
the stream's maximum lifetime). The `CLOSED` case caused by a proxy 5xx is handled in the
entry "Recreate the EventSource when the browser stops retrying".

## 2026-09-24 — LISTEN/NOTIFY bridge: closing, reconnection and payload validation

**Context.** If `LISTEN` failed or the connection emitted `error`, the `pg` client was not
closed and every SSE subscription opened another connection, without logging anything.
While the bridge was starting, published events were lost. The `NOTIFY` payload was
parsed with a cast: one without `id` was re-emitted on `board:undefined`. The publish
`.catch` handlers were empty.

**Decision.**
- A failed or dropped connection is always closed (`end()`) and logged with
  `console.error` (without `DATABASE_URL`). The global state is only cleared if the
  failing client is the active one.
- The startup promise is stored in `globalThis` and `publishCrossInstance` waits for it.
- Reconnection with exponential backoff from 1 s to 30 s, a single timer in `globalThis`,
  and only while there are subscribers left.
- `parseBridgePayload` validates with zod (`kind` board/user, non-empty `id` and
  `origin`); invalid payloads are discarded with a `console.warn` giving only the length.

**Alternatives considered.**
- Retrying on every subscription (the previous behavior): with no backoff, a database
  outage multiplied the connections.
- Dumping the invalid payload to the log: it can come from anyone with database access.

**Consequences.** Only applies with `ORGTABLE_REALTIME_PG_NOTIFY=1`. Unit tests in
`test/realtime-bus.test.ts` with a mocked `pg`. Not tested against a real Postgres outage
(`pg_terminate_backend`).

## 2026-09-24 — Lifecycle and access revalidation in the SSE streams

**Context.** The two SSE streams (`/api/boards/[id]/stream` and
`/api/notifications/stream`) left the bus subscription and the heartbeat dangling if the
request was aborted during authorization or if `enqueue` failed (the `closed` flag made
`close()` return without cleaning up), and they had no `cancel()`. In addition,
authorization was only checked on connect: a revoked session or a removed person kept
receiving events, contrary to ADR 0008.

**Decision.**
- Shared helper `app/lib/realtime/sse.ts` (`createSseResponse`) with an idempotent cleanup
  called from the abort (`{ once: true }`), `cancel()`, a failed `enqueue`, the
  revalidation and the maximum lifetime. If the request arrives already aborted, it
  answers 204 without subscribing.
- On every heartbeat (25 s) access is revalidated against the database: session not
  revoked or expired (`isSessionActive`) and, for the board, still a member. A flag
  prevents overlapping queries; if the query fails, it is logged and the stream closes.
- Maximum lifetime of 15 min: on close, EventSource reconnects and the route
  re-authorizes from the cookie.

**Alternatives considered.**
- `verifySession` in the heartbeat: it depends on `cookies()`, which only exists inside
  the initial request.
- A control event to cut off instantly on revocation: more invasive (publishing from
  every revocation or removal action); a 25 s margin is acceptable.
- Keeping a copy of the logic in each route: both copies had the same bug.

**Consequences.** One lightweight query per connection every 25 s. The client reconnects
every 15 min. Tests in `test/integration/realtime.int.test.ts` (401/403, abort, cancel,
revocation, removal, maximum lifetime; no listeners or timers left after closing).
## 2026-09-24 — The API token stays out of the live region

**Context.** On `/settings`, the always-mounted `role="status"` wrapped the whole panel of
the newly created token: the text, the `<code>` with the plaintext token and the Copy
button, and it also contained the `role="alert"` for a copy failure. The screen reader
could read the whole token every time the region changed (also when switching to
"Copied") and announce the failure message twice.

**Decision.** The `role="status"` only contains "Token "name" created" and "Copy it now:
for security it will not be shown again.". The `<code>`, the button and the
`role="alert"` are siblings of the region, not children. The green box becomes the
always-mounted container (unstyled until there is a token), so the look does not change.

**Alternatives considered.** `aria-live="off"` on the `<code>` inside the region: the
button's text change would still trigger an announcement of the whole region in some
screen readers.

**Consequences.** Test in `test/admin-forms-a11y.test.ts`: with a created token, the
region contains neither the token nor the button (`useActionState` is replaced in the
test itself because server rendering always yields the initial state). Actual reading
with a screen reader is pending manual verification.

## 2026-09-24 — Password reset validates the userId; scope of the deletion test

**Context.** `resetUserPassword` validated `userId` inside `resetPasswordSchema`: without
a `userId` it redirected to `?error=password` ("Password must be at least 8
characters."), which was not the problem. In addition, the board-owner test also passed
with the previous code (prior check + DELETE), so it did not prove the service's atomic
condition.

**Decision.**
- `resetUserPassword` calls `readUserId` before validating the password, like the other
  per-row actions: without a `userId` it answers `?error=invalid`.
- Direct test of `deleteUserAccount` (without going through the action): a board owner
  returns `owns_boards` and their board and attachment remain in the database; a
  non-existent id returns `not_found`.

**Alternatives considered.** Distinguishing by the schema's `issues[0].path`: splits the
id validation across two places. Reproducing the race by interleaving two transactions
(locking the `User` row via the board INSERT): depends on Postgres lock ordering and would
be a fragile test.

**Consequences.** The race itself (a board created between a check and the DELETE) is NOT
tested; the tests pin down the service contract (the safeguard is in the DELETE itself,
the action checks nothing beforehand). Tests in `test/integration/admin-users.int.test.ts`.

---

## 2026-09-24 — Admin and settings: announced messages, mobile and token copy

**Context.** Errors and messages in `/admin/users` and `/settings` were not announced to
the screen reader; the new-password field had no label; the users and audit tables were
clipped at 375 px (`overflow-hidden`) and left the Actions column out of reach; if copying
the token failed (because of `http://IP`, a non-secure context) there was no warning, and
the token is only shown once.

**Decision.**
- Errors with `role="alert"`; successes inside an always-mounted `role="status"`. A
  duplicate email marks the field with `aria-invalid` + `aria-describedby`.
- `aria-label="Nueva contraseña para <nombre>"` on the reset field.
- `overflow-x-auto` on the tables (keeps the corner clipping).
- Copying the token stores the result tied to the token (`copied`/`error`); if it fails,
  it shows "Could not copy automatically: select the token and copy it by hand." and
  leaves the token selected (`select-all` + `selectAllChildren`).

**Alternatives considered.** Turning the tables into cards on mobile: a design change for
the owner to decide. `document.execCommand("copy")` as a fallback: obsolete API.

**Consequences.** Unit test `test/admin-forms-a11y.test.ts` (server render: the
`role="status"` regions exist from the first render). The rest (screen reader, 375 px,
copy over http) is pending manual verification.

---

## 2026-09-24 — Create user and create token keep the input after an error

**Context.** With `action={fn}` React resets the form when the action finishes, so a
duplicate email or invalid data wiped everything typed.

**Decision.** `createUser` and `createApiToken` return `values` on every error (never the
password) and the fields use `defaultValue`. The `<select>` elements also get a `key`
with the returned value: React does not update the `defaultValue` of an already mounted
`<select>` and the reset would send it back to the initial value (e.g. "Administrator" →
"Member"). `createUser` returns `field: "email"` to mark the field of the duplicate email.

**Alternatives considered.** Controlled fields with `useState`: more code per field for the
same result. Submitting with `onSubmit` + `startTransition` to avoid the reset: changes the
submit flow of both forms.

**Consequences.** Tests in `admin-users.int.test.ts` and `tokens.int.test.ts` (the values
come back and the password does not).

---

## 2026-09-24 — Server dates in the instance time zone (ORGTABLE_TIMEZONE)

**Context.** `/admin/audit`, `/admin/users` and `/settings` are Server Components that
formatted with `Intl.DateTimeFormat("es")` without `timeZone`: dates came out in the
process time zone (UTC in the container). A failed login at 10:15 in the Canary Islands
showed up as 9:15, and dates close to midnight jumped to another day.

**Decision.**
- A single helper `app/lib/format-date.ts` (`formatDateTime`, `formatDate`) with locale
  `es-ES` and the time zone from the `ORGTABLE_TIMEZONE` variable (IANA; default
  `Atlantic/Canary`). It is validated with `Intl`: an unknown zone throws a clear error
  instead of falling back to a default value.
- The audit log shows the zone abbreviation (`timeZoneName: "short"`).
- Due dates (`dueDate`, calendar dates at UTC midnight) do NOT use this helper: they are
  formatted with `timeZone: "UTC"`.

**Alternatives considered.**
- Formatting on the client with the browser time zone: forces three server pages to
  become client components and gives each admin different times.
- Hard-coding `Atlantic/Canary`: this is a self-hosted app, and each instance has its
  own zone.

**Consequences.** New environment variable `ORGTABLE_TIMEZONE` (its documentation in
`.env.example` and the README is done by the deployment batch). Unit test
`test/format-date.test.ts` with `TZ=UTC`.

---

## 2026-09-24 — Admin actions: non-existent user and atomic deletion

**Context.** `updateUserRole`, `resetUserPassword`, `revokeUserSessions` and `deleteUser`
did not check whether the user existed: they wrote an audit entry and reported success
with a non-existent id. `deleteUser` checked the user's own boards in a prior query; if
the user created a board in between, the cascade via `ownerId` deleted its `Attachment`
rows and left the files orphaned in the attachments volume.

**Decision.**
- The id is validated as a non-empty string (`String(null)` gave `"null"`).
- The `count` from `updateMany`/`deleteMany` is used (plus a `findUnique` in "End
  sessions", where 0 sessions is valid), and the action redirects to `?error=not-found`
  before auditing. Message: "That user no longer exists.".
- `deleteUserAccount` (service) deletes with `where: { id, boards: { none: {} } }`: the
  condition lives in the same DELETE, so the cascade never reaches attachments.

**Alternatives considered.** Reading the `storedName` values and deleting the files after
the DELETE: with the atomic condition there are no attachments to delete, and it could
not be tested without bypassing the owned-boards safeguard.

**Consequences.** Tests in `test/integration/admin-users.int.test.ts` (no audit entry
with a non-existent id; a board owner is not deleted and their attachment stays in the
DB). Those tests do not reproduce the race: see the entry "Password reset validates the
userId; scope of the deletion test".

---

## 2026-09-24 — Creating an API token validates permissions and expiry

**Context.** `createApiToken` turned an unrecognized `scope` or `expiry` into "write"
and "never expires", the most permissive value, with a comment that talked about "safe
default values".

**Decision.** Name, permissions and expiry are validated with a single `z.object` that
reuses the schemas in `validators.ts`; if anything fails, it returns `{ error }` without
creating anything ("Invalid permissions." / "Invalid expiry."). The form defaults
(write, never expires) do not change: the owner decides them.

**Alternatives considered.** Falling back to "read only" and a finite expiry: it would
still be a silent default that hides a tampered or broken form.

**Consequences.** Test in `test/integration/tokens.int.test.ts`.

---

## 2026-09-24 — Resetting the password also revokes API tokens

**Context.** `resetUserPassword` only revoked sessions. `authenticateApiToken` does not
look at the `Session` table, so anyone who had created a `full` token with no expiry
from a compromised account could still get in through `/api/v1` after the reset. The
action's comment promised the opposite.

**Decision.**
- New service `resetPasswordAndRevokeAccess` in `app/lib/services/users.ts`: in a single
  `$transaction` it changes the hash, revokes the sessions and **deletes** the user's
  tokens (deleting is the revocation defined in ADR 0013). It checks that the user exists
  before hashing.
- The `user.password_reset` audit entry records how many tokens were revoked.
- "End sessions" keeps its semantics (sessions only) and no new revoke-tokens button is
  added; it is documented that it does not touch tokens.

**Alternatives considered.**
- Invalidating tokens by date (`tokensValidAfter` on `User`): requires a migration and
  leaves dead rows in `/settings`.
- Also revoking tokens in "End sessions": changes an action used to sign someone out of
  their browser without breaking their scripts.

**Consequences.** After a reset the user has to create new tokens. Test in
`test/integration/admin-revocation.int.test.ts` (the same Bearer goes from 200 to 401;
other users' tokens are not touched).
## 2026-09-24 — next/headers stub: clear cookies and headers separately

**Context.** `loginAs` called `__clearCookies`, which also cleared the injected headers.
A test that did `__setHeaders({ "x-forwarded-proto": "https" })` and then `loginAs`
silently lost the header: the cookie went out without `Secure` and the rate limit did
not see the IP. Also, the `resetDb` test passed with the previous fixed table list too
(CardAssignee and Comment go via the CASCADE), so it did not prove that the tables were
read from the catalog.

**Decision.**
- `__clearCookies` clears only cookies and `__clearHeaders` only headers. `loginAs`
  calls the first; `resetDb` calls both. Order documented in `docs/testing.md`: headers
  are set after `resetDb`, before or after `loginAs`.
- `helpers.int.test.ts` creates a temporary table with no FK, inserts a row and requires
  `resetDb` to empty it (with the fixed list it fails); and it checks that `loginAs`
  keeps `X-Forwarded-Proto`/`X-Forwarded-For`.
- `audit.int.test.ts` requires the log of the FK failure not to include the `userId`. It
  passes with the current `describeError` (the Prisma P2003 message names the
  constraint, not the value), so `app/lib/audit.ts` is not touched.

**Alternatives considered.**
- Keeping a single `__clearCookies` with a parameter to keep headers: a boolean
  parameter that changes behavior.
- Comparing `pg_tables` with the Prisma models: depends on `@@map` and does not prove
  that `resetDb` uses the catalog, only that the schema matches.
- Logging only the name and code of every `PrismaClientKnownRequestError`: the test
  shows no leak, and the failing constraint, useful for diagnosis, would be lost.

**Consequences.** The `Secure` cookie and IP tests can use `loginAs` without re-injecting
headers. The temporary table `zz_reset_probe` is dropped in a `finally` and, in case it
is left over from an interrupted run, also before creating it.

## 2026-09-24 — Login and setup: keep what was typed and announce errors

**Context.** React 19 resets uncontrolled forms after an action: after "Incorrect
credentials" the email was cleared, and after a setup validation error, all four fields.
Also, the error message was a `<p>` without `role="alert"` that the screen reader did
not announce.

**Decision.**
- `AuthState.values` and `SetupState.values` return what was submitted on every error
  (email; instance name, name and email), never the password. The client renders it with
  `defaultValue`. They are not returned on success.
- The error `<p>` has `role="alert"` and is removed while `pending`, so that a second
  identical error is inserted again and announced again.

**Alternatives considered.**
- Controlled fields with `useState`: more code in two forms for the same effect.
- A `key` with an attempt counter: requires adding state just for that.

**Consequences.** Verification with VoiceOver is manual: there is no component testing
infrastructure. The integration tests check that `values` arrives without the password.

---

## 2026-09-24 — Setup: advisory lock, early exit and cause in the log

**Context.** `completeSetup` checked `setupCompletedAt` inside the transaction and the
comment claimed it was atomic, but under READ COMMITTED two simultaneous submissions both
read "not set up" at the same time and created two admins (reproduced with a test:
without a lock, two ADMINs come out). Also, with setup already done the action still
validated and spent bcrypt time before finding out, and any failure ended in "Try again"
without recording the cause.

**Decision.**
- Logic in `app/lib/services/setup.ts` (`completeInstanceSetup`), whose first statement
  is `pg_advisory_xact_lock(hashtext('orgtable:setup'))`.
- The action exits with `redirect("/login")` if `isSetupComplete()` before validating and
  hashing; the check inside the transaction stays.
- On error, `console.error` with the Prisma name, code and fields plus the message,
  without FormData or email. The visible text does not change.

**Alternatives considered.**
- `SELECT … FOR UPDATE` or a conditional `updateMany`: the `InstanceConfig` row does not
  exist before the first setup and there is nothing to lock.
- Creating `InstanceConfig` first and treating the P2002 on its PK as "already set up":
  requires telling it apart from the duplicate-email P2002.
- SERIALIZABLE level: would require retries on serialization failures.
- A specific message for a duplicate email: it was optional and added a new visible
  text.

**Consequences.** The second submission waits for the first and gets `ALREADY_SETUP`
(redirect to `/login`). A 20-iteration test with two simultaneous calls in
`test/integration/setup.int.test.ts`.

---

## 2026-09-24 — The audit log records its own failures

**Context.** `recordAudit` had an empty `catch {}`: if the write to `AuditLog` failed,
security events (`auth.login_failed`, `user.deleted`…) were lost without a trace.

**Decision.** It still does not rethrow (best-effort), but it writes `console.error` with
`action`, `targetType`, `targetId` and a summary of the error (type, Prisma code and
message). Never `detail`, `ip` or `userId`. For `PrismaClientValidationError` only the
type is logged, because its message reproduces the query arguments.

**Alternatives considered.**
- Rethrowing the error: login or deletion would fail because of a problem in the audit
  table.
- Logging the full error: the Prisma validation message includes `detail` and `ip`.

**Consequences.** An audit failure shows up in the container logs
(`docker compose logs app`) with the affected action.

---

## 2026-09-24 — Login: trusted IP, per-account limit and a valid dummy hash

**Context.** Four login flaws: (1) the per-IP limit took the first value of
`X-Forwarded-For`, which the client writes, so by changing it on every attempt brute
force had no limit; there was no per-account limit either. (2) The dummy hash for
non-existent emails was 59 characters long, `bcrypt.compare` returned `false` instantly
and the response time revealed which emails have an account. (3) Every failure stored
the typed email in `AuditLog.detail`, whether or not the account existed. (4) Every
attempt rejected by the limit wrote an audit row.

**Decision.**
- `TRUSTED_PROXY_HOPS` (integer >= 0, default 0, validated): with 0, `X-Forwarded-For`
  and `X-Real-IP` are ignored; with N, the Nth value from the right is taken
  (`app/lib/client-ip.ts`). Without an IP, neither a per-IP limit nor a shared counter
  applies.
- Per-account limit: 20 failed attempts every 15 minutes per normalized email, also for
  non-existent emails; it resets after a successful login. The attempt is counted before
  verifying and cleared on success, to avoid races between simultaneous requests.
- `DUMMY_PASSWORD_HASH`: a real 60-character bcrypt hash with cost 12, as a literal, and
  `verifyPasswordOrDummy` in `app/lib/auth.ts`.
- `auth.login_failed` stores only the `userId` if the account exists; never the email.
- `RateLimitResult.firstBlock`: only the first rejection in each window is audited, with
  `detail` "IP limit" or "account limit".
- ADR 0009 updated.

**Alternatives considered.**
- Keeping the first value of `X-Forwarded-For`, or `X-Real-IP`: the client controls them
  when the app is exposed without a proxy.
- A global `login:unknown` counter when there is no IP: an attacker could block login
  for everyone.
- Storing an HMAC of the non-existent email to correlate attacks: it is still
  pseudonymous data about a third party and was not needed.
- `bcrypt.hashSync` at module import: adds ~200 ms to every cold start.

**Consequences.** With the default value `AuditLog.ip` stays empty and only the
per-account limit applies. Anyone who knows an email can lock that account for up to 15
minutes (accepted risk, documented in ADR 0009). Old `auth.login_failed` rows with an
email remain in production: deleting them is a bulk operation for the owner to decide.
`.env.example`, the README and `docs/operations.md` are updated by the deployment batch.

---

## 2026-09-24 — Secure session cookie based on the real scheme, and a loud SESSION_SECRET

**Context.** The `session` cookie had `Secure` when `NODE_ENV=production`. The documented
first start is over `http://IP:3000`, and the browser discards a `Secure` cookie
received over HTTP on a non-localhost origin: after the setup wizard the instance would
not let anyone in. Separately, `decrypt` called `getKey()` inside the `try`, so a missing
`SESSION_SECRET` turned into "no session" and redirected to `/login` without leaving a
trace.

**Decision.**
- `secure` = the request arrived over HTTPS: the first value of `X-Forwarded-Proto`
  equals `https`. Next fills that header with the real socket scheme when no proxy sends
  it (`??=` in `base-server`), and a TLS proxy sets it to `https`.
- `decrypt`: with no token it returns `null` before asking for the key; with a token,
  `getKey()` goes outside the `try` and only `jwtVerify` stays inside.
- `createSession` validates the key before creating the `Session` row.

**Alternatives considered.**
- A `SESSION_COOKIE_SECURE` variable to disable it on a LAN: another configuration
  option that weakens security if left on after adding TLS.
- Keeping `NODE_ENV`: leaves an HTTP install unusable.

**Consequences.** Over HTTP the cookie travels without `Secure` (which in practice
already happened, since nobody could log in); behind a TLS proxy that sends
`X-Forwarded-Proto` it does carry it. Spoofing that header only affects the client
itself. The deployment documentation (TLS in front) is updated by the deployment batch.

---

## 2026-09-24 — Integration tests with a session: mutable cookie stub

**Context.** The `next/headers` stub always returned `undefined` from `cookies().get`,
so `verifySession`, `requireUser` and `requireBoardAccess` never authenticated in tests:
there was no way to test Server Actions or session revocation (ADR 0008). Also,
`resetDb` used a fixed table list that was missing `CardAssignee` and `Comment`.

**Decision.**
- `test/stubs/next-headers.ts` keeps cookies and headers in a mutable module-level
  store, with `__setHeaders`, `__clearCookies` and `__getCookieOptions` for tests.
- `loginAs(userId)` in `test/integration/helpers.ts` calls the real `createSession`;
  `resetDb` also clears the stub and the rate-limit counters.
- A fixed test `SESSION_SECRET` in `vitest.integration.config.ts`.
- `resetDb` reads the tables from `pg_tables` (current schema, without
  `_prisma_migrations`) and validates each name before interpolating it into the
  `TRUNCATE`.
- A test confirms that React's `cache()` does not memoise outside RSC (switching user
  with `loginAs` takes effect immediately).

**Alternatives considered.**
- `vi.mock("next/headers")` in each file: would repeat the same store in every test.
- Keeping the table list by hand and adding the two missing ones: it would drift again
  with the next table.
- Estimating rows with `reltuples` to decide what to empty: it is not exact.

**Consequences.** Tests can run Server Actions with a real session (`Session` row +
signed JWT). Removing a check from `verifySession` makes `session.int.test.ts` fail
(verified by removing `revokedAt` and the `userId` check).
## 2026-09-24 — Attachments: lock the parent rows before reading which files to delete

**Context.** The comment in `services/attachments.ts` said that "what is read is exactly
what gets deleted", but under READ COMMITTED that was not true: if `uploadAttachment`
inserted its row between the `findMany` and the `delete`, the deletion waited for that
insert and removed it by cascade; its file was not in the list that had been read and
was left orphaned, while the upload was reported as successful.

**Decision.** Inside the transaction, `SELECT … FOR UPDATE` top-down before the
`findMany`: the card (`deleteCardWithAttachments`); the list and its cards
(`deleteListWithAttachments`); the board, its lists and its cards
(`deleteBoardWithAttachments`). Inserting an `Attachment` takes `FOR KEY SHARE` on its
`Card`, which conflicts with `FOR UPDATE`; locking the parents as well stops new cards
and lists from being created while the children are read. An integration test reproduces
the race with an uncommitted transaction and fails without the locks.

**Alternatives considered.**
- SERIALIZABLE level: requires retrying on serialization failures in every call.
- Only fixing the comment: the file would still be left orphaned.
- A periodic orphan sweep: new infrastructure for a case the lock prevents.

**Consequences.** A large board deletion locks its lists and cards for the duration of
the transaction; concurrent edits to those rows wait a few milliseconds. An upload that
arrives during the deletion fails and `uploadAttachment` deletes its file.

---

## 2026-09-24 — Ordering: 1024-character cap on position keys

**Context.** `isValidPositionKey` limited keys to 64 characters. Measured with a script
on `fractional-indexing`: always dropping cards into the same gap (e.g. always in second
position) exceeds 64 characters after 373 insertions. From then on
`moveCard`/`reorderList` returned `{ ok: false }` for that gap and, since `BoardView`
ignores the result, the drag looked like it worked and was undone on refresh.

**Decision.** `POSITION_KEY_MAX = 1024` (about 6000 consecutive insertions into the same
gap). It still prevents megabyte-long strings and stays well below the maximum size of an
entry in the `Card` btree index `(listId, position)` (≈2700 bytes). Documented in
`docs/drag-and-drop.md` together with its consequence.

**Alternatives considered.**
- Keeping 64 and only documenting it: the limit is reached with normal use.
- Removing the cap: a megabyte-long key would reach the DB and break the index.
- Rebalancing the list's positions past a certain length: more code and writes across
  several rows for a case that 1024 already covers with plenty of margin.

**Consequences.** The silent failure of `BoardView` on `{ ok: false }` is still there
(outside this batch); with 1024 it only shows up under extreme use.

---

## 2026-09-24 — Passwords of at most 72 bytes

**Context.** `setupSchema` and `passwordSchema` allowed 200 characters, but bcryptjs only
uses the first 72 UTF-8 bytes: two passwords with the same 72-byte prefix were
equivalent without anyone knowing.

**Decision.** `passwordSchema` rejects more than 72 UTF-8 bytes (message "Maximum 72
bytes (about 72 characters without accents or emoji)") and `setupSchema.password` reuses
it, so the rule lives in a single place (setup, account creation and admin reset).
`loginSchema` does not change.

**Alternatives considered.**
- Prehashing (SHA-256 before bcrypt): would invalidate existing hashes or require
  migrating them.
- Applying the limit to login as well: would lock out anyone who already has a longer
  password stored (which still works with its first 72 bytes).

**Consequences.** A new password longer than 72 bytes is rejected with a visible error.
The forms' `maxLength` is not touched here.

---

## 2026-09-24 — Realtime: deleting a board notifies over the live bus

**Context.** `deleteBoard` (the action and the API `DELETE`) published nothing: tabs that
had the board open kept showing it until reloaded.

**Decision.** After deleting, `revalidateBoard(boardId)` is called as in the other
mutations; the Server Action only does so if the board was actually deleted (owner).

**Alternatives considered.** A specific `board.deleted` event on the bus: the client
already refreshes on any board notification, and the page, with no membership, redirects
to `/boards`.

**Consequences.** None for existing installations.

---

## 2026-09-24 — Attachments: delete the files when cards, lists and boards are deleted

**Context.** `onDelete: Cascade` deleted the `Attachment` rows when a card, list or board
was deleted, but the binaries stayed on the volume forever. An upload whose row failed to be
created also left the file behind.

**Decision.** `services/attachments.ts` reads the on-disk names and deletes from the
database in one transaction and, after the commit, deletes the files with
`Promise.allSettled`. It is used by `deleteCard`, `deleteList`, `deleteBoard` and the API
`DELETE` endpoints. `uploadAttachment` deletes the file if creating the row fails and
rethrows the error.

**Alternatives considered.**
- Deleting the files before the commit: if the transaction failed, the row would be left
  without its binary.

**Consequences.** Orphaned files that already exist in an installation are not cleaned up
(owner's decision; a sweep would need a script with a dry run).

---

## 2026-09-24 — Cards: due date and description validated in actions and API

**Context.** An unparseable date was saved as `null` and silently cleared the due date (in
the API, with 200/201), and the description had no limit in the UI.

**Decision.**
- In the UI, `dueDateSchema` (`""`, `null` or a real `YYYY-MM-DD` with `z.iso.date()`); in
  the API, `apiDueDateSchema` (`YYYY-MM-DD` or ISO 8601 with a time zone). In the API **an
  empty string returns 422**, it is not a synonym for `null`: `null` already exists to
  clear the date and a `""` is usually a client error. If anything fails validation in
  `updateCard`, nothing is saved (not even the description); `setCardDueDate` returns
  `ok:false`.
- `CARD_DESCRIPTION_MAX = 5000` shared by the UI, the API and import.

**Alternatives considered.**
- `Date.parse` or just `z.iso.datetime()` for the API: the former accepts ambiguous
  formats and the latter would break the documented `YYYY-MM-DD`.

**Consequences.** An API client that sent `dueDate: ""` to clear the date now gets a 422
and must send `null`.

---

## 2026-09-24 — Ordering: validated position keys and serialized appends at the end

**Context.** `moveCard`/`reorderList` saved any string as a position, and an invalid key
left the list or board unable to create anything (`positionAtEnd` threw). Also, reading the
last position and creating were two separate steps, so two simultaneous creations saved the
same key and drag and drop broke in that list.

**Decision.**
- `isValidPositionKey` (`ordering.ts`): a base62 regex with a length cap + the validation
  of `fractional-indexing` itself (the library alone accepts `'a0 '`). It is validated
  before any query.
- Appends at the end (`createCardAtEnd`, `createListAtEnd`, `createChecklistAtEnd`,
  `createChecklistItemAtEnd`) run in an interactive transaction with `SELECT … FOR UPDATE`
  on the parent row (list, board, card, checklist). It works with the
  `@prisma/adapter-pg` adapter; tested with 10 parallel POSTs.

**Alternatives considered.**
- A unique index on `(listId, position)`: concurrent moves also collide and would fail
  instead of being ordered.
- Changing the drag contract to `beforeId/afterId`: an API change that is the owner's call.

**Consequences.** Invalid or duplicate positions that already exist are not cleaned up.

---

## 2026-09-24 — Labels: toggleCardLabel IDOR and colors validated against the palette

**Context.** `toggleCardLabel` authorized against the card's board, but accepted a label
from another board (IDOR): an editor of A could attach a label from B by knowing its id.
Also, the `in` operator on the palettes accepted prototype keys such as `'constructor'`,
which ended up rendered as a color.

**Decision.**
- `labelBelongsToBoard` (`services/labels.ts`) after authorizing; input validated with zod.
- Colors validated with a `z.enum` of the palette and `.catch` (label → `"blue"`,
  background → `null`) to stay tolerant of import and forms; on read, `Object.hasOwn`
  instead of `in`.

**Alternatives considered.**
- Rejecting the import on an unknown color: an export from another version with a color
  that no longer exists would fail to import over a cosmetic detail.

**Consequences.** Cross-board `CardLabel` rows that already exist in an installation are
not cleaned up (owner's decision; a sweep would need a script with a dry run).

---

## 2026-09-24 — Attachments: visible disk errors and a uniform 404 on download

**Context.** `deleteAttachmentFile` had an empty `catch` that also swallowed
`EACCES`/`EROFS` (the row was deleted and the binary stayed on disk without a trace). The
download returned 404 for a nonexistent id and 403 for one from someone else's board
(revealing which ids exist), and turned any read error into a 404. Also,
`path.join(process.cwd(), "uploads")` made Turbopack trace the whole project into
`.next/standalone`.

**Decision.**
- `deleteAttachmentFile` ignores only `ENOENT`; everything else is logged with
  `console.error` (on-disk name and code, without the original name) and **is not
  rethrown**: the row is already deleted and a throw would break the action before
  revalidating.
- The download looks up the attachment with a single query scoped by membership; with no
  result, `404 Not found` with the same body in both cases. `ENOENT` on read → 404 +
  `console.warn`; any other code → 500 + `console.error`.
- `/* turbopackIgnore: true */` on the `path.join` of the upload directory.
- The integration tests that invoke Server Actions create a real session (a `Session` row
  + signed JWT, `test/integration/action-session.ts`) and only replace the cookie read with
  a local `vi.mock("next/headers")`, so they really exercise the DAL and the role guards
  without touching the shared stub.

**Alternatives considered.**
- Rethrowing the `unlink` error: it would leave the action half done after deleting the
  row.
- Keeping the 403 on download: the v1 API already avoids telling them apart on purpose.
- Mocking the DAL in the tests: it would not test the real authorization.

**Consequences.** A volume without write permissions shows up in the logs. The reduction of
the NFT trace could not be checked here (the build is run by the integrator): after
`pnpm build`, `api/attachments/[id]/route.js.nft.json` should drop to about 200 entries and
`.next/standalone` should not contain `docs/` or `test/`.
## 2026-09-24 — Backup cron log outside `backups/` and installer URL based on `APP_PORT`

**Context.** The review of the first pass of this batch found that the cron example in
`docs/operations.md` redirected the log to `backups/backup.log`. In a fresh installation
`backups/` does not exist (`backup.sh` creates it), cron opens the redirection before
launching the script, and the backup never ran, without leaving a trace in any log. Also,
`install.sh` discarded the IP from `APP_PORT` and pointed to `http://<IP>:3000` even when
the app listened only on `127.0.0.1`, and with `set -o pipefail` an `.env` without
`APP_PORT` made the installer fail at the last step. The documentation said the app "does
not start" without `SESSION_SECRET`, but the secret is checked when the session is created.
And the advice for protecting the reset wizard (`APP_PORT=127.0.0.1:3000`) protects nothing
behind a proxy, because `/setup` is still open through the domain.

**Decision.**
- The cron example writes to `/home/usuario/orgtable-backup.log`, outside the repo.
- `install.sh`: with a loopback `APP_PORT` it explains how to get in through the proxy or
  an SSH tunnel; with another specific IP it shows that IP; with only the port or
  `0.0.0.0`, the server's IP. Without `APP_PORT` it uses 3000 instead of aborting. Tests in
  `test/ops-scripts.test.ts` with fake `docker`, `git` and `hostname`.
- `.env.example` and `installation.md` describe what really happens without
  `SESSION_SECRET`: the app starts, but login and the wizard fail.
- Wizard reset: cut public access to `/setup` (stop the proxy or block the route) and
  complete it through an SSH tunnel, or complete it right afterwards.

**Alternatives considered.**
- Log inside `backups/` with a prior `mkdir`: it is one more step that gets forgotten and
  the failure becomes silent again.
- Log in the repo root: it shows up as an untracked file in `git status` and goes into the
  Docker build context.
- Making the app refuse to start without `SESSION_SECRET`: it changes behavior and is out
  of scope for this batch, which is about documentation and operations.

**Consequences.** Anyone who already copied the previous cron must change the log path (or
create `backups/` once with `mkdir -m 700 backups`). The installer's final message depends
on `APP_PORT`.

## 2026-09-24 — The documentation is aligned with the proprietary license

**Context.** `LICENSE` has been proprietary (MARA-KASSA SL) since commit `27c1ba9`, but
ADR 0005, `docs/index.md`, `docs/roadmap.md`, `docs/design-system.md`,
`docs/contributing.md`, `PRODUCT.md`, `CLAUDE.md` and `package.json` still said AGPL or
open source.

**Decision.** Details in [ADR 0016](./decisions/0016-licencia-propietaria.md): the license
in force is `LICENSE`, which is not touched. ADR 0005 marked "superseded by ADR 0016";
documentation without "open source"; `contributing.md` points to the assignment clause in
`LICENSE` without copying it; `package.json` with `"license": "UNLICENSED"`; CI fails if
AGPL or "open source" reappears outside ADR 0005, ADR 0016 and this log.

**Alternatives considered.** Restoring the AGPL (owner's decision) and dual licensing (not
considered).

**Consequences.** The app's visible texts (`app/layout.tsx`, the login screen) are changed
by another batch of this review; until it is merged, the CI license step fails because of
them. An unsigned assignment of rights is questionable under Spanish law: if external
contributors join, it should be reviewed with a lawyer or replaced by a CLA.

---

## 2026-09-24 — README with a fixed structure and recovery documentation

**Context.** The README had no requirements, commands, variables or deployment, and still
said the interface was "under construction" when every feature through API token scopes
was done. `SECURITY.md` was in English and pointed to GitHub private reporting, which
does not exist in private repositories. The wizard reset opened `/setup` to anyone
without warning and was presented as a way to "redo the administrator", which fails with
an email that already exists. `docs/setup-wizard.md` said "three things" and listed two,
and `docs/database.md` showed a `createPrismaClient` without the `DATABASE_URL` guard.

**Decision.**
- README in six sections (what it is, requirements, installation, commands, variables,
  deployment) plus documentation and license, pointing to `docs/` without duplicating. The
  local installation writes a minimal `.env` with a `SESSION_SECRET` generated by
  `openssl`, ready to copy and paste.
- `SECURITY.md` in Spanish; the reporting channel stays as a `TODO` (email and response
  time) for the owner to unblock. "Latest release" becomes "follow `main` with
  `scripts/update.sh`".
- Wizard reset: exposure warning, new email and a command using the container's
  `$POSTGRES_USER`/`$POSTGRES_DB`. Recovering an administrator: another ADMIN from
  `/admin/users`, or an `UPDATE` with a hash generated with `bcryptjs` cost 12 inside the
  container.

**Alternatives considered.**
- A password recovery script: it is a rare case and the two-command procedure is enough;
  one more script is more surface to maintain.
- Keeping the badge and the repository URL corrected: the official URL is the owner's
  call, so they are not changed (see consequences).

**Consequences.** The recovery procedure and the reset were tested against a real Docker
stack (the generated hash validates with `bcrypt.compare`). The URLs in `install.sh`, the
README (`aimarmndzz`, badge `Aimarmndz`) and `docs/installation.md` (`<owner>`) still do not
point to the real remote; if the repository is private, the installer with anonymous `curl`
does not work. Pending the owner's decision.

---

## 2026-09-24 — Docker image: read-only code and a build context without data

**Context.** The `Dockerfile` ended with `chown -R nextjs:nodejs /app`: a new layer that
duplicated `node_modules` (hundreds of MB) and left `server.js`, `.next` and
`node_modules` writable by the app process. `.dockerignore` did not exclude `backups/` or
`uploads/`, so `COPY . .` put dumps with personal data into the builder and its cache.

**Decision.**
- No `chown -R`: `/app` stays owned by root. The entrypoint comes in with
  `COPY --chmod=755` and only `.next/cache` is handed to `nextjs` (besides
  `/data/uploads`, which already was).
- `.dockerignore` excludes `backups`, `**/*.sql.gz`, `**/*.tar.gz`, `uploads`, `data`,
  `**/*.pem`, `coverage`, `test`, `scripts` and `install.sh`.

**Alternatives considered.**
- `COPY --chown` on each `COPY`: it still leaves the code writable.
- A `prod-deps` stage to shrink `node_modules`: a separate improvement, already noted in
  `docs/docker.md`.

**Consequences.** Verified by building the image: `docker history` no longer has the
`chown` layer; inside the container `touch server.js` and `node_modules/x` fail with
`Permission denied`, and `.next/cache` and `/data/uploads` are writable; the stack starts
`healthy`, applies migrations and has no `EACCES`. The builder does not contain `backups`,
`uploads`, `test`, `scripts` or `.env`.

---

## 2026-09-24 — Container variables, CRON_SECRET, trusted proxies and HTTPS

**Context.** The `app` service in `docker-compose.yml` only receives the variables in
`environment:`, and `CRON_SECRET` was not there: in Docker the reminders always returned
503. The new variables from other changes (`TRUSTED_PROXY_HOPS`, `ORGTABLE_TIMEZONE`) would
not get through either. The documentation trusted `X-Forwarded-For` for the login limit,
told users to complete the wizard over `http://IP:3000` without any warning, and left
`SESSION_SECRET=changeme` (8 characters, below the minimum of 16).

**Decision.**
- `docker-compose.yml` passes `CRON_SECRET` (empty by default = 503),
  `TRUSTED_PROXY_HOPS` (0 by default) and `ORGTABLE_TIMEZONE` (`Atlantic/Canary`). CI
  checks with `docker compose config` that they get through.
- `install.sh` generates `CRON_SECRET` on new installations and adds it to the `.env` of
  existing ones if missing; at the end it warns that over HTTP everything travels
  unencrypted.
- The port is still published on all interfaces by default. To publish it only locally,
  `APP_PORT=127.0.0.1:3000` is documented, which the compose interpolation already
  supports, with no new variable.
- HTTPS is documented as a recommendation (not a requirement): the session cookie is
  `Secure` when the request arrives over HTTPS or with `X-Forwarded-Proto: https`. Caddy
  and nginx examples (`X-Forwarded-For $remote_addr`), `TRUSTED_PROXY_HOPS=1` and a warning
  that Docker bypasses `ufw`.
- `docs/installation.md` is the single reference for variables; `.env.example`,
  `docs/docker.md` and the README point to it.

**Alternatives considered.**
- `env_file: .env` on the service: it would put every variable into the container,
  including `POSTGRES_PASSWORD` and the ones it does not need.
- Publishing the app on `127.0.0.1` by default (or an `APP_BIND` variable): it breaks
  whoever currently connects through `IP:3000`; the owner decided.
- `SESSION_COOKIE_SECURE`: rejected by the owner in favor of detecting HTTPS.

**Consequences.** After updating, the container must be recreated (`docker compose up -d`)
so it sees the new variables. Anyone with `CRON_SECRET` in their `.env` starts receiving
reminders as soon as they schedule the cron. The behavior of `TRUSTED_PROXY_HOPS`,
`ORGTABLE_TIMEZONE` and the `Secure` cookie depends on code from other changes in this same
review.

---

## 2026-09-24 — Reliable backups, restore and update

**Context.** `scripts/backup.sh` used `sh` without `pipefail`: if `pg_dump` failed, an
empty `.sql.gz` was left and the script announced "✓ Backup completed". From cron
(directory `$HOME`) it failed every night without anyone noticing, silently skipped the
attachments and left the backups world-readable (644). `restore.sh` loaded the dump without
`--clean` or `ON_ERROR_STOP` onto an already migrated schema: it mixed data and still said
"✓". `update.sh` migrated production without a prior backup.

**Decision.**
- The three scripts move to `bash` with `set -euo pipefail` and change to the repository
  root, so they work from any directory.
- `backup.sh`: `umask 077` (files 600, default directory 700); it writes to `.partial` and
  only renames if the gzip is valid, not empty and contains the final marker of `pg_dump`.
  `pg_dump --clean --if-exists`. Attachments are read with `exec` if the app is running or
  with an ephemeral container (`run --rm --no-deps`) if not; they are only skipped if
  `/data/uploads` does not exist (exit code 3), any other failure aborts.
- `restore.sh`: validates the file before asking, makes a prior backup with `backup.sh` in
  `backups/pre-restore-<fecha>`, stops the app and loads
  `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` + the dump in a single transaction
  with `ON_ERROR_STOP`. It also works for older dumps without `--clean`.
- `update.sh`: `docker compose up -d --wait postgres` and `backup.sh` before the
  `git pull`; if the backup fails, it does not update.
- Tests in `test/ops-scripts.test.ts` with a fake `docker` on the `PATH`, and `shellcheck`
  in CI.

**Alternatives considered.**
- Keeping POSIX `sh`: it has no `pipefail`, which is exactly what was missing.
- Restoring only with `--clean`: it does not fix the dumps already made without it.
- `chmod 700` on any destination the user passes: with `/tmp` (or cron as root) it would
  break the system. It is only forced on the default directory; a new one is already
  created as 700 because of the umask.
- Skipping attachments if the app is stopped: that is the silent failure this set out to
  remove.

**Consequences.** Verified with real Docker (a throwaway compose project): a backup from
`$HOME` with umask 022 gives 700/600; with Postgres stopped it exits with code 1 and no
files; restoring brings the data back and removes foreign tables; a nonexistent or corrupt
file exits with 1 without touching anything; the attachment restore procedure in
`docs/operations.md` works. Old backups stay at 644: the documentation gives the `chmod` to
lock them down. `update.sh` was not tested against a real remote (only with the test
fakes).
## 2026-09-24 — Board interface: dragging, dates, keyboard and mobile

**Context.** A card due today showed in red (the UTC midnight instant was compared with
`Date.now()`) while the "Overdue" filter excluded it, and the date was formatted in the
local time zone: west of UTC it showed the previous day and broke hydration. Cards could
not be opened with the keyboard and, without edit permissions or with filters active,
they did not even receive focus. The filter chips did not expose their state, unselected
labels had ~2.2:1 contrast and the add list/card fields only had a placeholder. A list's
✕ deleted it with all its cards on the first click, right next to the drag handle.
Reordering lists by dragging almost never worked (`over` turned out to be a card), Escape
left the card in another list without saving it, the result of
`moveCard`/`reorderList`/`setCardDueDate` was ignored, and the calendar could not be used
with the keyboard nor did it show the chip under the pointer. The `?card=` deep-link did
not open the card if you were already on that board: the modal was initialized only once
with `useState(initialCardId)` and Next does not remount the component when only the
searchParams change.

**Decision.**
- `isOverdue(dueDate, now)` in `app/lib/board-filters.ts`: compares the stored day
  (`slice(0,10)`) with the local day; both the filter and the card use it.
- `formatDueDay` with `Intl.DateTimeFormat('es-ES', { timeZone: 'UTC' })`: the due date
  is a calendar date.
- "Overdue" depends on the browser's day, so the card only computes it after hydration
  (`useSyncExternalStore`); in the server HTML it never shows in red.
- The card is always `role="button"` and `tabIndex=0` (the floating copy,
  `tabIndex=-1`). No `aria-label`: the accessible name comes from the content (labels,
  title, due date, subtasks, counters) and "overdue" is added as `sr-only` text, because
  the red is only visual. Enter opens it; Space does too when it cannot be dragged.
- `aria-roledescription` in Spanish ("tarjeta", "lista") instead of dnd-kit's
  "sortable".
- Filters: `type="button"`, `aria-pressed` and groups labeled by their title. Unselected
  label: ink text with a border in the label color; selected: filled with a ✓ and a ring.
- `aria-label` on the fields: "Name of the new list" and "New card in <list>".
- Filter popover anchored to the left at any width (`left-0`): "Filter" is the first
  button of its group and the 288 px always fit to its right. Anchored to the right it
  overflowed on the left at 375 px, and also around 768 px with a long title, when the
  header wraps onto two rows.
- Deleting a list asks for a second inline click ("Delete? Yes / No", focus goes to
  "No"), without `window.confirm`.
- `boardCollisionDetection` (`app/lib/board-collision.ts`): `closestCorners` filtered to
  lists when a list is being dragged; `handleDragEnd` also maps a card to its list.
- `KeyboardSensor` with Space to pick up and Space/Enter to drop (Enter does not pick up,
  it is kept for opening). Lists use `boardKeyboardCoordinates` (jumps to the neighboring
  column) and the calendar uses `calendarKeyboardCoordinates` (neighboring day or week).
  Instructions and announcements in Spanish.
- Snapshot of the lists when dragging starts: it is restored on Escape, when dropping
  outside, or if the action fails. `persistOptimistic` (`app/lib/optimistic.ts`) rolls
  back on `{ ok: false }` or an exception, calls `router.refresh()` and rethrows Next's
  redirects (`unstable_rethrow`). On the board a `role="alert"` message appears in the
  header ("Could not move the card. Try again." / "...the list..."); the message is
  cleared when the next drag starts.
- Board title truncated (`min-w-0 truncate`) so a long name does not overflow on mobile.
- Calendar: `DragOverlay` with the chip, a stable `id` and a "Could not change the date.
  Try again." message with `role="alert"` if the server does not save.
- The open card is derived from `useSearchParams()`. Opening and closing change `?card`
  with `window.history.replaceState` (Next syncs it without requesting the page); closing
  always removes it. The board page no longer reads `searchParams`.

**Alternatives considered.**
- Formatting in the server's time zone (`ORGTABLE_TIMEZONE`): the due date is not an
  instant, it is a day, and in UTC it shows the same everywhere.
- A separate drag handle inside the card: adds one more control; Space to pick up and
  Enter to open is enough.
- `window.confirm`: blocks the page and does not match the app's style.
- `useOptimistic`: would require restructuring the drag state; the snapshot solves the
  same problem with fewer changes. Rolling back silently: the card went back to its place
  with no explanation, and the calendar already showed a message.
- An `aria-label` with only the title on the card: it hid the due date, the "overdue"
  state and the counters. Anchoring the popover to the right only at `lg`: depends on the
  header not wrapping, which varies with the title length.
- `router.replace` with `?card`: every opening would request the page from the server.
  Syncing `initialCardId` during render: it would still not open the same notification
  twice.

**Consequences.** Tests in `test/board-filters.test.ts` (due today/yesterday, formatting
with `TZ=America/New_York`). Server render test (`test/card-item.test.ts`) for role,
focus, accessible name from the content (no `aria-label`) and absence of "overdue" in the
initial HTML. The failed-move message has no automated test (it needs a Server Action
failure in a real DOM); `persistOptimistic` calls `onFailure`, and that is tested. No
automated test (there is no DOM environment); manual verification pending. Tests with
synthetic rectangles in `test/board-collision.test.ts` (including the failure of plain
`closestCorners`) and of `persistOptimistic` in `test/optimistic.test.ts`. Real dragging
with mouse and keyboard remains to be verified by hand in the browser. Touches
`app/(app)/board/[id]/page.tsx` (outside the batch) to remove the `initialCardId` prop.
Manual verification pending.

---

## 2026-09-24 — Content-Security-Policy with nonce, and HSTS

**Context.** The security rule requires CSP, HSTS, X-Content-Type-Options and
Referrer-Policy. Only the last two were present (plus `X-Frame-Options` and
`Permissions-Policy`, which also included `interest-cohort`, a directive browsers no
longer recognize and which cluttered the console).

**Decision.**
- CSP generated in `proxy.ts` with a random nonce per request (`app/lib/csp.ts`, the
  pattern from the Next 16 CSP guide). Every page was already dynamic (session), so the
  nonce does not change rendering.
- `style-src-attr 'unsafe-inline'`: React renders `style` attributes from the server
  (board background, dnd-kit) and the nonce does not cover attributes. `<style>` elements
  do require the nonce in production.
- In development, `'unsafe-eval'` and inline styles without a nonce (Turbopack and the
  overlay inject `<style>` without it).
- `/api/**` gets `default-src 'none'; frame-ancestors 'none'` from `next.config.ts`.
- HSTS `max-age=31536000` without `includeSubDomains` or `preload`.
- `interest-cohort` is removed from `Permissions-Policy`.

**Alternatives considered.**
- Static CSP with `'unsafe-inline'` for scripts: does not protect against XSS.
- Hashes instead of a nonce: Next's hydration scripts change on every response.
- `upgrade-insecure-requests`: breaks installs reached through `http://IP:3000`, which is
  how the first start is documented.
- HSTS with `includeSubDomains`/`preload`: would force HTTPS on sibling domains of the
  person installing it.

**Consequences.** Verified with Playwright against `pnpm build && pnpm start`: zero CSP
violations on the board, calendar, settings, administration and search; the theme script
runs (`dark` class applied) and SSE realtime keeps working. Any future third-party script
will need the nonce (`x-nonce`).

---

## 2026-09-24 — Board: double submit, hydration and keyboard dragging

**Context.** While testing in the browser, two identical lists were created 48 ms apart
(repeated Enter), the console showed a dnd-kit hydration error (`aria-describedby`
differing between server and client) and cards could only be moved with the mouse.

**Decision.**
- `AddListForm`/`AddCardForm`: a `pending` ref discards submissions while the previous
  action has not finished (`preventDefault` in `onSubmit`; React does not run the action
  of a form whose event was cancelled).
- `DndContext` gets `id={useId()}`, stable between server and client.
- `KeyboardSensor` is added with `sortableKeyboardCoordinates`.

**Alternatives considered.**
- `useActionState`/`useFormStatus` to disable the field: the pending state arrives on the
  next render and a second Enter in the same tick slips through; disabling the input also
  takes its focus away.
- Deduplicating on the server by title: two lists with the same name are legitimate.

**Consequences.** Verified with Playwright: three Enters in a row create a single list and
the console stays free of errors. With the keyboard: Tab to a card, Space to pick it up,
arrows to move it and Space to drop it (Escape cancels).

---

## 2026-09-24 — Interface: mobile at 375 px and switcher contrast

**Context.** At 375 px every page of the signed-in area overflowed 76 px horizontally (the
top bar did not fit) and the board header pushed "Members" off screen. In dark mode the
active option of the Board/Calendar switcher was light text on a white background. The
board background did not reach the bottom of the screen and the calendar showed
"Septiembre De 2026".

**Decision.**
- Top bar: on mobile "Administration" becomes an icon with `aria-label`, the instance name
  is truncated and gaps are reduced.
- Board header with `flex-wrap`.
- The active option uses `bg-surface text-ink` (theme tokens) instead of a fixed white.
- The signed-in area container uses `flex-1` (`min-h-full` did not resolve inside the flex
  `body`).
- The calendar month uses `first-letter:uppercase` instead of `capitalize`, which
  capitalised every word.

**Alternatives considered.** A hamburger menu on mobile: switching to icons is enough and
does not add a new component.

**Consequences.** Verified with Playwright at 375 px (0 overflow on `/boards`, board,
`/settings`, `/admin/users`, `/admin/audit` and `/search`) and at 1440 px in dark mode.

---

## 2026-09-24 — Dependency upgrades for security

**Context.** After moving to pnpm, `pnpm audit` reported 63 advisories (2 critical and 30
high), most of them in `next` 16.2.7 and in transitive dependencies of Prisma, ESLint and
Vitest.

**Decision.**
- Upgrade everything within its major version: `next`/`eslint-config-next` 16.3.6, Prisma
  7.10.0, React 19.3.0, zod 4.6.5, pg 8.23.0, jose 6.2.12, Tailwind 4.3.3, Vitest 4.1.11
  and types. The ranges in `package.json` now require those minimum versions.
- `overrides` in `pnpm-workspace.yaml` for transitive dependencies with a patch in the same
  major: `brace-expansion` 5.0.12, `browserslist` 4.28.7 and `mysql2` 3.23.1.
- `GHSA-ggr8-5vv4-36mx` is ignored (`deepmerge-ts` <8 inside `@prisma/config`): it only
  merges the local configuration from `prisma.config.ts`, not user input, and the patch
  requires a major version that Prisma 7.10 does not support.

**Alternatives considered.**
- Major upgrades (TypeScript 7, ESLint 10, Vitest 5, Prisma 8, `@types/node` 26,
  `fractional-indexing` 4): they go in separate commits after reading their changelogs;
  they fix none of the advisories.
- Forcing `deepmerge-ts` 8 with an override: it would change a major version inside the
  CLI that applies the migrations on every container start, for a risk with no real attack
  vector.

**Consequences.** `pnpm audit` is clean (1 ignored and documented). When upgrading `next`,
`prisma` or `eslint-config-next`, check whether the overrides are still needed.

---

## 2026-09-24 — Migration from npm to pnpm

**Context.** pnpm becomes the standard for the projects (lockfile always committed, never
`package-lock.json`). The repo used npm locally, in CI and in the `Dockerfile`.

**Decision.**
- `pnpm import` generated `pnpm-lock.yaml` from `package-lock.json`, so the resolved
  versions do not change in this step. `package-lock.json` is deleted.
- `packageManager: pnpm@11.24.0` in `package.json`: Corepack (Docker) and
  `pnpm/action-setup` (CI) install exactly that version.
- pnpm 11 does not run install scripts except the allowed ones. `pnpm-workspace.yaml` has
  `allowBuilds` with `@prisma/engines` and `prisma` set to `true` (they download the
  schema-engine used by `migrate deploy`) and `sharp` and `unrs-resolver` set to `false`
  (they ship prebuilt binaries through optional dependencies; their script is only a
  fallback).
- CI moves to Node 22 (same as the Docker image) and adds `pnpm audit --prod
  --audit-level high`.
- The `Dockerfile` adds a `base` stage with `corepack enable`; the other stages keep their
  structure.

**Alternatives considered.**
- `node-linker=hoisted` to mimic npm's flat tree: not needed; the standalone build and the
  Prisma CLI work with pnpm's isolated layout.
- Installing pnpm with `npm i -g` in the image: Corepack already ships with `node:22` and
  honors the pinned version.
- Approving every build script (`--all`): needlessly widens the supply-chain attack
  surface.

**Consequences.** Use `pnpm` instead of `npm`/`npx` (documentation updated). A new
dependency with an install script must be added to `allowBuilds`, or pnpm will warn with
`ERR_PNPM_IGNORED_BUILDS`.

## 2026-10-15 — A context menu of our own inside boards

**Context.** Inside a board a right click showed the browser's menu, which offers nothing
for the board. The owner asked that a right click there mean "options for this": the
background, quick actions on lists and cards.

**Decision.**
- A menu of our own on the board, its lists and its cards, built from a list of entries
  (`board-menu.tsx`) and drawn by one component (`context-menu.tsx`) as a popover with
  flyout submenus or, on touch, as a bottom sheet with drill-in submenus.
- Only what the viewer's role allows is listed; the server checks every action again.
- The browser's menu stays reachable: Shift + right click, and any right click on a field,
  a link or selected text.
- Touch opens it with a half-second long press (iOS fires no `contextmenu`); the press
  cancels a pending card drag and the finger's lift is not a tap on the sheet.
- Two board colours (Slate, Ink) can be chosen by hand, but `pickBoardColor` keeps its
  original six, so no existing board, avatar or team changes colour.
- Duplicating a card copies its content (description, date, labels, checklists), not its
  attachments, comments or assignees: the copy is new work.

**Alternatives considered.**
- A menu library (Radix, Floating UI): one more dependency for a component of about 400
  lines that also needs our sheet variant.
- Greying out what the role forbids: noise for viewers, who could do nothing with it.

**Consequences.** `renameBoard` changed signature (object in, new path out), since the
slug follows the title and the page must move. New actions: `setBoardBackground`,
`duplicateCard`, `sortListByDue`, `moveAllCardsTo`. See `docs/board-menu.md`.

