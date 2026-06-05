"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { requireAdmin } from "@/app/lib/dal";
import { hashPassword } from "@/app/lib/auth";
import { revokeAllUserSessions } from "@/app/lib/session";
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
  await requireAdmin();

  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }

  const email = parsed.data.email.toLowerCase();
  const exists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (exists) {
    return { error: "Ya existe un usuario con ese email." };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.create({
    data: {
      email,
      name: parsed.data.name,
      passwordHash,
      role: parsed.data.role,
    },
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

/** Cambia el rol global (ADMIN/MEMBER). No puedes cambiar tu propio rol. */
export async function updateUserRole(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId"));
  const parsed = globalRoleSchema.safeParse(formData.get("role"));
  if (!parsed.success) backToUsers({ error: "invalid" });

  // No puedes degradarte a ti mismo (evita quedarte sin acceso de admin).
  if (userId === admin.id) backToUsers({ error: "self-role" });

  await prisma.user.updateMany({
    where: { id: userId },
    data: { role: parsed.data },
  });
  revalidatePath("/admin/users");
  backToUsers({ ok: "role" });
}

/** Restablece la contraseña de un usuario (el admin teclea la nueva). */
export async function resetUserPassword(formData: FormData): Promise<void> {
  await requireAdmin();
  const parsed = resetPasswordSchema.safeParse({
    userId: formData.get("userId"),
    password: formData.get("password"),
  });
  if (!parsed.success) backToUsers({ error: "password" });

  const passwordHash = await hashPassword(parsed.data.password);
  await prisma.user.updateMany({
    where: { id: parsed.data.userId },
    data: { passwordHash },
  });
  // Al cambiar la contraseña, revocamos todas las sesiones del usuario: cualquier
  // sesión abierta (p. ej. en un dispositivo comprometido) deja de valer al instante.
  await revokeAllUserSessions(parsed.data.userId);
  revalidatePath("/admin/users");
  backToUsers({ ok: "password" });
}

/** Cierra todas las sesiones activas de un usuario (revocación inmediata). */
export async function revokeUserSessions(formData: FormData): Promise<void> {
  await requireAdmin();
  const userId = String(formData.get("userId"));
  await revokeAllUserSessions(userId);
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
  const userId = String(formData.get("userId"));

  if (userId === admin.id) backToUsers({ error: "self-delete" });

  const ownedBoards = await prisma.board.count({ where: { ownerId: userId } });
  if (ownedBoards > 0) backToUsers({ error: "owns-boards" });

  await prisma.user.deleteMany({ where: { id: userId } });
  revalidatePath("/admin/users");
  backToUsers({ ok: "delete" });
}
