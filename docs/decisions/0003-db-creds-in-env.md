# ADR 0003 — Database credentials in `.env` (not in the setup wizard)

**Status:** accepted · **Date:** 2026-06-04

## Context

orgtable is installed with one command (Coolify/Dokploy style) and configured over the web
the first time. The question arises: where are the PostgreSQL credentials defined?

- **Nextcloud/WordPress model**: the app starts without a database and a web wizard asks
  for the database host/user/password, writes them to disk and restarts.
- **Coolify/Dokploy model**: the installer generates the credentials before starting; the
  web wizard only collects application data (admin user, name).

## Decision

Adopt the **Coolify model**: `install.sh` generates random `POSTGRES_PASSWORD` and
`SESSION_SECRET` (`openssl rand`) into `.env` before `docker compose up`. The app
**always** starts with the database connected. The setup wizard only asks for the
**administrator user** and the **instance name**.

## Rationale

- The Next app needs a PostgreSQL connection to run the wizard itself (which stores the
  admin in the `users` table). The Nextcloud model would mean starting without a database,
  writing config to the container's file system and restarting — fragile, and prone to
  race conditions in an immutable container.
- The user never types or sees infrastructure credentials: fewer mistakes, more security.

## Consequences

- The "already configured" state lives in the database (`InstanceConfig.setupCompletedAt`),
  not in a file. See `docs/setup-wizard.md`.
- If someone deletes that row by hand, the wizard reappears (acceptable: it is their
  server).
