"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import {
  apiTokenNameSchema,
  apiTokenScopeSchema,
  apiTokenExpirySchema,
} from "@/app/lib/validators";
import { generateApiToken } from "@/app/lib/api/tokens";

const DAY_MS = 24 * 60 * 60 * 1000;

const createTokenSchema = z.object({
  name: apiTokenNameSchema,
  scope: apiTokenScopeSchema,
  expiry: apiTokenExpirySchema,
});

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
  // Nombre, permisos y caducidad se validan juntos: un valor no reconocido es un error
  // y no se crea nada (antes caía en silencio a escritura y sin caducidad).
  const parsed = createTokenSchema.safeParse({
    name: formData.get("name"),
    scope: formData.get("scope"),
    expiry: formData.get("expiry"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // Los enums de validators.ts no llevan mensaje propio (zod lo daría en inglés).
    const field = issue?.path[0];
    const error =
      field === "scope"
        ? "Permisos no válidos."
        : field === "expiry"
          ? "Caducidad no válida."
          : (issue?.message ?? "Datos no válidos.");
    return { error };
  }
  const { name, scope } = parsed.data;
  const expiryDays = Number(parsed.data.expiry);
  const expiresAt = expiryDays > 0 ? new Date(Date.now() + expiryDays * DAY_MS) : null;

  const { token, hash, prefix } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      userId: user.id,
      name,
      tokenHash: hash,
      prefix,
      scope,
      expiresAt,
    },
    select: { id: true },
  });
  await recordAudit({
    action: "apitoken.created",
    userId: user.id,
    targetType: "apitoken",
    targetId: created.id,
    detail: `${name} (${scope})`,
  });
  revalidatePath("/settings");
  return { token, name };
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
