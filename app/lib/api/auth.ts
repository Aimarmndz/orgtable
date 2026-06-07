import "server-only";
import { prisma } from "@/app/lib/prisma";
import type { BoardRole } from "@/app/lib/roles";
import { hashToken } from "./tokens";

// Autenticación y autorización de la API pública (Hito 9). A diferencia del DAL (que usa
// cookies y redirige), aquí trabajamos con `Authorization: Bearer <token>` y devolvemos
// códigos HTTP. El servidor sigue siendo la única autoridad: el rol del tablero se
// vuelve a comprobar contra board_members en cada petición. Ver docs/api/public-api.md.

/**
 * Resuelve el usuario a partir de la cabecera Authorization. Devuelve `{ userId }` o
 * null si no hay token válido. De paso, marca `lastUsedAt` (best-effort).
 */
export async function authenticateApiToken(
  request: Request,
): Promise<{ userId: string } | null> {
  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;

  const record = await prisma.apiToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { id: true, userId: true },
  });
  if (!record) return null;

  // Marca de último uso; nunca debe hacer fallar la petición.
  await prisma.apiToken
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return { userId: record.userId };
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
