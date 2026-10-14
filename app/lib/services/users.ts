import "server-only";
import { prisma } from "@/app/lib/prisma";
import { hashPassword } from "@/app/lib/auth";
import type { GlobalRole } from "@/app/lib/roles";

// Lógica de negocio de las cuentas de usuario, SIN contexto de request (cookies/sesión)
// ni autorización ni auditoría: de eso se encargan las Server Actions que la llaman
// (app/lib/actions/admin.ts, setup.ts). Aislarla así la hace reutilizable y, sobre todo,
// testeable de forma directa contra la base de datos (ver test/integration/users.int.test.ts).

export type NewUserInput = {
  name: string;
  email: string;
  password: string;
  role: GlobalRole;
  // Solo en el registro abierto (/register): cuándo aceptó la política y las condiciones.
  termsAcceptedAt?: Date;
  // Interface language at sign-up (open registration), for their notifications.
  locale?: string;
};

export type CreateUserResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; error: "email_taken" };

/**
 * Crea una cuenta: normaliza el email a minúsculas, rechaza duplicados y guarda la
 * contraseña SIEMPRE hasheada (bcrypt, nunca en claro). Idempotencia de email garantizada
 * además por el índice único de la columna.
 */
export async function createUserAccount(
  input: NewUserInput,
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();

  const exists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (exists) return { ok: false, error: "email_taken" };

  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        name: input.name,
        passwordHash,
        role: input.role,
        termsAcceptedAt: input.termsAcceptedAt ?? null,
        locale: input.locale ?? null,
      },
      select: { id: true, email: true },
    });
    return { ok: true, user };
  } catch (e) {
    // Dos altas simultáneas con el mismo email pasan las dos la comprobación de arriba y
    // la segunda choca con el índice único. Con el registro abierto es fácil (doble clic),
    // así que se responde como un duplicado normal en vez de con un 500.
    if (isUniqueViolation(e)) return { ok: false, error: "email_taken" };
    throw e;
  }
}

/** Error de Prisma por violar un índice único (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && "code" in e && e.code === "P2002";
}

export type ResetPasswordResult =
  | { ok: true; revokedTokens: number }
  | { ok: false; error: "not_found" };

/**
 * Restablece la contraseña de un usuario y le retira TODO acceso vigente: revoca sus
 * sesiones y borra sus tokens de API. Los tokens no dependen de la tabla Session, así
 * que revocar solo sesiones dejaría viva la API (/api/v1) a quien hubiera creado un
 * token con la cuenta comprometida. Borrar es la semántica de revocación del ADR 0013.
 *
 * Se comprueba que el usuario existe ANTES de hashear (bcrypt es caro) y los tres
 * cambios van en una transacción: o se aplican todos o ninguno.
 */
export async function resetPasswordAndRevokeAccess(
  userId: string,
  password: string,
): Promise<ResetPasswordResult> {
  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!exists) return { ok: false, error: "not_found" };

  const passwordHash = await hashPassword(password);
  const [updated, , tokens] = await prisma.$transaction([
    prisma.user.updateMany({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.apiToken.deleteMany({ where: { userId } }),
  ]);
  // El usuario pudo borrarse entre la comprobación y la transacción.
  if (updated.count === 0) return { ok: false, error: "not_found" };
  return { ok: true, revokedTokens: tokens.count };
}

export type DeleteUserResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "owns_boards" };

/**
 * Borra una cuenta que NO es propietaria de ningún tablero. La condición va en el mismo
 * DELETE (`boards: { none: {} }`) y no en una consulta previa: si el usuario creara un
 * tablero entre la comprobación y el borrado, la cascada por ownerId se llevaría sus
 * listas, tarjetas y filas Attachment, dejando los binarios huérfanos en el volumen de
 * adjuntos. Así la cascada nunca alcanza adjuntos.
 */
export async function deleteUserAccount(
  userId: string,
): Promise<DeleteUserResult> {
  const { count } = await prisma.user.deleteMany({
    where: { id: userId, boards: { none: {} } },
  });
  if (count > 0) return { ok: true };
  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return { ok: false, error: exists ? "owns_boards" : "not_found" };
}
