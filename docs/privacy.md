# Privacy, open sign-up and GDPR

How orgtable handles personal data and what the operator of an instance has to do,
whether it is the official instance or a self-hosted one. The legal pages users see
(`/legal/*`) are generated from this behavior and from the details the admin enters in
**Admin › Instance**. This document is their technical reference.

> The app's legal texts describe what the code does, but they are not legal advice. If
> you open sign-up to the public, have a professional review them with your real details.

## Who the data controller is

The data controller is **whoever operates the instance**, not the author of the software.
Each instance states its own in `/admin/instance`:

| Field | Required | Where it appears |
|---|---|---|
| Controller (name or company name) | To open sign-up | Privacy, terms, legal notice and the sign-up form |
| Contact email | To open sign-up | Privacy, terms, legal notice |
| Tax ID (NIF) | No | Legal notice (art. 10 of the Spanish LSSI, if it applies) |
| Postal address | No | Legal notice |
| Where the data is hosted | No, but recommended | Privacy: the provider acts as data processor |
| Backup retention in days | No (0 = you make no backups) | Privacy. It must match your actual rotation (`scripts/backup.sh`) |

Anything left empty appears as "not provided by the operator": the pages never make up
data. Every time a legal detail changes, `legalUpdatedAt` becomes the "last updated" date
of the pages.

## Open sign-up

It is **closed by default**: on a private instance the admin creates the accounts. It is
opened in `/admin/instance`, and only when the controller and the contact email are set.
The server checks this again on every sign-up (`isRegistrationOpen()`): if someone empties
those fields, sign-up closes automatically.

At `/register`:

- **Informed consent.** A required checkbox, unchecked by default, with links to the
  privacy policy and the terms. The date is stored in `User.termsAcceptedAt`. Next to the
  button there is a short first-layer notice: controller, purpose and rights.
- **New accounts are MEMBER.** Nobody can sign up as an admin.
- **Anti-abuse, without third parties**:
  - An invisible trap field (honeypot).
  - 5 sign-ups per hour per IP, only with `TRUSTED_PROXY_HOPS > 0`.
  - 30 sign-ups per hour across the whole instance. During a bot wave, real people cannot
    sign up either until the hour has passed; it shows up in the audit log as
    `auth.register_rate_limited`.
- **No email verification.** It needs SMTP, which is still on the
  [roadmap](./roadmap.md). That is why the form says whether an email already has an
  account. The sign-up limit slows down mass enumeration.

## What is stored and for how long

| Data | Legal basis | Retention |
|---|---|---|
| Account: name, email, bcrypt hash, role, `termsAcceptedAt`, interface language | Contract (6.1.b). For the acceptance date, legitimate interest in being able to prove it (6.1.f) | Until the account is deleted |
| Profile photo (optional), a 256 px square file on disk | Consent: the person uploads it and can remove it (6.1.a) | Until removed or the account is deleted |
| Content: boards, lists, cards, comments, assignments, attachments | Contract (6.1.b) | Until deleted |
| Sessions: user agent, dates | Contract (6.1.b) | Valid for 7 days; once closed or expired, 30 more days |
| Notifications | Contract (6.1.b) | 180 days |
| API tokens: name, prefix, hash | Contract (6.1.b) | Until revoked or the account is deleted |
| Audit log: security events, with IP if `TRUSTED_PROXY_HOPS > 0` | Legitimate interest in security (6.1.f) | `ORGTABLE_AUDIT_RETENTION_DAYS`, 90 days by default |

The retention periods come from constants in the code (`app/lib/services/maintenance.ts`
and `SESSION_MAX_AGE_DAYS` in `app/lib/session.ts`). The privacy policy reads them from
there, so it cannot drift out of sync.

### Profile photo

Optional, from *Settings › Profile*. The browser crops the chosen image to its centre square
and shrinks it to 256 px before sending it (WebP, or JPEG where the browser cannot encode
WebP), so the original photo, with its EXIF data and GPS position, does not reach the server
from the app. The server does not re-encode what it gets (a request made by hand is stored as
sent). It takes PNG, JPEG or WebP read from the bytes (never SVG) up to 512 KB, stores it
next to the attachments (`avatar-<uuid>.<ext>`) and serves it from `/api/users/<id>/avatar`
only to the person and to whoever shares an organization or a board with them
(`canSeeAvatar` in `app/lib/services/avatars.ts`); anyone else gets a 404. Removing it, or
deleting the account, deletes the file.

### Periodic cleanup

Data is purged by `POST /api/cron/maintenance`, protected with the same `CRON_SECRET` as
the reminders. **Schedule it once a day**; without it, the periods above are not met:

```bash
# host crontab, at 04:15
15 4 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://your-instance/api/cron/maintenance
```

It responds with what it deleted (`auditLogsDeleted`, `sessionsDeleted`,
`notificationsDeleted`). More operational details in [operations.md](./operations.md).

## Users' rights

Users exercise all of them on their own, from **Settings**:

- **Access and portability** (arts. 15 and 20). *Privacy and data › Download .json*
  (`GET /api/account/export`, only with a browser session, not with tokens). It includes:
  - the account (with whether there is a profile photo; the image itself is not in the JSON);
  - the boards the person owns, complete, with attachment metadata;
  - membership of other people's boards;
  - the person's own comments and assignments;
  - notifications, sessions and tokens (without hashes);
  - the person's audit entries.

  It never includes hashes or other people's data.
- **Rectification** (art. 16). *Profile*. Changing the email requires the current
  password.
- **Erasure** (art. 17). *Privacy and data › Delete my account*, with the password. It
  deletes:
  - the boards the person created, with their lists, cards and the attachment files on
    disk;
  - their profile photo file;
  - in cascade, their sessions, tokens, memberships, assignments, comments and
    notifications;
  - the `detail` of the audit rows that targeted them; those rows remain without a user.

  The last ADMIN account cannot be deleted. **Other** people's notifications may keep the
  person's name until they expire (180 days).
- **Objection and restriction**: through the controller's contact email.

## Cookies

Only strictly necessary technical storage (art. 22.2 of the Spanish LSSI), so there is no
banner:

- `session` cookie: HttpOnly, SameSite=Lax and Secure when it arrives over HTTPS. Lasts 7
  days.
- `locale` cookie: the interface language chosen with the language picker (footer of the
  public pages and Settings › Appearance). SameSite=Lax and Secure over HTTPS. Lasts one
  year.
- `localStorage.theme`: the theme preference; it never leaves the browser.

If you add analytics or any other third-party script, you will need a consent banner
**before** loading it, and you will have to extend the policy.

## Checklist for opening a public instance

1. HTTPS in front of the app ([self-hosting.md](./self-hosting.md)) and
   `TRUSTED_PROXY_HOPS` set, so the per-IP sign-up limit works.
2. `CRON_SECRET` and both cron jobs scheduled: reminders and maintenance.
3. Backups with a rotation that matches the "backup retention" field.
4. Complete legal details in `/admin/instance` and the texts reviewed by a professional.
5. If you modified the code, `ORGTABLE_SOURCE_URL` pointing to your fork: the AGPL
   requires offering it to whoever uses the app.
6. Open sign-up in `/admin/instance`.
