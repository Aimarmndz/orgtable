# Operations and security

This guide covers the operational features of orgtable: login rate limiting, the audit
log, backups, board export/import and the update flow. For general production setup
(reverse proxy, TLS), see [`docs/self-hosting.md`](./self-hosting.md).

## Login rate limiting

Login is protected against brute force with two limits:

- **Per IP: up to 10 attempts every 10 minutes**, only when the client IP can be trusted
  (see below).
- **Per email: 20 failed attempts every 15 minutes**. Only failures count, and the counter
  resets after a successful login.

Once a limit is exceeded, the form shows a message with a waiting time, and the attempt is
recorded in the audit log (`auth.login_rate_limited`).

The implementation ([`app/lib/rate-limit.ts`](../app/lib/rate-limit.ts)) is **in memory**
(a fixed-window counter), with no Redis or external dependencies. It is the right choice
for the standard single-instance deployment. The decision is in
[ADR 0009](./decisions/0009-in-memory-rate-limit.md).

**Where the IP comes from: `TRUSTED_PROXY_HOPS`.** Anyone can write the
`X-Forwarded-For` header, so the app only trusts it when told how many of your own proxies
sit in front of it:

| `TRUSTED_PROXY_HOPS` | Behaviour |
| --- | --- |
| `0` (default) | `X-Forwarded-For` is ignored. There is no per-IP limit; only the per-email limit applies. |
| `N > 0` | The N-th IP of `X-Forwarded-For`, counting from the right, is used. With a single reverse proxy (Caddy or nginx), use `1`. An IP with a port (`1.2.3.4:5678`, `[2001:db8::1]:443`) is accepted and the port is dropped. If the header is missing, has fewer than N values or the selected value is not an IP, that request has no per-IP limit (only the per-email one) and `AuditLog.ip` stays empty; the log prints a `[client-ip] TRUSTED_PROXY_HOPS=N but …` warning with the reason and the number of values (no IPs), once per reason and process. |

With `N > 0`, the app port must not be reachable without going through the proxy: anyone
reaching it directly can forge the header. How to set it up:
[self-hosting.md](./self-hosting.md#https-and-domain-reverse-proxy).

> **Multiple instances:** counting is per replica. With N replicas the effective limit is
> N×10. A global shared limit would need a common store (`LISTEN/NOTIFY` does not help
> here; it would be a Postgres table or Redis). This is not the default setup and is left
> as a future improvement.

## Audit log

orgtable stores one row per relevant security or operational event in the `AuditLog`
table ([`app/lib/audit.ts`](../app/lib/audit.ts)). The administrator reviews them at
**`/admin/audit`** (the 200 most recent).

Recorded events:

| Area | Actions |
| --- | --- |
| Authentication | `auth.login`, `auth.login_failed`, `auth.login_rate_limited`, `auth.logout` |
| Setup | `setup.completed` |
| Users | `user.created`, `user.deleted`, `user.role_changed`, `user.password_reset`, `user.sessions_revoked` |
| Boards | `board.created`, `board.deleted` |
| Members | `member.added`, `member.removed`, `member.role_changed` |

Each row stores who (user, optional), the IP, the target (`targetType`/`targetId`), a
detail and the timestamp. `userId` is **optional with `onDelete: SetNull`**: deleting an
account does not delete its audit trail. Logging is *best-effort*: a failure to write the
log never makes the originating operation fail.

## Backups

There are two things to back up: the **database** (PostgreSQL) and the **attachments**
(disk volume). The [`scripts/backup.sh`](../scripts/backup.sh) script does both:

```sh
scripts/backup.sh [destination_dir]   # default: ./backups
```

It writes two timestamped files:

- `orgtable-db-<date>.sql.gz`: a compressed `pg_dump --clean --if-exists` dump.
- `orgtable-uploads-<date>.tar.gz`: the attachments from the `/data/uploads` volume.

How it behaves:

- It can be run from any directory: it moves to the installation root by itself.
- If anything fails (Postgres stopped, empty or truncated dump, unreadable attachments),
  it exits with a non-zero code, reports it on standard error and leaves no partial
  files. It only prints `✓ Backup completed` when the backups are good.
- Attachments are skipped only if `/data/uploads` does not exist. If the app is stopped,
  they are read through a short-lived container that mounts the same volume.
- **Backups contain personal data** (emails, password and token hashes, comments). The
  script creates the `backups/` directory with `700` permissions and the files with
  `600`. Backups made with older versions of the script may be readable by other users on
  the server; lock them down once:

  ```sh
  chmod 700 backups && chmod 600 backups/*.gz
  ```

Automate backups with a system `cron` and keep copies off the server. Use absolute paths,
because cron starts in `$HOME`. For example, every day at 3:30 (`crontab -e`):

```cron
30 3 * * * /home/user/orgtable/scripts/backup.sh >> /home/user/orgtable-backup.log 2>&1
```

The log lives outside `backups/` on purpose: cron opens the redirection before running the
script, and on a fresh installation that directory does not exist yet (the script creates
it), so cron would fail without ever starting the backup. If the script fails, the error
ends up in that log; check it, or set `MAILTO` in the crontab to receive it by email.

### Restore

To **restore** the database (⚠️ replaces all current data):

```sh
scripts/restore.sh backups/orgtable-db-<date>.sql.gz
```

The script:

1. Checks that the file exists, is a valid gzip and that the dump is complete. If not, it
   exits without touching anything.
2. Asks for confirmation.
3. Makes an **automatic safety backup** in `backups/pre-restore-<date>/` with
   `scripts/backup.sh`. If that backup fails, it stops.
4. Stops the app while restoring and, if it was running, starts it again at the end.
5. Empties the schema and loads the dump in **a single transaction** with `ON_ERROR_STOP`:
   if anything fails, nothing is applied and the database stays as it was. It also works
   with older dumps made without `--clean`.

On startup, the app applies any missing migrations if the dump comes from an older
version.

The script does not restore attachments. ⚠️ Restoring them **replaces all current
attachments**. From the installation root, in this order:

1. **Check the archive** before touching anything. If either command fails (backup
   truncated when copied back, wrong path), stop here:

   ```sh
   gzip -t backups/orgtable-uploads-<date>.tar.gz
   tar tzf backups/orgtable-uploads-<date>.tar.gz > /dev/null
   ```

2. **Back up what is there now**, in case you need to roll back:

   ```sh
   scripts/backup.sh backups/pre-restore-uploads-<date>
   ```

3. **Restore with the app stopped.** The archive is first extracted to a temporary
   directory inside the volume itself, and the current attachments are only replaced if
   `tar` succeeds. It has to be inside the volume because `/data/uploads` is its mount
   point: it cannot be deleted or renamed, only its contents.

   ```sh
   docker compose stop app
   docker compose run --rm --no-deps -T --entrypoint sh app -c '
     set -e
     rm -rf /data/uploads/.restore
     mkdir /data/uploads/.restore
     tar xzf - -C /data/uploads/.restore
     test -d /data/uploads/.restore/uploads
     find /data/uploads -mindepth 1 -maxdepth 1 ! -name .restore -exec rm -rf {} +
     find /data/uploads/.restore/uploads -mindepth 1 -maxdepth 1 -exec mv {} /data/uploads/ \;
     rm -rf /data/uploads/.restore
   ' < backups/orgtable-uploads-<date>.tar.gz
   docker compose start app
   ```

If the restore fails halfway, the current attachments remain intact and only the
temporary directory `/data/uploads/.restore` is left behind; the next attempt deletes it
first. Start the app anyway with `docker compose start app`.

## Board export and import

Separately from whole-instance backups, each board can be **exported to a portable JSON
file** and **imported** again (on the same instance or another one):

- **Export:** the download icon of each board in the board gallery
  (`GET /api/boards/[id]/export`). It includes lists, cards, descriptions, dates, labels
  and checklists. It does **not** include attachment files.
- **Import:** the "Import a board from JSON" section of the gallery. It creates a **new** board owned by
  you, with regenerated identifiers and positions.

Implementation: [`app/api/boards/[id]/export/route.ts`](../app/api/boards/[id]/export/route.ts)
and the `importBoard` Server Action in
[`app/lib/actions/boards.ts`](../app/lib/actions/boards.ts).

## Scheduled tasks

These endpoints must be called by an **external** cron (ADR 0015), with `CRON_SECRET` from
`.env` as a `Bearer` token. Without `CRON_SECRET` they answer 503; with a wrong secret,
401.

| Endpoint | Frequency | What it does |
|---|---|---|
| `POST /api/cron/reminders` | Every hour | Reminders for cards that are due soon or overdue ([reminders.md](./reminders.md)). |
| `POST /api/cron/maintenance` | Once a day | Deletes audit entries older than `ORGTABLE_AUDIT_RETENTION_DAYS` (90 by default), sessions closed or expired more than 30 days ago, notifications older than 180 days and finished webhook deliveries older than 30 days. These are the retention periods promised by the privacy policy ([privacy.md](./privacy.md)). |
| `POST /api/cron/backups` | Every hour | Scheduled backups of each organization and of the instance, at their own hour and time zone ([backups.md](./backups.md)). |
| `POST /api/cron/webhooks` | Every minute | Retries webhook deliveries that failed ([webhooks.md](./webhooks.md)). Events are sent at once when they happen; without this job only the retries wait. |

```cron
# host crontab; loads CRON_SECRET from the installation's .env
0 * * * *  . /opt/orgtable/.env && curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/reminders
15 4 * * * . /opt/orgtable/.env && curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/maintenance
5 * * * *  . /opt/orgtable/.env && curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/backups
* * * * *  . /opt/orgtable/.env && curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3000/api/cron/webhooks
```

Adjust the `.env` path and the port (`APP_PORT`) to your installation.

## Updates

The app image is built locally, so updating means pulling the changes and rebuilding. The
[`scripts/update.sh`](../scripts/update.sh) script does that:

```sh
scripts/update.sh
```

The script, in this order:

1. Starts Postgres if it was not running and makes a **backup** with `scripts/backup.sh`
   (stored in `backups/`). If the backup fails, it does not update.
2. Pulls the changes (`git pull --ff-only`).
3. Rebuilds and restarts (`docker compose up -d --build`).

**Database migrations are applied automatically** on startup: `docker-entrypoint.sh` runs
`prisma migrate deploy` before starting the server. That is why the backup comes first: if
a migration goes wrong, you can go back with `scripts/restore.sh`. A
`docker compose up -d --build` run by hand does **not** make that backup.
