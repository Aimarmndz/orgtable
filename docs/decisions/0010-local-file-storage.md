# ADR 0010 — Attachments on local disk (not S3)

**Status:** accepted · **Date:** 2026-06-05

## Context

The operations feature adds attachments to cards. Where is the binary stored? The usual
options are object storage (S3 or compatible) or the server's local disk.

## Decision

Store attachments on the **local disk**, in a configurable directory
(`ORGTABLE_UPLOAD_DIR`) that is a persistent volume in Docker. Only the metadata is stored
in the database.

## Rationale

- **Self-hosted, no cloud dependencies.** orgtable is installed with one command and a
  two-service `docker-compose`. Requiring an S3 account (or deploying MinIO) would break
  that simplicity and the promise of "your data on your server".
- **A volume is already persistent and can be backed up.** The `uploads` volume joins the
  same backup strategy as the database (`docs/operations.md`).
- **Access must be authorized either way.** Whether disk or S3, attachments are private
  and are served by a route handler that checks membership. The storage backend does not
  change that design.

## Consequences

- Storage is coupled to the app container's file system. In a **multi-instance**
  deployment, the uploads volume must be **shared** between replicas (NFS, network
  volume...) or moved to object storage.
- `app/lib/storage.ts` isolates the file operations (`save`/`read`/`delete`), so adding an
  S3 backend in the future would mean replacing that layer without touching the actions
  or the route handler.
- 10 MB limit per file to bound disk usage; adjustable in `app/lib/storage.ts`.
