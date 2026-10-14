# Card attachments

Each card can have file attachments (up to **10 MB** per file). The binary is stored on
**disk**; only the metadata (original name, stored name, MIME type, size) lives in the
database.

The 10 MB limit is `MAX_ATTACHMENT_BYTES` in `app/lib/storage.ts`. The upload travels in
the body of a Server Action, whose maximum size is set by `serverActions.bodySizeLimit` in
`next.config.ts`: that value must stay somewhat above 10 MB (the `FormData` adds headers),
or Next rejects the file before it reaches validation.

## Storage

Files are stored in the directory given by `ORGTABLE_UPLOAD_DIR`:

- **Production (Docker):** `/data/uploads`, a **persistent volume** (`uploads`) declared
  in `docker-compose.yml`. It survives container re-creation and is part of the backup
  strategy (see [`docs/operations.md`](./operations.md)).
- **Local development:** if the variable is not set, `./uploads` is used (ignored by git).

Each file is stored under a **random name** (`crypto.randomUUID()` + a sanitized
extension). The original name the user sees is kept separately in the database. Paths
are built with `path.basename`, which neutralizes any *path traversal* attempt. The
decision to use local disk (rather than S3) is in
[ADR 0010](./decisions/0010-local-file-storage.md).

## Upload, download and deletion

| Operation | Who | How |
| --- | --- | --- |
| Upload | EDITOR / OWNER | Server Action `uploadAttachment` (receives the `File` through `FormData`). Validates the size and writes to disk. |
| Download | Any member | Route Handler `GET /api/attachments/[id]`. |
| Delete | EDITOR / OWNER | Server Action `deleteAttachment` (deletes the row and the file). |

### Cascading deletes and files

Deleting a card, a list or a board (from the interface or with `DELETE` in the v1 API)
cascades to its `Attachment` rows, but the database does not touch the disk. That is why
these deletions go through
[`app/lib/services/attachments.ts`](../app/lib/services/attachments.ts): it reads the
stored names and deletes in the database inside a transaction and, **only after the
commit**, deletes the files. If the transaction fails, the disk is left untouched.

Before reading, the transaction locks the parent rows with `FOR UPDATE` (the board, its
lists and its cards, depending on what is deleted). Without that lock, an upload committed
between the read and the delete would disappear in the cascade while its file was missing
from the list: an orphan on disk and an upload reported as successful. With the lock, an
in-flight upload finishes before the read (its file is deleted with the rest) and a later
one fails on the foreign key, so `uploadAttachment` deletes its file and rethrows the
error.

`deleteAttachmentFile` never throws: a file that no longer exists (`ENOENT`) is normal and
ignored; any other error (permissions, read-only volume…) is logged with `console.error`
(prefix `[storage]`) because it leaves an orphan file that must be deleted by hand. If
creating the row fails after an upload has written the file, the file is deleted and the
error is rethrown.

Files orphaned before this behavior was introduced remain on the volume; there is no
automatic sweep.

Components:

- [`app/lib/storage.ts`](../app/lib/storage.ts) — save/read/delete on disk and the size
  limit.
- [`app/lib/services/attachments.ts`](../app/lib/services/attachments.ts) — deleting
  cards, lists and boards together with their files.
- [`app/lib/actions/attachments.ts`](../app/lib/actions/attachments.ts) — Server Actions
  with role-based authorization.
- [`app/api/attachments/[id]/route.ts`](../app/api/attachments/[id]/route.ts) — authorized
  download.
- The card modal (`card-modal.tsx`) shows the list, the upload button (editors) and the
  delete button; the card face shows an attachment count.

## Why downloads go through a route handler

Attachments are **private**: only board members should see them. So they are not served
from `/public` (reachable by URL without authentication) but from a route handler that
checks **a valid session + membership** before returning the binary, with
`Content-Disposition: attachment` and `Cache-Control: private, no-store`.

Responses:

| Code | When |
| --- | --- |
| `200` | Board member and the file is on disk. |
| `401` | No valid session. |
| `404` | The attachment does not exist **or** you are not a board member (same body in both cases, so it does not reveal which ids exist, like the v1 API). Also when the row exists but the file is missing from disk; this is logged with `console.warn` because it indicates an inconsistency. |
| `500` | Any other error reading the file (permissions, volume I/O); logged with `console.error`. |
