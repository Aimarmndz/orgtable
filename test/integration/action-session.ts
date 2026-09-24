import { SignJWT } from "jose";
import { prisma } from "@/app/lib/prisma";

// Sesión real para invocar Server Actions desde los tests de integración. Las acciones
// autorizan con el DAL (cookie `session` → JWT → fila Session), así que el test crea la
// fila y firma el JWT igual que createSession; solo la lectura de la cookie se sustituye
// con un vi.mock("next/headers") local en cada archivo de test (ver cookieJar allí). Así
// se ejercen de verdad requireBoardAccess y las guardas de rol.

// Secreto solo para los tests: se inyecta con vi.stubEnv en cada archivo, para no depender
// de que el entorno (local o CI) defina SESSION_SECRET.
export const TEST_SESSION_SECRET = "orgtable-test-session-secret-0123456789";

/** Crea una sesión para `userId` y devuelve el valor de la cookie `session`. */
export async function sessionTokenFor(userId: string): Promise<string> {
  const session = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  return new SignJWT({ userId, sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(TEST_SESSION_SECRET));
}
