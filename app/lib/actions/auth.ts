"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/app/lib/prisma";
import { verifyPassword } from "@/app/lib/auth";
import { createSession, deleteSession } from "@/app/lib/session";
import { verifySession } from "@/app/lib/dal";
import { loginSchema } from "@/app/lib/validators";
import { rateLimit } from "@/app/lib/rate-limit";
import { recordAudit, clientIp } from "@/app/lib/audit";

export type AuthState = { error?: string };

// Hasta 10 intentos de login por IP cada 10 minutos (anti fuerza bruta).
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const ip = await clientIp();

  const limit = rateLimit(`login:${ip ?? "unknown"}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.ok) {
    await recordAudit({ action: "auth.login_rate_limited", ip });
    return {
      error: `Demasiados intentos. Inténtalo de nuevo en ${limit.retryAfterSec} s.`,
    };
  }

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
    await recordAudit({
      action: "auth.login_failed",
      userId: user?.id ?? null,
      ip,
      detail: parsed.data.email.toLowerCase(),
    });
    return { error: "Credenciales incorrectas." };
  }

  await createSession(user.id);
  await recordAudit({ action: "auth.login", userId: user.id, ip });
  redirect("/boards");
}

export async function logout(): Promise<void> {
  const session = await verifySession();
  await deleteSession();
  if (session) {
    await recordAudit({ action: "auth.logout", userId: session.userId });
  }
  redirect("/login");
}
