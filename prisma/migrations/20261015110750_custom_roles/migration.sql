-- Custom roles per organization (docs/roles.md). A member holds at most one, only on top of
-- the base role MEMBER, and only one of their own organization: the foreign key includes
-- workspaceId and a CHECK ties it to MEMBER.
-- AlterTable
ALTER TABLE "WorkspaceMember" ADD COLUMN     "customRoleId" TEXT;

-- CreateTable
CREATE TABLE "WorkspaceCustomRole" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceCustomRole_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCustomRole_workspaceId_name_key" ON "WorkspaceCustomRole"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceCustomRole_workspaceId_id_key" ON "WorkspaceCustomRole"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "WorkspaceMember_customRoleId_idx" ON "WorkspaceMember"("customRoleId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_customRoleId_fkey" FOREIGN KEY ("workspaceId", "customRoleId") REFERENCES "WorkspaceCustomRole"("workspaceId", "id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceCustomRole" ADD CONSTRAINT "WorkspaceCustomRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Owners and admins already hold every permission: a custom role only makes sense on MEMBER.
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_customRole_member_only"
  CHECK ("customRoleId" IS NULL OR "role" = 'MEMBER');
