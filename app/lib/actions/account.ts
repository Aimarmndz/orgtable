"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, verifySession } from "@/app/lib/dal";
import {
  changeOwnPassword,
  deleteOwnAccount,
  revokeOtherSessions as revokeOtherSessionsService,
  revokeOwnSession,
  updateOwnProfile,
} from "@/app/lib/services/account";
import { recordAudit } from "@/app/lib/audit";
import {
  changePasswordSchema,
  deleteAccountSchema,
  profileSchema,
} from "@/app/lib/validators";

// Acciones de /settings sobre la cuenta propia. La lógica vive en services/account.ts;
// aquí se resuelve quién es el usuario, se valida, se audita y se revalida. Ver
// docs/privacy.md.

export type AccountFormState = {
  error?: string;
  // Campo al que se refiere el error, para marcarlo con aria-invalid.
  field?: string;
  message?: string;
  values?: Record<string, string>;
};

function text(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

/** La sesión actual es obligatoria: las acciones necesitan su id para no cerrarla. */
async function requireSessionId(): Promise<string> {
  const session = await verifySession();
  if (!session) redirect("/login");
  return session.sessionId;
}

export async function updateProfile(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const values = { name: text(formData, "name"), email: text(formData, "email") };
  const parsed = profileSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    currentPassword: text(formData, "currentPassword"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issue?.message ?? "Revisa los datos.",
      field: String(issue?.path[0] ?? ""),
      values,
    };
  }

  const result = await updateOwnProfile(user.id, parsed.data);
  if (!result.ok) {
    if (result.error === "wrong_password") {
      return {
        error: "Para cambiar el email, escribe tu contraseña actual.",
        field: "currentPassword",
        values,
      };
    }
    if (result.error === "email_taken") {
      return { error: "Ese email ya lo usa otra cuenta.", field: "email", values };
    }
    redirect("/login");
  }

  await recordAudit({
    action: "account.updated",
    userId: user.id,
    detail: result.emailChanged ? "nombre y email" : "nombre",
  });
  revalidatePath("/", "layout");
  return { message: "Perfil guardado." };
}

export async function changePassword(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const sessionId = await requireSessionId();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: text(formData, "currentPassword"),
    newPassword: text(formData, "newPassword"),
    confirmPassword: text(formData, "confirmPassword"),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue?.message ?? "Revisa los datos.", field: String(issue?.path[0] ?? "") };
  }

  const result = await changeOwnPassword(user.id, {
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
    keepSessionId: sessionId,
  });
  if (!result.ok) {
    if (result.error === "wrong_password") {
      return { error: "La contraseña actual no es correcta.", field: "currentPassword" };
    }
    redirect("/login");
  }

  await recordAudit({
    action: "account.password_changed",
    userId: user.id,
    detail: `otras sesiones cerradas: ${result.revokedSessions}`,
  });
  revalidatePath("/settings");
  return {
    message:
      result.revokedSessions > 0
        ? `Contraseña cambiada. Se cerraron ${result.revokedSessions} sesiones más.`
        : "Contraseña cambiada.",
  };
}

/** Cierra una sesión propia desde la lista de sesiones abiertas. */
export async function revokeSession(formData: FormData): Promise<void> {
  const user = await requireUser();
  const currentId = await requireSessionId();
  const sessionId = text(formData, "sessionId");
  // La actual se cierra con «Salir», que además borra la cookie.
  if (sessionId && sessionId !== currentId) {
    const count = await revokeOwnSession(user.id, sessionId);
    if (count > 0) {
      await recordAudit({ action: "account.sessions_revoked", userId: user.id, detail: "1" });
    }
  }
  revalidatePath("/settings");
  redirect("/settings#seguridad");
}

export async function revokeOtherSessions(): Promise<void> {
  const user = await requireUser();
  const currentId = await requireSessionId();
  const count = await revokeOtherSessionsService(user.id, currentId);
  if (count > 0) {
    await recordAudit({
      action: "account.sessions_revoked",
      userId: user.id,
      detail: String(count),
    });
  }
  revalidatePath("/settings");
  redirect("/settings#seguridad");
}

export async function deleteAccount(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const user = await requireUser();
  const parsed = deleteAccountSchema.safeParse({ password: text(formData, "password") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message, field: "password" };
  }

  const result = await deleteOwnAccount(user.id, parsed.data.password);
  if (!result.ok) {
    if (result.error === "wrong_password") {
      return { error: "La contraseña no es correcta.", field: "password" };
    }
    if (result.error === "last_admin") {
      return {
        error:
          "Eres la única persona administradora. Nombra a otra antes de borrar tu cuenta.",
      };
    }
    redirect("/login");
  }

  // La fila de auditoría no lleva userId: la cuenta ya no existe y no debe quedar ligada.
  await recordAudit({
    action: "account.deleted",
    detail: `tableros borrados: ${result.boardsDeleted}`,
  });
  // Las sesiones se borraron en cascada; la cookie ya no vale, pero se quita igualmente.
  (await cookies()).delete("session");
  redirect("/login?cuenta=borrada");
}
