-- Two-step verification (TOTP) for accounts (docs/authentication.md).
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpLastStep" INTEGER,
ADD COLUMN     "totpPendingEnc" TEXT,
ADD COLUMN     "totpSecretEnc" TEXT;

