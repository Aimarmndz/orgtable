"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/app/lib/dal";
import { updateInstanceSettings } from "@/app/lib/services/instance";
import { instanceSettingsSchema } from "@/app/lib/validators";
import { recordAudit } from "@/app/lib/audit";

// Ajustes de la instancia (/admin/instance): nombre, registro abierto y datos legales del
// operador. Solo el ADMIN global. Ver docs/privacy.md.

export type InstanceSettingsState = {
  error?: string;
  field?: string;
  message?: string;
  // Lo enviado, para repintar el formulario tras un error: React 19 resetea los
  // formularios no controlados después de cada acción y se perdería lo tecleado.
  values?: Record<string, string>;
};

const FIELDS = [
  "instanceName",
  "registrationOpen",
  "operatorName",
  "operatorEmail",
  "operatorLegalId",
  "operatorAddress",
  "hostingDescription",
  "backupRetentionDays",
] as const;

export async function saveInstanceSettings(
  _prev: InstanceSettingsState,
  formData: FormData,
): Promise<InstanceSettingsState> {
  const admin = await requireAdmin();
  const raw = Object.fromEntries(
    FIELDS.map((f) => {
      const v = formData.get(f);
      return [f, typeof v === "string" ? v : ""];
    }),
  );
  const parsed = instanceSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue?.message ?? "Datos no válidos.",
      field: String(issue?.path[0] ?? ""),
      values: raw,
    };
  }

  const result = await updateInstanceSettings(parsed.data);
  if (!result.ok) {
    if (result.error === "legal_info_required") {
      return {
        error:
          "Para abrir el registro, rellena antes el responsable y el email de contacto: la política de privacidad los necesita.",
        field: "registrationOpen",
        values: raw,
      };
    }
    return { error: "La instancia aún no está configurada.", values: raw };
  }

  await recordAudit({
    action: "instance.updated",
    userId: admin.id,
    detail: `registro ${parsed.data.registrationOpen ? "abierto" : "cerrado"}${result.legalChanged ? ", datos legales cambiados" : ""}`,
  });
  // El nombre sale en la barra de toda la app; el registro, en /login y /register.
  revalidatePath("/", "layout");
  return { message: "Ajustes guardados." };
}
