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
  const user = await prisma.user.create({
    data: { email, name: input.name, passwordHash, role: input.role },
    select: { id: true, email: true },
  });
  return { ok: true, user };
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
