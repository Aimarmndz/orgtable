-- Backups of organizations and of the instance (docs/backups.md).
-- CreateEnum
CREATE TYPE "BackupFrequency" AS ENUM ('OFF', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "BackupDestination" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "BackupKind" AS ENUM ('MANUAL', 'SCHEDULED', 'BEFORE_IMPORT', 'BEFORE_RESTORE');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "frequency" "BackupFrequency" NOT NULL DEFAULT 'OFF',
    "hour" INTEGER NOT NULL DEFAULT 3,
    "retention" INTEGER NOT NULL DEFAULT 14,
    "includeAttachments" BOOLEAN NOT NULL DEFAULT true,
    "destination" "BackupDestination" NOT NULL DEFAULT 'LOCAL',
    "s3Endpoint" TEXT,
    "s3Region" TEXT,
    "s3Bucket" TEXT,
    "s3Prefix" TEXT,
    "s3AccessKeyEnc" TEXT,
    "s3SecretKeyEnc" TEXT,
    "encrypt" BOOLEAN NOT NULL DEFAULT true,
    "lastScheduledAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "kind" "BackupKind" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'RUNNING',
    "destination" "BackupDestination" NOT NULL,
    "location" TEXT,
    "size" INTEGER,
    "encrypted" BOOLEAN NOT NULL DEFAULT false,
    "includesAttachments" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BackupConfig_workspaceId_key" ON "BackupConfig"("workspaceId");

-- CreateIndex
CREATE INDEX "Backup_workspaceId_createdAt_idx" ON "Backup"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "BackupConfig" ADD CONSTRAINT "BackupConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

