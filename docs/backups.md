# Backups, export and import

orgtable backs up from inside the app at two levels:

- **An organization** backs up its own data at `/<slug>/settings/backups` (`backups.manage`
  permission): scheduled backups, a destination on this server or in its own S3 bucket, a history
  to download or restore from, and export and import of a portable `.zip`.
- **The instance administrator** backs up everything (every account, organization, board and
  file) at `/admin/backups`, with the same tools.

These complement, not replace, the database dumps of `scripts/backup.sh`
([operations](./operations.md#backups)): those work even when the app does not start.

## Format

An organization's backup and its export are the same `.zip`:

```
organization.json   # boards, lists, cards, labels, checklists, comments, members,
                    # custom roles and teams; people by email; dates in ISO 8601
attachments/…       # the card files (optional)
README.txt
```

It is readable JSON (format `orgtable-organization`, version 1), so the data can be taken
anywhere. Webhooks, API keys and incoming webhooks are **not** included: they hold secrets.
Download it from _Backups › Export_ (`data.export` is enough for that,
`GET /api/workspaces/<slug>/export`).

An instance backup is `instance.json` (every table, read from the database catalog, so a new
table is never forgotten, plus the list of applied migrations) and `uploads/…` (every uploaded
file). It holds password hashes and encrypted secrets: treat it like the database.

## Schedule and retention

Each organization (and the instance) chooses a frequency (daily, weekly on Mondays, monthly on
the 1st, or off), an hour of the day in **its** time zone (_General and brand_; else the
instance's) and how many scheduled backups to keep (1–90; older ones are deleted, manual ones
stay). The hourly cron job `POST /api/cron/backups` runs whatever is due
([operations](./operations.md#scheduled-tasks)); a backup is claimed before it runs, so two calls
in the same hour do not both take it.

## Destinations

- **This server**: files under `ORGTABLE_BACKUP_DIR` (`/data/backups`, its own volume in
  docker-compose). Simple, but lost with the server.
- **Your S3 or compatible** (AWS, Cloudflare R2, Backblaze B2, MinIO, Wasabi…): endpoint, region,
  bucket, folder and keys. AWS endpoints use virtual-hosted URLs, anything else path-style. The
  keys are stored encrypted with `ORGTABLE_SECRET_KEY` and never shown again. _Test connection_
  writes, reads back and deletes a small file. The endpoint goes through the same guard as
  webhooks: private addresses are refused unless `ORGTABLE_ALLOW_PRIVATE_TARGETS=1` (a MinIO on
  your network). The client is a few lines of AWS Signature V4 over `node:https`
  (`app/lib/backups/s3.ts`), checked against the AWS documentation's example.

**Encrypt before storing** (on by default) encrypts the file with AES-256-GCM bound to the
backup's id: only an instance with the same `ORGTABLE_SECRET_KEY` can open it. Downloads from the
history come decrypted.

## Import and restore

**Import** (_Backups › Import_, `POST /api/workspaces/<slug>/import`) adds the boards of an export
**next to** the organization's own:

- Everything gets new ids and free board addresses; positions are regenerated.
- People are matched **by email against the organization's current members**. An import never
  creates accounts or adds members. A board owner who is not a member becomes the person
  importing; a comment by a non-member is kept under that person with the original name in
  brackets; assignments and memberships of non-members are dropped.
- Custom roles and teams are created (by name, existing ones are kept) only when the person
  importing is an owner or admin.
- The file is untrusted input: its shape is checked with zod, every length is bounded, and the
  `.zip` is refused beyond 2 GB unzipped or 100 000 entries. Up to `ORGTABLE_IMPORT_MAX_MB` (200)
  per upload; your reverse proxy must allow bodies that large.

**Restore** (_Restaurar…_ in the history, typing the organization's address) **replaces** the
organization's boards, teams and custom roles with the backup's, and gives members their custom
roles back. Deleting and importing happen in one transaction: if anything fails, nothing changes.
Board webhooks and incoming webhooks of the replaced boards go with them.

Both take a **backup first** (_Before importing_ / _Before restoring_) and do not go on if it
fails.

**Restoring the instance** (typing `instance`) replaces the whole database and writes back the
files, in one transaction, and signs everyone out. Only a backup taken with the same migrations
(the same orgtable version) is accepted. Tables are filled following their foreign keys; the one
cycle (`User.managedById` ↔ `Workspace.personalOwnerId`) is broken by filling a nullable column
afterwards.

## Privacy

Backups contain personal data (names, emails, comments, files). Scheduled ones are pruned by
their retention; manual ones stay until deleted. Deleting an organization deletes its backups and
their files. See [privacy](./privacy.md).

## Where it lives

| Piece                       | File                                                           |
| --------------------------- | -------------------------------------------------------------- |
| Export format, zip reading  | `app/lib/backups/organization.ts`                              |
| Import into an organization | `app/lib/backups/import.ts`                                    |
| Instance dump and restore   | `app/lib/backups/instance.ts`                                  |
| Storage, encryption         | `app/lib/backups/store.ts`                                     |
| S3 client                   | `app/lib/backups/s3.ts`                                        |
| Rules, schedule, retention  | `app/lib/services/backups.ts`                                  |
| Pages                       | `/<slug>/settings/backups`, `/admin/backups`                   |
| Tests                       | `test/s3-sign.test.ts`, `test/integration/backups.int.test.ts` |
