-- Brand of an organization: colour, logo and time zone (docs/workspaces.md).
-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "logoMimeType" TEXT,
ADD COLUMN     "logoStoredName" TEXT,
ADD COLUMN     "timezone" TEXT;

