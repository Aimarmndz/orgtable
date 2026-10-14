import "server-only";
import { prisma } from "@/app/lib/prisma";

// Ajustes de la instancia que gestiona el admin desde /admin/instance: registro abierto o
// cerrado y datos legales de quien opera la instancia. Sin contexto de request ni
// autorización (lo pone la Server Action), igual que services/users.ts. Ver
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

/** Datos legales y estado del registro. null si la instancia aún no se ha configurado. */
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
 * true si la política de privacidad tiene lo mínimo que exige el RGPD (art. 13.1.a): quién
 * es el responsable y cómo contactarle. Sin eso no se puede abrir el registro.
 */
export function hasRequiredLegalInfo(
  info: Pick<LegalInfo, "operatorName" | "operatorEmail">,
): boolean {
  return Boolean(info.operatorName && info.operatorEmail);
}

export async function isRegistrationOpen(): Promise<boolean> {
  const info = await getLegalInfo();
  // Se vuelve a comprobar aquí y no solo al guardar: si alguien vacía los datos legales
  // directamente en la BD, el registro se cierra solo en vez de aceptar altas sin política.
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
 * Guarda los ajustes. Abrir el registro exige responsable y contacto. Si cambia algún dato
 * legal, `legalUpdatedAt` pasa a ahora: es la «última actualización» de las páginas
 * legales, que así no puede quedarse atrás respecto a lo que dicen.
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
