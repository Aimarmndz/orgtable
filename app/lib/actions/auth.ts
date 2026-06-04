"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { verifyPassword } from "@/app/lib/auth";
import { createSession, deleteSession } from "@/app/lib/session";
import { loginSchema } from "@/app/lib/validators";

export type AuthState = { error?: string };

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Revisa el email y la contraseña." };
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });
  // Verificamos siempre la contraseña (aunque el usuario no exista usamos un hash
  // ficticio) para no filtrar por tiempo si un email está registrado.
  const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
  const valid = await verifyPassword(parsed.data.password, hash);

  if (!user || !valid) {
    return { error: "Credenciales incorrectas." };
  }

  await createSession(user.id);
  redirect("/boards");
}

export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
