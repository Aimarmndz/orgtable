"use server";

import { redirect } from "next/navigation";
import { createUserAccount } from "@/app/lib/services/users";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { createSession } from "@/app/lib/session";
import { getLocale } from "@/app/i18n/server";
import { registerSchema } from "@/app/lib/validators";
import { rateLimit } from "@/app/lib/rate-limit";
import { recordAudit, clientIp } from "@/app/lib/audit";

// Registro abierto (/register). Solo funciona si el admin lo ha abierto en
// /admin/instance y la instancia tiene responsable y contacto (sin ellos la política de
// privacidad estaría incompleta). Las cuentas nuevas son siempre MEMBER. Ver
// docs/privacy.md y docs/authentication.md.

export type RegisterState = {
  error?: string;
  field?: "name" | "email" | "password" | "acceptTerms";
  // Lo tecleado, para repintar el formulario tras un error. Nunca la contraseña.
  values?: { name: string; email: string };
};

// Por IP: 5 altas por hora. Solo si hay IP fiable (TRUSTED_PROXY_HOPS > 0); sin ella no se
// agrupa a todo el mundo en un bucket común.
const IP_LIMIT = 5;
const IP_WINDOW_MS = 60 * 60 * 1000;
// Tope de toda la instancia: frena una oleada de bots aunque no haya IP fiable o vengan de
// muchas IPs. Riesgo aceptado: durante un ataque, la gente real tampoco puede registrarse
// hasta que pase la hora (se ve en /admin/audit como auth.register_rate_limited).
const GLOBAL_LIMIT = 30;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

function text(formData: FormData, key: string, max: number): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function register(
  _prev: RegisterState,
  formData: FormData,
): Promise<RegisterState> {
  const values = { name: text(formData, "name", 60), email: text(formData, "email", 254) };

  if (!(await isRegistrationOpen())) {
    return { error: "El registro está cerrado en esta instancia.", values };
  }

  // Campo trampa: invisible para las personas (y fuera del orden de tabulación), los bots
  // que rellenan todo lo escriben. Se responde con un error genérico, sin pistas.
  if (text(formData, "website", 200) !== "") {
    return { error: "No se pudo crear la cuenta. Inténtalo de nuevo.", values };
  }

  const parsed = registerSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    acceptTerms: formData.get("acceptTerms") ?? undefined,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      error: issue?.message ?? "Revisa los datos.",
      field:
        field === "name" || field === "email" || field === "password" || field === "acceptTerms"
          ? field
          : undefined,
      values,
    };
  }

  // Se cuenta tras validar: un error al teclear no gasta el cupo de nadie. Lo que sí
  // cuenta es cada alta (o intento con un email ya registrado) con datos válidos.
  const ip = await clientIp();
  const limits = [
    ...(ip ? [rateLimit(`register:${ip}`, IP_LIMIT, IP_WINDOW_MS)] : []),
    rateLimit("register:global", GLOBAL_LIMIT, GLOBAL_WINDOW_MS),
  ];
  const blocked = limits.find((l) => !l.ok);
  if (blocked) {
    if (blocked.firstBlock) {
      await recordAudit({ action: "auth.register_rate_limited", ip });
    }
    const minutes = Math.ceil(blocked.retryAfterSec / 60);
    return {
      error: `Se han creado demasiadas cuentas seguidas. Inténtalo dentro de ${minutes} min.`,
      values,
    };
  }

  const result = await createUserAccount({
    name: parsed.data.name,
    email: parsed.data.email,
    password: parsed.data.password,
    role: "MEMBER",
    termsAcceptedAt: new Date(),
    locale: await getLocale(),
  });
  if (!result.ok) {
    // Revela que el email ya tiene cuenta. Sin verificación por email no hay forma de
    // evitarlo sin romper el registro; el límite de altas frena la enumeración masiva.
    return {
      error: "Ya existe una cuenta con ese email. Inicia sesión.",
      field: "email",
      values,
    };
  }

  await createSession(result.user.id);
  await recordAudit({ action: "auth.registered", userId: result.user.id, ip });
  redirect("/boards");
}
