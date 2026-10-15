-- Each audit event remembers its workspace, so an organization can read its own activity log
-- (docs/audit.md). Soft reference: no foreign key.
-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");


-- Backfill the events written before this column existed: workspace events carry the
-- workspace in targetId; board events take it from the board (if it still exists).
UPDATE "AuditLog" SET "workspaceId" = "targetId"
  WHERE "targetType" = 'workspace' AND "workspaceId" IS NULL;
UPDATE "AuditLog" a SET "workspaceId" = b."workspaceId"
  FROM "Board" b
  WHERE a."targetType" = 'board' AND a."targetId" = b."id" AND a."workspaceId" IS NULL;
