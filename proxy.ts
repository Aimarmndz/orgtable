import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildContentSecurityPolicy, generateNonce } from "@/app/lib/csp";

// En Next.js 16 el middleware se llama `proxy` (runtime Node.js). Hace dos cosas:
//
// 1. Chequeo de auth OPTIMISTA: solo comprueba si EXISTE la cookie de sesión, sin
//    validarla criptográficamente (eso lo hace el DAL en app/lib/dal.ts, en cada
//    layout/página protegida). Evita renderizar rutas privadas a quien claramente no ha
//    iniciado sesión. Ver docs/authentication.md.
// 2. Content-Security-Policy con un nonce por petición (app/lib/csp.ts). Va en la
//    petición (Next extrae el nonce para sus scripts; el layout raíz lo lee de
//    `x-nonce` para el script del tema) y en la respuesta (la aplica el navegador).

// /register comprueba él mismo si el registro está abierto; /legal se lee sin sesión
// (la política de privacidad tiene que poder leerse ANTES de crear la cuenta).
const PUBLIC_PATHS = ["/login", "/setup", "/register", "/legal"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSession = request.cookies.has("session");

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }

  const nonce = generateNonce();
  const csp = buildContentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === "development",
  );
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Excluye rutas de API (su CSP va en next.config.ts), assets estáticos e imágenes.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
