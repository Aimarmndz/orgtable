import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";

// Data Access Layer: única fuente de verdad SEGURA para "quién es el usuario" y
// "está la instancia configurada". Cada función se memoiza por request con cache()
// de React, así que llamarlas varias veces en el mismo render no repite la consulta.
// El proxy.ts hace un chequeo OPTIMISTA (solo mira si existe la cookie); la
// validación criptográfica real ocurre aquí. Ver docs/authentication.md.

const INSTANCE_ID = "singleton";

export const verifySession = cache(async () => {
  const token = (await cookies()).get("session")?.value;
  const session = await decrypt(token);
  if (!session?.userId) return null;
  return { userId: session.userId };
});

export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
});

/** Exige sesión válida; redirige a /login si no la hay. Para usar en layouts/páginas. */
export const requireUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});

export const getInstanceConfig = cache(async () => {
  return prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
});

/** true si el setup wizard ya se completó. */
export const isSetupComplete = cache(async () => {
  const config = await getInstanceConfig();
  return Boolean(config?.setupCompletedAt);
});

/**
 * Exige que el usuario actual sea miembro del tablero. Redirige a /boards si no
 * tiene acceso. Toda mutación sobre un tablero (listas, tarjetas...) pasa por aquí.
 */
export const requireBoardAccess = cache(async (boardId: string) => {
  const user = await requireUser();
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
  });
  if (!membership) redirect("/boards");
  return { user, role: membership.role };
});
