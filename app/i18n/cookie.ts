import "server-only";
import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, type Locale } from "./config";

const ONE_YEAR_S = 365 * 24 * 60 * 60;

/**
 * Stores the interface language in its cookie. Only callable from Server Actions and Route
 * Handlers (Next.js only lets those write cookies). Secure when the request came over
 * HTTPS, like the session cookie, so the first run over plain http://IP:3000 still works.
 */
export async function setLocaleCookie(locale: Locale): Promise<void> {
  const proto = (await headers()).get("x-forwarded-proto")?.split(",")[0]?.trim();
  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: ONE_YEAR_S,
    sameSite: "lax",
    secure: proto?.toLowerCase() === "https",
  });
}
