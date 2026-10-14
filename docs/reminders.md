# Due-date reminders

orgtable notifies the people assigned to a card when it is **due soon** (within the next
24 h) or has **just become overdue**. The technical decision is in
[ADR 0015](./decisions/0015-reminders-cron.md).

## How it works

- An endpoint, `POST /api/cron/reminders`, runs the pass. It creates in-app notifications
  (`due.reminder`) for each assignee of each card in the window, with a **deep-link** to
  the card. It can be called several times without duplicating notices:
  - **Due soon** (due today or within the next 24 h): at most one notice per day per card
    and person.
  - **Overdue**: a **single** notice after the due date, and only if it became overdue in
    the **last 7 days**. A card forgotten months ago does not notify every day or bloat
    the pass.
- Only assignees who **are still board members** are notified (removing someone deletes
  their assignments; see [docs/card-collaboration.md](./card-collaboration.md)).
- **Days are counted in UTC**, not in the server's time zone: `dueDate` is a calendar date
  (`YYYY-MM-DD`) stored at midnight UTC. A card becomes overdue when the UTC day after its
  due date begins, and the date in the notice is formatted in UTC so it matches the date
  that was picked.
- The logic lives in `app/lib/services/reminders.ts` (`generateDueReminders`).

## Enabling it

1. Set a secret in the environment (disabled if it is missing):

   ```bash
   CRON_SECRET=$(openssl rand -hex 32)
   ```

   With Docker, add it to the `.env` read by `docker compose` and re-create the container
   so it picks it up (a `restart` does not re-read the environment):

   ```bash
   docker compose up -d
   ```

2. Schedule a periodic call (e.g. daily) from an **external cron**, sending the secret as
   a Bearer token:

   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
        https://your-instance/api/cron/reminders
   ```

   Example crontab entry (every day at 8:00):

   ```cron
   0 8 * * * curl -fsS -X POST -H "Authorization: Bearer XXXX" https://your-instance/api/cron/reminders
   ```

Responses: `200 {"created":N,"scanned":M}` on success (`created` only counts the
notifications that were actually saved; `scanned`, the cards in the window); `401` if the
secret does not match; `503` if `CRON_SECRET` is not set. All three cases are covered in
`test/integration/cron-reminders.int.test.ts`.

## Security

- The secret is compared in **constant time** (`crypto.timingSafeEqual`) so response
  timing leaks nothing.
- The endpoint exposes no data: it only triggers notification generation.

## Rescheduling from the calendar

As a complement, in the **calendar view** you can **drag** a card to another day to
change its due date (with edit permission). It uses a focused `setCardDueDate` action
that only touches the date. See [`docs/calendar.md`](./calendar.md).

## Limits and possible improvements (backlog)

- **Email / Web Push**: reminders are in-app today. They would fit as another consumer of
  `notify()` (optional SMTP through environment variables), without changing this design.
- **Per-user preferences** (what to notify and through which channel): a natural
  extension.
