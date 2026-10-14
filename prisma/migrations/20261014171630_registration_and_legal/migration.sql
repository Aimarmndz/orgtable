-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN     "backupRetentionDays" INTEGER,
ADD COLUMN     "hostingDescription" TEXT,
ADD COLUMN     "legalUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "operatorAddress" TEXT,
ADD COLUMN     "operatorEmail" TEXT,
ADD COLUMN     "operatorLegalId" TEXT,
ADD COLUMN     "operatorName" TEXT,
ADD COLUMN     "registrationOpen" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);
