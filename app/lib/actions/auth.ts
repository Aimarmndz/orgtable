"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale } from "@/app/i18n/config";
import { prisma } from "@/app/lib/prisma";
import { verifyPasswordOrDummy } from "@/app/lib/auth";
import { createSession, deleteSession } from "@/app/lib/session";
import { verifySession } from "@/app/lib/dal";
import { loginSchema } from "@/app/lib/validators";
import { rateLimit, resetRateLimit } from "@/app/lib/rate-limit";
import { recordAudit, clientIp } from "@/app/lib/audit";

// `values` devuelve lo tecleado (nunca la contraseña) para repintar el formulario: React
// 19 resetea los formularios no controlados tras la acción y, sin esto, un error borraba
// el email.
export type AuthState = { error?: string; values?: { email: string } };

// Hasta 10 intentos de login por IP cada 10 minutos (anti fuerza bruta). Solo se aplica
// si hay IP fiable (TRUSTED_PROXY_HOPS > 0, ver app/lib/client-ip.ts); sin ella no se
// agrupa a todos en un bucket común, que dejaría el login bloqueado para todo el mundo.
const LOGIN_LIMIT = 10;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;

// Límite por cuenta, independiente de la IP: frena los ataques repartidos entre muchas
// IPs. Cuenta los intentos fallidos (también para emails que no existen, para no revelar
// cuáles existen) y se reinicia tras un login correcto. Riesgo aceptado: quien conozca un
// email puede bloquear esa cuenta hasta 15 minutos. Ver docs/decisions/0009.
const EMAIL_LIMIT = 20;
const EMAIL_WINDOW_MS = 15 * 60 * 1000;

function tooManyAttempts(
  retryAfterSec: number,
  values: AuthState["values"],
): AuthState {
  return {
    error: `Demasiados intentos. Inténtalo de nuevo en ${retryAfterSec} s.`,
    values,
  };
}

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const ip = await clientIp();
  const rawEmail = formData.get("email");
  const values = { email: typeof rawEmail === "string" ? rawEmail.slice(0, 254) : "" };

  if (ip) {
    const limit = rateLimit(`login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!limit.ok) {
      // Una fila por ventana bloqueada, no una por intento: un ataque sostenido no debe
      // llenar AuditLog justo cuando el límite lo está conteniendo.
      if (limit.firstBlock) {
        await recordAudit({ action: "auth.login_rate_limited", ip, detail: "límite por IP" });
      }
      return tooManyAttempts(limit.retryAfterSec, values);
    }
  }

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: "Revisa el email y la contraseña.", values };
  }
  const email = parsed.data.email.toLowerCase();

  // Se cuenta ANTES de verificar (sin carreras entre peticiones simultáneas) y se borra
  // si el login es correcto, así que en la práctica solo suman los fallos.
  const emailKey = `login-email:${email}`;
  const emailLimit = rateLimit(emailKey, EMAIL_LIMIT, EMAIL_WINDOW_MS);
  if (!emailLimit.ok) {
    if (emailLimit.firstBlock) {
      await recordAudit({
        action: "auth.login_rate_limited",
        ip,
        detail: "límite por cuenta",
      });
    }
    return tooManyAttempts(emailLimit.retryAfterSec, values);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Si el usuario no existe se verifica contra un hash ficticio del mismo coste, para no
  // filtrar por tiempo si un email está registrado.
  const valid = await verifyPasswordOrDummy(
    parsed.data.password,
    user?.passwordHash ?? null,
  );

  if (!user || !valid) {
    // Sin el email tecleado: podría ser de un tercero (o una contraseña pegada en el
    // campo equivocado) y acabaría visible en /admin/audit. Si la cuenta existe basta
    // con su userId.
    await recordAudit({
      action: "auth.login_failed",
      userId: user?.id ?? null,
      ip,
    });
    return { error: "Credenciales incorrectas.", values };
  }

  resetRateLimit(emailKey);
  await createSession(user.id);
  // The account's language wins over the browser's on any device it signs in from.
  if (isLocale(user.locale)) {
    (await cookies()).set(LOCALE_COOKIE, user.locale, {
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
      sameSite: "lax",
    });
  }
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
