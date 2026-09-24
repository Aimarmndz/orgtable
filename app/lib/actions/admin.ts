"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/dal";
import {
  createUserAccount,
  deleteUserAccount,
  resetPasswordAndRevokeAccess,
} from "@/app/lib/services/users";
import { revokeAllUserSessions } from "@/app/lib/session";
import { recordAudit } from "@/app/lib/audit";
import {
  createUserSchema,
  globalRoleSchema,
  resetPasswordSchema,
} from "@/app/lib/validators";

// Administración de usuarios de la instancia (Hito 3). Solo el ADMIN global puede
// crear cuentas, cambiar el rol global, restablecer contraseñas o borrar usuarios.
// No hay registro abierto: el administrador da de alta a las personas. Ver
// docs/authorization.md y docs/admin.md.

export type CreateUserState = { error?: string; message?: string };

/** Da de alta una cuenta de usuario. Devuelve estado para useActionState. */
export async function createUser(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const admin = await requireAdmin();

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }

  // La lógica de creación (normalizar email, rechazar duplicados, hashear) vive en el
  // servicio reutilizable y testeable; aquí solo autorizamos y auditamos.
  const result = await createUserAccount(parsed.data);
  if (!result.ok) {
    return { error: "Ya existe un usuario con ese email." };
  }
  await recordAudit({
    action: "user.created",
    userId: admin.id,
    targetType: "user",
    targetId: result.user.id,
    detail: `${result.user.email} (${parsed.data.role})`,
  });
  revalidatePath("/admin/users");
  return { message: `Cuenta creada para ${parsed.data.name}.` };
}

// Las acciones por fila (cambiar rol, restablecer contraseña, borrar) devuelven el
// resultado mediante una redirección con query (?ok=… / ?error=…) que la página
// /admin/users traduce a un mensaje. Así evitamos un componente cliente por fila.
function backToUsers(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString();
  redirect(`/admin/users${qs ? `?${qs}` : ""}`);
}

// Id del usuario objetivo: `String(null)` daría "null" y la acción seguiría adelante.
function readUserId(formData: FormData): string {
  const userId = formData.get("userId");
  if (typeof userId !== "string" || userId === "") backToUsers({ error: "invalid" });
  return userId;
}

/** Cambia el rol global (ADMIN/MEMBER). No puedes cambiar tu propio rol. */
export async function updateUserRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);
  const parsed = globalRoleSchema.safeParse(formData.get("role"));
  if (!parsed.success) backToUsers({ error: "invalid" });

  // No puedes degradarte a ti mismo (evita quedarte sin acceso de admin).
  if (userId === admin.id) backToUsers({ error: "self-role" });

  // Se mira el count antes de auditar: con un id inexistente no hay nada que registrar.
  const { count } = await prisma.user.updateMany({
    where: { id: userId },
    data: { role: parsed.data },
  });
  if (count === 0) backToUsers({ error: "not-found" });
  await recordAudit({
    action: "user.role_changed",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
    detail: `→ ${parsed.data}`,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "role" });
}

/** Restablece la contraseña de un usuario (el admin teclea la nueva). */
export async function resetUserPassword(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) backToUsers({ error: "password" });

  // Al cambiar la contraseña se retira todo acceso vigente del usuario: sus sesiones
  // (navegador) y sus tokens de API, que no dependen de la sesión. Si la cuenta estaba
  // comprometida, un token creado por el atacante seguiría abriendo /api/v1.
  const result = await resetPasswordAndRevokeAccess(
    parsed.data.userId,
    parsed.data.password,
  );
  if (!result.ok) backToUsers({ error: "not-found" });
  await recordAudit({
    action: "user.password_reset",
    userId: admin.id,
    targetType: "user",
    targetId: parsed.data.userId,
    detail: `tokens de API revocados: ${result.revokedTokens}`,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "password" });
}

/** Cierra todas las sesiones activas de un usuario (revocación inmediata). */
export async function revokeUserSessions(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);
  // Tener 0 sesiones activas es válido, así que la existencia se comprueba aparte.
  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!exists) backToUsers({ error: "not-found" });
  await revokeAllUserSessions(userId);
  await recordAudit({
    action: "user.sessions_revoked",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "revoked" });
}

/**
 * Borra una cuenta. No puedes borrarte a ti mismo. Si el usuario es propietario de
 * algún tablero, se bloquea: borrarlo arrastraría sus tableros en cascada. El admin
 * debe transferir o borrar esos tableros primero.
 */
export async function deleteUser(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = readUserId(formData);

  if (userId === admin.id) backToUsers({ error: "self-delete" });

  // La comprobación de tableros propios va dentro del DELETE (ver el servicio): así la
  // cascada nunca borra filas Attachment dejando sus ficheros huérfanos en disco.
  const result = await deleteUserAccount(userId);
  if (!result.ok) {
    backToUsers({
      error: result.error === "owns_boards" ? "owns-boards" : "not-found",
    });
  }
  await recordAudit({
    action: "user.deleted",
    userId: admin.id,
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "delete" });
}
