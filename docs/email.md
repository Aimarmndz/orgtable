# Email

Email is optional. Without it the instance works as before; with it, people can recover a
forgotten password and organizations invite their employees by email instead of making up a
password for them.

## Configuration

Three variables (`.env`, passed to the container by `docker-compose.yml`):

| Variable | Example | What it is |
| --- | --- | --- |
| `ORGTABLE_SMTP_URL` | `smtps://user:password@smtp.example.org:465` | The SMTP server. `smtp://…:587` uses STARTTLS. Empty = email off. |
| `ORGTABLE_MAIL_FROM` | `orgtable <no-reply@example.org>` | The sender. Its domain needs SPF and DKIM for the provider, or messages end up in spam. |
| `ORGTABLE_PUBLIC_URL` | `https://orgtable.example.org` | The instance's address, used in the links. Never taken from the request (the client controls the Host header). |

A value that is set but wrong stops the page with its reason instead of silently turning email
off. `ORGTABLE_SMTP_URL=memory://` keeps messages in memory instead of sending them: for tests
and local development only, refused in production.

## What is sent

All in the person's language, drawn like the landing page (a retro window, a terracotta button,
a phosphor terminal line) with a plain-text version (`app/lib/mail/templates.ts`):

- **Reset your password** (`/forgot-password`): a link valid for 60 minutes.
- **Your password was changed**: after a reset, so the owner notices if it was not them.
- **Invitation** (an organization creates an account): a link valid for 7 days to choose the
  password. The account starts with a random password nobody knows; the organization can still set a new one later (it controls the accounts it creates).

## Links

`AccountToken` (`app/lib/services/account-tokens.ts`): 32 random bytes, only their SHA-256 is
stored. A new link replaces the account's previous one of the same kind. Using a link deletes it
in the same statement that checks it (single use, even with two simultaneous submissions), sets
the password, closes every session, revokes every API token and deletes the account's other
links. Expired links are deleted by `POST /api/cron/maintenance`.

`/forgot-password` answers the same whether the address has an account or not, and is limited
to 3 requests per address and 10 per IP an hour (200 for the whole instance).
