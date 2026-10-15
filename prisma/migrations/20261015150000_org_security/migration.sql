-- Security policy of an organization: mandatory two-step verification and allowed email
-- domains (docs/workspaces.md, "Security").
-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "allowedEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "requireTwoFactor" BOOLEAN NOT NULL DEFAULT false;

