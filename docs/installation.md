# Installation

This guide explains how to self-host **orgtable** (a self-hosted Kanban app built with Next.js 16, Prisma 7 and PostgreSQL) on your own server with Docker.

orgtable follows a Coolify/Dokploy-style credentials model: **you never type database credentials**. The installer generates them, and the app always starts with the database already connected. The only things you configure are entered in the initial web wizard: your admin account and the instance name.

## Requirements

- A **Linux** server.
- **Docker** and **Docker Compose v2** (`docker compose`). If Docker is not installed, the installer installs it for you with [get.docker.com](https://get.docker.com).
- A **free port** on the host for the app (`3000` by default).
- Internet access on the server (to download Docker, clone the repository and build the image).

The app image is **built locally on your server** with `docker compose build`; it is not pulled from any container registry.

## Quick install

Run this single command on your server:

```bash
curl -sSL https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh | bash
```

The installer detects Docker and installs it if missing, clones the repository, generates a `.env` with random secrets and starts the services. The **first build takes a few minutes** because the image is compiled on the server itself.

When it finishes, open this in your browser:

```
http://<server-ip>:<APP_PORT>
```

`APP_PORT` defaults to `3000`. You will see the **setup wizard**, where you create your admin account and name the instance. See [docs/setup-wizard.md](./setup-wizard.md) for that step.

> **HTTPS.** The app works over `http://`, but the password and the session travel unencrypted. For real use, put a reverse proxy with TLS (Caddy or nginx) in front of it before giving anyone else access: see [self-hosting.md › HTTPS and domain](./self-hosting.md#https-and-domain-reverse-proxy). Complete the wizard as soon as the installation starts: while it is open, whoever reaches the app first creates the admin account.

## What the installer does

The `install.sh` script works through these steps:

1. **Checks Docker.** If the `docker` command does not exist, it installs it with `curl -fsSL https://get.docker.com | sh`. It then checks that **Docker Compose v2** (`docker compose`) is available and aborts with an error if it is not.

2. **Clones or updates the source code.** The repository is installed in `$HOME/orgtable`:
   - If the directory already contains a git repository, it updates it with `git pull --ff-only`.
   - Otherwise, it clones it with `git clone`.

   Both can be changed with environment variables:
   - `ORGTABLE_DIR`: installation directory (default `$HOME/orgtable`).
   - `ORGTABLE_REPO`: repository URL (default `https://github.com/Aimarmndz/orgtable.git`).

3. **Generates the `.env` with random secrets.** Only if a `.env` **does not exist** yet. In that case it:
   - Generates `POSTGRES_PASSWORD` with `openssl rand -hex 24`.
   - Generates `SESSION_SECRET` with `openssl rand -hex 32`.
   - Generates `CRON_SECRET` with `openssl rand -hex 32` (the secret for [due-date reminders](./reminders.md)).
   - Builds `DATABASE_URL` from those credentials.
   - Writes the file and sets its permissions to `600` (`chmod 600 .env`).

   If the `.env` already exists but has no `CRON_SECRET`, the installer adds it and leaves everything else untouched.

4. **Builds and starts the services.** It runs `docker compose build` (a few minutes the first time) and then `docker compose up -d`.

5. **Shows the access URL.** It detects the server IP and the configured port, prints the address where you complete the setup wizard, and reminds you that real use needs HTTPS. If `APP_PORT` publishes the app on localhost only (`127.0.0.1:3000`), it explains how to reach it through the reverse proxy or an SSH tunnel instead.

### Idempotency

You can run the install command again safely. When you do:

- The repository is **updated** with `git pull --ff-only`.
- The existing `.env` is **not overwritten**: the secrets already generated (`POSTGRES_PASSWORD`, `SESSION_SECRET`, etc.) are kept. Only `CRON_SECRET` is added if missing.
- The image is rebuilt and the services are restarted with the changes.

This means the installer also works to **update** an existing installation.

## Manual installation

If you prefer not to use the script, you can install orgtable by hand.

1. **Clone the repository:**

   ```bash
   git clone https://github.com/Aimarmndz/orgtable.git
   cd orgtable
   ```

2. **Create your `.env` file** from the template and fill it in:

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and adjust the values. The essential part of the `.env.example` template is:

   ```env
   # --- PostgreSQL ---
   POSTGRES_USER=orgtable
   POSTGRES_PASSWORD=changeme
   POSTGRES_DB=orgtable

   DATABASE_URL=postgresql://orgtable:changeme@postgres:5432/orgtable

   # --- Application ---
   # Required, at least 16 characters.
   SESSION_SECRET=

   APP_PORT=3000
   ```

   Replace `changeme` with a real password (inside `DATABASE_URL` too), and fill in `SESSION_SECRET` and, for reminders, `CRON_SECRET`. Generate each secret with:

   ```bash
   openssl rand -hex 32
   ```

   The other variables are optional; they are listed in the [table below](#environment-variables).

   Important: `DATABASE_URL` must match the PostgreSQL user, password and database. In docker-compose the host is `postgres` (the service name), not `localhost`. For security, restrict the file permissions:

   ```bash
   chmod 600 .env
   ```

3. **Build and start the services:**

   ```bash
   docker compose up -d --build
   ```

   The first build takes a few minutes.

4. Open `http://<server-ip>:<APP_PORT>` and complete the [setup wizard](./setup-wizard.md). For real use, put HTTPS in front of it (see the note in [Quick install](#quick-install)).

## Environment variables

This table is the reference for every variable. They are defined in the `.env` at the project root; the installer generates the required ones, and in a manual installation you fill them in yourself. The commented template is [`.env.example`](../.env.example).

The app container only receives the variables listed under `environment:` in `docker-compose.yml`. After changing `.env`, apply it with `docker compose up -d` (this recreates the container; `restart` is not enough).

| Variable | Required | Purpose |
|---|---|---|
| `POSTGRES_USER` | Yes | PostgreSQL database user. Default `orgtable`. |
| `POSTGRES_PASSWORD` | Yes | Password of the PostgreSQL user. The installer generates it with `openssl rand -hex 24`. |
| `POSTGRES_DB` | Yes | Database name. Default `orgtable`. |
| `DATABASE_URL` | Yes | Connection string used by the app. It must match the three variables above. The host is `postgres` (the docker-compose service name). Format: `postgresql://USER:PASSWORD@postgres:5432/DATABASE`. |
| `SESSION_SECRET` | Yes | Secret used to sign the JWT sessions, at least 16 characters. Without it (or with a shorter one) the app cannot create sessions, so sign-in and the setup wizard fail. The installer generates it with `openssl rand -hex 32`. |
| `APP_PORT` | No | Host port the app is exposed on. Default `3000`. Accepts `127.0.0.1:3000` to publish it on localhost only, behind a reverse proxy. Inside the container the app always listens on `3000`. |
| `CRON_SECRET` | No | Secret for the cron endpoints: [reminders](./reminders.md) and data cleanup ([operations.md](./operations.md#scheduled-tasks)). Empty = endpoints disabled. The installer generates it with `openssl rand -hex 32`. |
| `TRUSTED_PROXY_HOPS` | No | Number of trusted proxies in front of the app (default `0`: `X-Forwarded-For` is ignored). Behind one reverse proxy, `1`. See [operations.md](./operations.md#login-rate-limiting). |
| `ORGTABLE_TIMEZONE` | No | IANA time zone for dates formatted on the server. Default `Atlantic/Canary`. |
| `ORGTABLE_UPLOAD_DIR` | No | Attachments directory. In Docker, `/data/uploads` (the `uploads` volume). See [attachments.md](./attachments.md). |
| `ORGTABLE_AUDIT_RETENTION_DAYS` | No | Days the audit log (which includes IP addresses if `TRUSTED_PROXY_HOPS > 0`) is kept before `POST /api/cron/maintenance` deletes it. Integer ≥ 1; default `90`. See [privacy.md](./privacy.md). |
| `ORGTABLE_SOURCE_URL` | No | The app's "Source code" link. The AGPL requires offering the source code to everyone who uses the app over a network: if you deploy a **modified** version, point this to your fork. Defaults to the original repository. Must start with `https://` or `http://`. |
| `ORGTABLE_LANDING` | No | The public landing page at `/` for visitors without a session: `auto` (default) shows it only while sign-up is open, `on` always, `off` never (then `/` goes to sign-in). See [landing.md](./landing.md). |
| `ORGTABLE_INSTALL_URL` | No | Install script the landing tells visitors to run (`curl -fsSL <url> \| bash`). Defaults to the original repository's `install.sh`. Must start with `https://` and contain no characters a shell would interpret. |
| `ORGTABLE_SMTP_URL` | No | SMTP server for password reset links and employee invitations (`smtps://user:password@host:465`). Empty = email off. See [email.md](./email.md). |
| `ORGTABLE_MAIL_FROM` | With email | Sender of the emails, e.g. `orgtable <no-reply@example.org>`. |
| `ORGTABLE_PUBLIC_URL` | With email | The instance's public address, used in the links of the emails. |
| `ORGTABLE_REALTIME_PG_NOTIFY` | No | `1` to propagate real-time events between several app replicas with PostgreSQL `LISTEN/NOTIFY`. Default `0`. See [realtime.md](./realtime.md). |
| `ORGTABLE_DIR` | No | Installer only (`install.sh`, read from the shell, not from `.env`): installation directory. Default `$HOME/orgtable`. |
| `ORGTABLE_REPO` | No | Installer only (`install.sh`, read from the shell, not from `.env`): repository URL to clone. Default `https://github.com/Aimarmndz/orgtable.git`. |

## Useful operation commands

Run these commands from the installation directory (`$HOME/orgtable` by default).

Follow the app logs:

```bash
docker compose logs -f app
```

Stop the services:

```bash
docker compose down
```

Start them again:

```bash
docker compose up -d
```

Update to the latest version (backup, update the code, rebuild and restart):

```bash
scripts/update.sh
```

Running the installer (`install.sh`) again also updates without touching your `.env`, but it does **not** take a backup first. Details in [operations.md](./operations.md#updates).

For advanced operations such as **backups** or setting up a **reverse proxy with TLS**, see [docs/self-hosting.md](./self-hosting.md).

## Security

- **PostgreSQL is not exposed to the host.** The database service is only reachable from the internal Docker network (`orgtable`); it publishes no port. The app reaches it through the `postgres` service name.
- **The `.env` file has `600` permissions.** The installer runs `chmod 600 .env`, so only the owning user can read the secrets (database password and session secret). If you create it by hand, set this permission yourself.
- Secrets are generated with `openssl` (`rand -hex 24` for the PostgreSQL password and `rand -hex 32` for the session secret), so they are unique to each installation.
