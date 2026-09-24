"use server";

import { redirect } from "next/navigation";
import { hashPassword } from "@/app/lib/auth";
import { createSession } from "@/app/lib/session";
import { recordAudit } from "@/app/lib/audit";
import { setupSchema } from "@/app/lib/validators";
import { isSetupComplete } from "@/app/lib/dal";
import {
  completeInstanceSetup,
  type SetupOutcome,
} from "@/app/lib/services/setup";

export type SetupState = { error?: string };

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  // Con el setup ya hecho se corta aquí, antes de validar y de gastar ~200 ms de bcrypt:
  // el ID de la acción sigue en el bundle de /setup y se puede invocar a mano. redirect()
  // lanza NEXT_REDIRECT, así que va fuera de cualquier try/catch. La comprobación
  // definitiva sigue dentro de la transacción (completeInstanceSetup).
  if (await isSetupComplete()) redirect("/login");

  const parsed = setupSchema.safeParse({
    instanceName: formData.get("instanceName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }

  const { instanceName, name, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  let outcome: SetupOutcome | { ok: false; reason: "ERROR" };
  try {
    outcome = await completeInstanceSetup({ instanceName, name, email, passwordHash });
  } catch (e) {
    // BD caída, migraciones sin aplicar, email duplicado…: el usuario ve un mensaje
    // genérico, pero la causa queda en el log (sin FormData ni email).
    console.error("[setup] fallo al completar la configuración", describeSetupError(e));
    outcome = { ok: false, reason: "ERROR" };
  }

  // redirect() se llama FUERA del try/catch: lanza una excepción interna de Next
  // (NEXT_REDIRECT) que no debe ser capturada por el catch de arriba.
  if (!outcome.ok) {
    if (outcome.reason === "ALREADY_SETUP") redirect("/login");
    return {
      error: "No se pudo completar la configuración. Inténtalo de nuevo.",
    };
  }

  await createSession(outcome.userId);
  await recordAudit({
    action: "setup.completed",
    userId: outcome.userId,
    detail: instanceName,
  });
  redirect("/boards");
}

// Código y campos de Prisma (p. ej. P2002 en `email`) y mensaje, que no incluye los
// valores enviados salvo en errores de validación, donde solo se deja el tipo.
function describeSetupError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { error: String(e).slice(0, 200) };
  const code = "code" in e ? e.code : undefined;
  const meta = "meta" in e && typeof e.meta === "object" && e.meta ? e.meta : undefined;
  const target = meta && "target" in meta ? meta.target : undefined;
  const message =
    e.name === "PrismaClientValidationError" ? undefined : e.message.slice(0, 500);
  return { name: e.name, code, target, message };
}
