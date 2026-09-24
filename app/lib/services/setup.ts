import "server-only";
import { prisma } from "@/app/lib/prisma";

// Lógica del asistente de primer arranque (/setup), separada de la Server Action para
// poder probarla sin request (ver test/integration/setup.int.test.ts).

const INSTANCE_ID = "singleton";
// Clave del advisory lock que serializa el setup (cualquier texto fijo sirve: hashtext
// lo convierte en el entero que pide pg_advisory_xact_lock).
const SETUP_LOCK_KEY = "orgtable:setup";

export type SetupOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "ALREADY_SETUP" };

/**
 * Crea el administrador y marca la instancia como configurada, una sola vez.
 *
 * Comprobar `setupCompletedAt` dentro de la transacción NO basta: con READ COMMITTED dos
 * envíos simultáneos leen los dos "sin configurar", cada uno crea su ADMIN y el upsert
 * de la segunda pasa como UPDATE. SELECT … FOR UPDATE tampoco sirve porque la fila de
 * InstanceConfig aún no existe. El advisory lock de transacción hace que la segunda
 * espere a que la primera confirme y, al comprobar, vea el setup ya hecho.
 */
export async function completeInstanceSetup(input: {
  instanceName: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<SetupOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK_KEY}))`;

    const existing = await tx.instanceConfig.findUnique({
      where: { id: INSTANCE_ID },
    });
    if (existing?.setupCompletedAt) {
      return { ok: false, reason: "ALREADY_SETUP" } as const;
    }
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: "ADMIN",
      },
    });
    await tx.instanceConfig.upsert({
      where: { id: INSTANCE_ID },
      create: {
        id: INSTANCE_ID,
        instanceName: input.instanceName,
        setupCompletedAt: new Date(),
      },
      update: { instanceName: input.instanceName, setupCompletedAt: new Date() },
    });
    return { ok: true, userId: user.id } as const;
  });
}
