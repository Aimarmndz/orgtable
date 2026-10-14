import "server-only";
import { prisma } from "@/app/lib/prisma";

// Instance settings the admin manages from /admin/instance: open or closed registration
// and the legal details of whoever operates the instance. No request context or
// authorization (the Server Action provides it), same as services/users.ts. See
// docs/privacy.md.

const INSTANCE_ID = "singleton";

export type LegalInfo = {
  instanceName: string;
  operatorName: string | null;
  operatorEmail: string | null;
  operatorLegalId: string | null;
  operatorAddress: string | null;
  hostingDescription: string | null;
  backupRetentionDays: number | null;
  legalUpdatedAt: Date | null;
  registrationOpen: boolean;
};

/** Legal details and registration state. null if the instance is not configured yet. */
export async function getLegalInfo(): Promise<LegalInfo | null> {
  return prisma.instanceConfig.findUnique({
    where: { id: INSTANCE_ID },
    select: {
      instanceName: true,
      operatorName: true,
      operatorEmail: true,
      operatorLegalId: true,
      operatorAddress: true,
      hostingDescription: true,
      backupRetentionDays: true,
      legalUpdatedAt: true,
      registrationOpen: true,
    },
  });
}

/**
 * true if the privacy policy has the minimum the GDPR requires (art. 13.1.a): who the
 * controller is and how to contact them. Without it, registration cannot be opened.
 */
export function hasRequiredLegalInfo(
  info: Pick<LegalInfo, "operatorName" | "operatorEmail">,
): boolean {
  return Boolean(info.operatorName && info.operatorEmail);
}

export async function isRegistrationOpen(): Promise<boolean> {
  const info = await getLegalInfo();
  // Re-checked here and not only on save: if someone clears the legal details directly
  // in the DB, registration closes itself instead of accepting sign-ups without a policy.
  return Boolean(info?.registrationOpen && hasRequiredLegalInfo(info));
}

export type InstanceSettingsInput = {
  instanceName: string;
  registrationOpen: boolean;
  operatorName: string | null;
  operatorEmail: string | null;
  operatorLegalId: string | null;
  operatorAddress: string | null;
  hostingDescription: string | null;
  backupRetentionDays: number | null;
};

export type UpdateInstanceResult =
  | { ok: true; legalChanged: boolean }
  | { ok: false; error: "not_configured" | "legal_info_required" };

const LEGAL_FIELDS = [
  "operatorName",
  "operatorEmail",
  "operatorLegalId",
  "operatorAddress",
  "hostingDescription",
  "backupRetentionDays",
] as const;

/**
 * Saves the settings. Opening registration requires a controller and a contact. If any
 * legal detail changes, `legalUpdatedAt` is set to now: it is the "last updated" date of
 * the legal pages, so it can never lag behind what they say.
 */
export async function updateInstanceSettings(
  input: InstanceSettingsInput,
): Promise<UpdateInstanceResult> {
  const current = await prisma.instanceConfig.findUnique({
    where: { id: INSTANCE_ID },
  });
  if (!current) return { ok: false, error: "not_configured" };
  if (input.registrationOpen && !hasRequiredLegalInfo(input)) {
    return { ok: false, error: "legal_info_required" };
  }

  const legalChanged = LEGAL_FIELDS.some((f) => current[f] !== input[f]);
  await prisma.instanceConfig.update({
    where: { id: INSTANCE_ID },
    data: {
      ...input,
      ...(legalChanged ? { legalUpdatedAt: new Date() } : {}),
    },
  });
  return { ok: true, legalChanged };
}
