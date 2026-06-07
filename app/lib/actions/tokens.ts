"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/lib/prisma";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { apiTokenNameSchema } from "@/app/lib/validators";
import { generateApiToken } from "@/app/lib/api/tokens";

// Gestión de los tokens de API propios (Hito 9). Crear devuelve el token EN CLARO una
// sola vez (en el estado del formulario); revocar lo borra. La autorización es
// implícita: todo va contra el usuario en sesión. Ver docs/api/public-api.md.

export type CreateTokenState = {
  error?: string;
  // Token en claro recién creado: se muestra una vez y no se vuelve a poder ver.
  token?: string;
  name?: string;
};

export async function createApiToken(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const user = await requireUser();
  const parsed = apiTokenNameSchema.safeParse(formData.get("name"));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Nombre no válido." };
  }

  const { token, hash, prefix } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: { userId: user.id, name: parsed.data, tokenHash: hash, prefix },
    select: { id: true },
  });
  await recordAudit({
    action: "apitoken.created",
    userId: user.id,
    targetType: "apitoken",
    targetId: created.id,
    detail: parsed.data,
  });
  revalidatePath("/settings");
  return { token, name: parsed.data };
}

/** Revoca (borra) un token propio. El WHERE incluye el userId: nadie revoca el de otro. */
export async function revokeApiToken(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const { count } = await prisma.apiToken.deleteMany({
    where: { id, userId: user.id },
  });
  if (count > 0) {
    await recordAudit({
      action: "apitoken.revoked",
      userId: user.id,
      targetType: "apitoken",
      targetId: id,
    });
  }
  revalidatePath("/settings");
}
