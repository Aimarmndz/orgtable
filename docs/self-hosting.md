# Self-hosting: running orgtable in production

This guide covers the day-to-day running of an orgtable instance that is already installed
(see [installation](./installation.md)). Everything revolves around the
`docker-compose.yml` and the `.env` generated during installation.

## Basic commands

From the installation directory (`~/orgtable` by default):

```bash
docker compose ps               # service status
docker compose logs -f app      # live app logs
docker compose logs -f postgres # database logs
docker compose restart app      # restart the app only
docker compose down             # stop everything (data persists in the volume)
docker compose up -d            # start again
```

## Updating to a new version

The image is built locally, so updating means fetching the new code and rebuilding. A
script does it for you:

```bash
cd ~/orgtable
scripts/update.sh        # backup, git pull --ff-only and docker compose up -d --build
```

Pending database migrations are applied **automatically** when the container starts
(`prisma migrate deploy` in the entrypoint; it is idempotent). The script takes a backup
first and does not update if the backup fails; a manual `docker compose up -d --build`
does not take one. See [docker.md](./docker.md) and
[operations.md](./operations.md#updates).

## Backups

There are **two** things to back up: the database (`pgdata` volume) and the
**attachments** (`uploads` volume). The [`scripts/backup.sh`](../scripts/backup.sh)
script does both:

```bash
scripts/backup.sh                 # creates backups/orgtable-db-*.sql.gz and -uploads-*.tar.gz
scripts/restore.sh backups/orgtable-db-<date>.sql.gz   # restore the database
```

> Schedule `scripts/backup.sh` with a system `cron` job and keep copies off the server.
> Backups contain personal data. Full details (cron, permissions, restoring attachments,
> exporting/importing single boards) in
> [operations.md](./operations.md#backups).

## The `.env` file

It holds the instance secrets (PostgreSQL password, `SESSION_SECRET`). The installer
creates it with `600` permissions.

- **Do not delete it or change `POSTGRES_PASSWORD`** once the volume exists: PostgreSQL
  sets the password when the volume is first initialized, so changing it later causes
  authentication errors (you would have to recreate the volume and lose the data).
- If you change `SESSION_SECRET`, every active session is invalidated (users have to
  sign in again).

## HTTPS and domain (reverse proxy)

orgtable serves plain HTTP on `APP_PORT` (3000 by default). You can use it that way, for
example at `http://IP:3000` for the first start or on a local network, but **the password
and the session cookie travel unencrypted**. For real use, put it behind a reverse proxy
with TLS.

The session cookie gets the `Secure` attribute when the request arrives over HTTPS:
directly, or with the `X-Forwarded-Proto: https` header added by the proxy. Over plain
HTTP it is sent without `Secure` so that sign-in works.

Three steps:

1. **Publish the app on localhost only**, so nobody can reach it without going through
   the proxy. In `.env`:

   ```env
   APP_PORT=127.0.0.1:3000
   ```

   and apply it with `docker compose up -d`. A firewall such as `ufw` is **not enough**:
   Docker publishes ports with its own iptables rules and bypasses it.

2. **Declare that there is a proxy in front**, so the sign-in rate limit uses the real
   client IP ([operations.md](./operations.md#login-rate-limiting)).
   In `.env`:

   ```env
   TRUSTED_PROXY_HOPS=1
   ```

   With `TRUSTED_PROXY_HOPS` greater than 0 and the app port open to the outside, anyone
   could spoof their IP with `X-Forwarded-For`: do step 1 first.

3. **Configure the proxy.** With **Caddy** (automatic certificates):

   ```caddyfile
   boards.example.com {
       reverse_proxy 127.0.0.1:3000
   }
   ```

   Caddy already sends `X-Forwarded-Proto` and, as long as you do not configure
   `trusted_proxies`, replaces any `X-Forwarded-For` sent by the client with its real
   IP. Do not add `trusted_proxies` unless there is another proxy in front of Caddy.

   With **nginx** (certificates handled separately, e.g. with certbot):

   ```nginx
   server {
       listen 443 ssl;
       server_name boards.example.com;
       # ssl_certificate / ssl_certificate_key …

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           # The client IP as nginx sees it, ignoring whatever the client sends.
           proxy_set_header X-Forwarded-For $remote_addr;
           proxy_set_header X-Forwarded-Proto $scheme;
           # Real time (SSE): no buffering and long-lived connections.
           proxy_buffering off;
           proxy_read_timeout 1h;
       }
   }
   ```

## Security

- **PostgreSQL is not exposed to the host**: in `docker-compose.yml` the `postgres`
  service publishes no ports; it is only reachable from the internal Compose network.
- Keep the server and Docker up to date.
- If you do not use a reverse proxy, remember that Docker bypasses `ufw`: to close the
  app port use `APP_PORT=127.0.0.1:3000` or rules in the iptables `DOCKER-USER` chain.

## Opening the instance to the public

If you let anyone sign up, you become the data controller for their data. Before enabling
sign-up in **Admin › Instance**, go through the checklist in
[privacy.md](./privacy.md#checklist-for-opening-a-public-instance): HTTPS,
`TRUSTED_PROXY_HOPS`, both cron jobs, backups and your legal details. If you have modified
the code, set `ORGTABLE_SOURCE_URL` to offer your version, as the AGPL requires.

## Resetting the setup wizard

The "configured" state lives in the `InstanceConfig` row of the database. If you need to
run the [setup wizard](./setup-wizard.md) again (for example on a demo), delete that row:

```bash
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" "$POSTGRES_DB" -c "DELETE FROM \"InstanceConfig\";"'
```

The next visit shows the wizard again. This does not delete existing users or boards.
Before doing it, keep in mind:

- **While the wizard is open, anyone who reaches the app can create an admin account.**
  Publishing the app on localhost only (`APP_PORT=127.0.0.1:3000`) is not enough: behind
  a reverse proxy, `/setup` is still reachable through the domain. For the duration, cut
  that access (stop the proxy or block `/setup` in it, e.g. in Caddy with
  `respond /setup* 403`) and complete the wizard through an SSH tunnel:
  `ssh -L 3000:127.0.0.1:3000 user@server` and open `http://localhost:3000`. If you
  cannot cut access, or `APP_PORT` publishes the app on every interface, complete the
  wizard right after the reset.
- The wizard creates a **new** admin: use an email address that does not exist yet, or
  the creation fails.
- It does not recover access for an existing admin. For that, see
  [setup-wizard.md](./setup-wizard.md#recovering-access-for-an-admin).
