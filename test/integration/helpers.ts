import { prisma } from "@/app/lib/prisma";
import { createUserAccount } from "@/app/lib/services/users";
import { freeBoardSlug } from "@/app/lib/services/workspaces";
import { generateApiToken } from "@/app/lib/api/tokens";
import { positionAtEnd } from "@/app/lib/ordering";
import { createSession } from "@/app/lib/session";
import { messagesFor } from "@/app/i18n/config";
import { __clearCookies, __clearHeaders } from "../stubs/next-headers";
import type { GlobalRole } from "@/app/lib/roles";
import type { BoardRole } from "@/app/lib/roles";

// Utilities shared by the integration tests. They use the SAME PrismaClient as the app
// (pointed at the test DB by DATABASE_URL), so route handlers and tests share the same
// connection.

// --- Messages ---------------------------------------------------------------------------
// Texts the app returns, taken from locales/ so that tests do not duplicate strings. The
// stub request has neither a `locale` cookie nor Accept-Language, so actions answer in
// English (`en`) unless a test sets one of them.
export const en = messagesFor("en");
export const es = messagesFor("es");

// --- Safety guard -----------------------------------------------------------------------
// Truncating tables is destructive: we refuse to run unless the database name ends in
// `_test`. Prevents wiping development or, worse, production data by mistake.
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("/").pop()?.split("?")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `The integration tests require a database whose name ends in "_test" ` +
        `(DATABASE_URL points at "${dbName || "(empty)"}"). Aborting so no real data is touched.`,
    );
  }
}

// Tables to empty: read from the catalog on every reset instead of keeping a list by hand
// (the fixed list was missing CardAssignee and Comment, which were only emptied through the
// CASCADE; a future table without an FK would have kept data between tests).
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function schemaTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  return rows.map(({ tablename }) => {
    // The name is interpolated into the TRUNCATE: only simple identifiers are accepted.
    if (!TABLE_NAME.test(tablename)) {
      throw new Error(`resetDb: unexpected table name "${tablename}"`);
    }
    return tablename;
  });
}

export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const tables = await schemaTables();
  if (tables.length === 0) {
    throw new Error("resetDb: the schema has no tables; are the migrations missing?");
  }
  const list = tables.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
  // In-memory state that survives between tests of the same file: the next/headers stub's
  // "request" (session cookies, headers) and the rate-limit counters.
  __clearCookies();
  __clearHeaders();
  (
    globalThis as { __orgtableRateBuckets?: Map<string, unknown> }
  ).__orgtableRateBuckets?.clear();
}

/**
 * Signs in as `userId` in the next/headers stub: creates a real Session row and sets the
 * signed cookie, just like the login does. From then on Server Actions and the DAL see that
 * user. Calling it again switches user. It only clears the cookies: headers set earlier
 * with `__setHeaders` are kept (e.g. X-Forwarded-Proto).
 */
export async function loginAs(userId: string): Promise<void> {
  __clearCookies();
  await createSession(userId);
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}

// --- Seeds ------------------------------------------------------------------------------

export async function seedUser(opts?: {
  email?: string;
  name?: string;
  role?: GlobalRole;
  password?: string;
}): Promise<{ id: string; email: string }> {
  const email = opts?.email ?? `user_${Math.random().toString(36).slice(2)}@test.local`;
  const result = await createUserAccount({
    name: opts?.name ?? "Test user",
    email,
    password: opts?.password ?? "contraseña-segura",
    role: opts?.role ?? "MEMBER",
  });
  if (!result.ok) throw new Error(`seedUser failed: ${result.error}`);
  return result.user;
}

/** Creates an API token for a user and returns the PLAIN token (for the Bearer header). */
export async function seedApiToken(
  userId: string,
  opts?: { name?: string; scope?: "full" | "read"; expiresAt?: Date | null },
): Promise<string> {
  const { token, hash, prefix } = generateApiToken();
  await prisma.apiToken.create({
    data: {
      userId,
      name: opts?.name ?? "test",
      tokenHash: hash,
      prefix,
      scope: opts?.scope ?? "full",
      expiresAt: opts?.expiresAt ?? null,
    },
  });
  return token;
}

/**
 * Creates a board with its owner (OWNER member), as createBoard does: in the owner's
 * personal workspace, or in `workspaceId` (an organization), with a free slug.
 */
export async function seedBoard(
  ownerId: string,
  title = "Test board",
  opts?: { workspaceId?: string; visibility?: "WORKSPACE" | "PRIVATE" },
): Promise<{ id: string; title: string; slug: string; workspaceId: string }> {
  const workspaceId =
    opts?.workspaceId ??
    (await prisma.workspace.findUniqueOrThrow({
      where: { personalOwnerId: ownerId },
      select: { id: true },
    })).id;
  const board = await prisma.board.create({
    data: {
      title,
      ownerId,
      workspaceId,
      slug: await freeBoardSlug(prisma, workspaceId, title),
      visibility: opts?.visibility ?? "WORKSPACE",
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
    select: { id: true, title: true, slug: true, workspaceId: true },
  });
  return board;
}

/** Creates an organization owned by `ownerId` and returns it. */
export async function seedOrganization(
  ownerId: string,
  slug = `org-${Math.random().toString(36).slice(2, 10)}`,
): Promise<{ id: string; slug: string }> {
  return prisma.workspace.create({
    data: {
      slug,
      name: `Org ${slug}`,
      kind: "ORGANIZATION",
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
    select: { id: true, slug: true },
  });
}

/** Adds a user to a workspace with a role. */
export async function addWorkspaceMember(
  workspaceId: string,
  userId: string,
  role: "OWNER" | "ADMIN" | "MEMBER" = "MEMBER",
): Promise<void> {
  await prisma.workspaceMember.create({ data: { workspaceId, userId, role } });
}

export async function addMember(
  boardId: string,
  userId: string,
  role: BoardRole = "EDITOR",
): Promise<void> {
  await prisma.boardMember.create({ data: { boardId, userId, role } });
}

export async function seedList(
  boardId: string,
  title = "Test list",
): Promise<{ id: string }> {
  const last = await prisma.list.findFirst({
    where: { boardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return prisma.list.create({
    data: { boardId, title, position: positionAtEnd(last?.position ?? null) },
    select: { id: true },
  });
}

export async function seedCard(
  listId: string,
  title = "Test card",
): Promise<{ id: string }> {
  const last = await prisma.card.findFirst({
    where: { listId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return prisma.card.create({
    data: { listId, title, position: positionAtEnd(last?.position ?? null) },
    select: { id: true },
  });
}

// --- Request to a route handler ---------------------------------------------------------

/** Builds a `Request` with an (optional) Bearer token and JSON body, to call a handler. */
export function apiRequest(
  method: string,
  url: string,
  opts?: { token?: string; body?: unknown },
): Request {
  const headers: Record<string, string> = {};
  if (opts?.token) headers["Authorization"] = `Bearer ${opts.token}`;
  if (opts?.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`http://test${url}`, {
    method,
    headers,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
}

/** Shorthand for the second `{ params }` argument of Next 16 route handlers. */
export function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}

// --- Server Actions -------------------------------------------------------------------------

/** A FormData from plain fields; arrays become repeated fields (checkbox groups). */
export function formOf(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const item of v) fd.append(k, item);
    else fd.set(k, v);
  }
  return fd;
}

/** Runs a Server Action that may end in a redirect and returns the target (or null). */
export async function redirectTarget(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (!digest?.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}
