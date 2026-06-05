"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { hashPassword } from "@/app/lib/auth";
import { createSession } from "@/app/lib/session";
import { recordAudit } from "@/app/lib/audit";
import { setupSchema } from "@/app/lib/validators";

const INSTANCE_ID = "singleton";

export type SetupState = { error?: string };

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
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

  // La transacción re-comprueba que el setup NO esté completo DENTRO de la propia
  // transacción: esto lo hace atómico frente a un doble envío del formulario.
  let outcome:
    | { ok: true; userId: string }
    | { ok: false; reason: "ALREADY_SETUP" | "ERROR" };
  try {
    const userId = await prisma.$transaction(async (tx) => {
      const existing = await tx.instanceConfig.findUnique({
        where: { id: INSTANCE_ID },
      });
      if (existing?.setupCompletedAt) {
        throw new Error("ALREADY_SETUP");
      }
      const user = await tx.user.create({
        data: { email: email.toLowerCase(), name, passwordHash, role: "ADMIN" },
      });
      await tx.instanceConfig.upsert({
        where: { id: INSTANCE_ID },
        create: {
          id: INSTANCE_ID,
          instanceName,
          setupCompletedAt: new Date(),
        },
        update: { instanceName, setupCompletedAt: new Date() },
      });
      return user.id;
    });
    outcome = { ok: true, userId };
  } catch (e) {
    outcome =
      e instanceof Error && e.message === "ALREADY_SETUP"
        ? { ok: false, reason: "ALREADY_SETUP" }
        : { ok: false, reason: "ERROR" };
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
