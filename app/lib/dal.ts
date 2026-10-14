import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { decrypt } from "@/app/lib/session";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole } from "@/app/lib/access";

// Data Access Layer: the single SECURE source of truth for "who is the user" and "is the
// instance set up". Each function is memoised per request with React's cache(), so
// calling them several times in one render does not repeat the query. proxy.ts does an
// OPTIMISTIC check (it only looks for the cookie); the real cryptographic validation
// happens here. See docs/authentication.md.

const INSTANCE_ID = "singleton";

export const verifySession = cache(async () => {
  const token = (await cookies()).get("session")?.value;
  const payload = await decrypt(token);
  if (!payload?.userId || !payload.sid) return null;

  // Check against the session store: even with a valid JWT, the session may have been
  // revoked (sign-out, password reset, forced sign-out) or have expired. A single query,
  // memoised per request with cache().
  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session) return null;
  if (session.userId !== payload.userId) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  return { userId: payload.userId, sessionId: payload.sid };
});

export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
});

/** Requires a valid session; redirects to /login otherwise. For layouts and pages. */
export const requireUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});

export const getInstanceConfig = cache(async () => {
  return prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
});

/** true once the setup wizard has been completed. */
export const isSetupComplete = cache(async () => {
  const config = await getInstanceConfig();
  return Boolean(config?.setupCompletedAt);
});

/**
 * Requires the current user to have access to the board (app/lib/access.ts: an explicit
 * membership or one of its workspace). Redirects to /boards without access. Every board
 * mutation (lists, cards…) goes through here.
 *
 * Also returns the user's effective ROLE on the board (OWNER/EDITOR/VIEWER): "what can they
 * do" with that role is checked in each Server Action with the helpers in @/app/lib/roles
 * (canEditBoard, canManageBoard). See docs/authorization.md.
 */
export const requireBoardAccess = cache(async (boardId: string) => {
  const user = await requireUser();
  const role = await effectiveBoardRole(boardId, user.id);
  if (!role) redirect("/boards");
  return { user, role };
});

/**
 * Requires the current user to be a GLOBAL administrator of the instance (User.role =
 * ADMIN). For the administration panel (/admin). Redirects to /boards if not, and to
 * /login without a session (via requireUser).
 */
export const requireAdmin = cache(async () => {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/boards");
  return user;
});
