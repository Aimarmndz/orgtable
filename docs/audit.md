# Activity log of an organization

Every organization has its own activity log at **Settings › Activity log**
(`/<slug>/settings/audit`): who did what and when, grouped by day, newest first. It is the same
audit log the instance administrator reads at `/admin/audit`, filtered to the organization.

## Who can read it

People with the `audit.view` permission: owners and admins, and any custom role that holds it
(see [roles](./roles.md)). The page and the CSV export answer 404 to everyone else.

## What is in it

Each `AuditLog` row carries a `workspaceId` (a soft reference, so "organization deleted"
outlives the organization in the instance's log). `recordAudit` fills it in:

- events whose target is a workspace: that workspace;
- events whose target is a board: the board's workspace (passed explicitly when the board was
  just deleted);
- anything else (sign-in, one's own account): no workspace, so it never shows here.

The migration that added the column backfilled older events the same way.

Events are grouped in six categories, derived from the action's name
(`app/lib/audit-categories.ts`): Organization, People and roles, Boards, Integrations, Data,
Security. Filters (category, person) live in the address, so a filtered view can be shared and
exported as is.

Details are made readable: ids of people, boards, roles and teams **of that organization** are
shown as their names (`app/lib/services/org-audit.ts`). Ids of anything else stay as written, so
a detail can never be used to read a name from another organization.

The IP address is shown when the instance records it (`TRUSTED_PROXY_HOPS`, see
[privacy](./privacy.md)); it is personal data of the organization's people and is purged with the
rest of the log after `ORGTABLE_AUDIT_RETENTION_DAYS`.

## CSV export

`GET /api/workspaces/<slug>/audit` (browser session, `audit.view`) downloads the log with the same
filters (`?category=`, `?person=`), up to 10 000 rows, UTF-8 with BOM so spreadsheets open it
correctly. Cells that a spreadsheet would read as a formula (`=`, `+`, `-`, `@`) are prefixed with
`'`. The export itself is logged (`workspace.export`).
