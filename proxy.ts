import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// En Next.js 16 el middleware se llama `proxy` (runtime Node.js). Aquí hacemos un
// chequeo de auth OPTIMISTA: solo comprobamos si EXISTE la cookie de sesión, sin
// validarla criptográficamente (eso lo hace el DAL en app/lib/dal.ts, en cada
// layout/página protegida). El objetivo es evitar renderizar rutas privadas a quien
// claramente no ha iniciado sesión. Ver docs/authentication.md.

const PUBLIC_PATHS = ["/login", "/setup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSession = request.cookies.has("session");

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  // Excluye rutas de API, assets estáticos e imágenes del proxy.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
