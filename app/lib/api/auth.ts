import "server-only";
import { prisma } from "@/app/lib/prisma";
import type { BoardRole } from "@/app/lib/roles";
import { hashToken } from "./tokens";

// Autenticación y autorización de la API pública (Hito 9). A diferencia del DAL (que usa
// cookies y redirige), aquí trabajamos con `Authorization: Bearer <token>` y devolvemos
// códigos HTTP. El servidor sigue siendo la única autoridad: el rol del tablero se
// vuelve a comprobar contra board_members en cada petición. Ver docs/api/public-api.md.

export type ApiAuth = { userId: string; scope: string };

/**
 * Resuelve el usuario a partir de la cabecera Authorization. Devuelve `{ userId, scope }`
 * o null si no hay token válido o está CADUCADO. De paso, marca `lastUsedAt` (best-effort).
 */
export async function authenticateApiToken(
  request: Request,
): Promise<ApiAuth | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true, scope: true, expiresAt: true },
  });
  if (!record) return null;
  // Token caducado: deja de valer (no se borra; el usuario lo verá expirado en /settings).
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) return null;

  // Marca de último uso; nunca debe hacer fallar la petición, pero el fallo se registra:
  // lastUsedAt es lo que mira el usuario para detectar tokens usados sin su permiso, y
  // congelarlo en silencio lo engañaría. Nunca se registra el token ni su hash.
  await prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((err: unknown) =>
      console.error("[api-auth] no se pudo actualizar lastUsedAt", {
        tokenId: record.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

  return { userId: record.userId, scope: record.scope };
}

/** true si el token es de solo lectura (no puede escribir). */
export function isReadOnly(auth: ApiAuth): boolean {
  return auth.scope === "read";
}

/** Rol del usuario en un tablero, o null si no es miembro (= sin acceso). */
export async function apiBoardRole(
  userId: string,
  boardId: string,
): Promise<BoardRole | null> {
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}
