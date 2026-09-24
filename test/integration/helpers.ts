import { prisma } from "@/app/lib/prisma";
import { createUserAccount } from "@/app/lib/services/users";
import { generateApiToken } from "@/app/lib/api/tokens";
import { positionAtEnd } from "@/app/lib/ordering";
import { createSession } from "@/app/lib/session";
import { __clearCookies } from "../stubs/next-headers";
import type { GlobalRole } from "@/app/lib/roles";
import type { BoardRole } from "@/app/lib/roles";

// Utilidades compartidas por los tests de integración. Usan el MISMO PrismaClient que la
// app (apuntado a la BD de test por DATABASE_URL), así que los route handlers y los tests
// ven la misma conexión.

// --- Guardia de seguridad ---------------------------------------------------------------
// Truncar tablas es destructivo: nos negamos a correr si la base de datos no acaba en
// `_test`. Evita borrar datos de desarrollo o, peor, de producción por error.
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  const dbName = url.split("/").pop()?.split("?")[0] ?? "";
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Los tests de integración exigen una base de datos cuyo nombre acabe en "_test" ` +
        `(DATABASE_URL apunta a "${dbName || "(vacío)"}"). Abortando para no tocar datos reales.`,
    );
  }
}

// Tablas a vaciar: se leen del catálogo en cada reset en vez de mantener una lista a mano
// (a la lista fija le faltaban CardAssignee y Comment, que solo se vaciaban por el
// CASCADE; una tabla futura sin FK se habría quedado con datos entre tests).
const TABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

async function schemaTables(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  return rows.map(({ tablename }) => {
    // El nombre se interpola en el TRUNCATE: solo se aceptan identificadores simples.
    if (!TABLE_NAME.test(tablename)) {
      throw new Error(`resetDb: nombre de tabla inesperado "${tablename}"`);
    }
    return tablename;
  });
}

export async function resetDb(): Promise<void> {
  assertTestDatabase();
  const tables = await schemaTables();
  if (tables.length === 0) {
    throw new Error("resetDb: el esquema no tiene tablas; ¿faltan las migraciones?");
  }
  const list = tables.map((t) => `"${t}"`).join(", ");
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
  // Estado en memoria que sobrevive entre tests del mismo archivo: la "petición" del stub
  // de next/headers (cookies de sesión, cabeceras) y los contadores del rate limit.
  __clearCookies();
  (
    globalThis as { __orgtableRateBuckets?: Map<string, unknown> }
  ).__orgtableRateBuckets?.clear();
}

/**
 * Inicia sesión como `userId` en el stub de next/headers: crea una fila Session real y
 * deja la cookie firmada, igual que el login. A partir de ahí las Server Actions y el DAL
 * ven a ese usuario. Llamarla otra vez cambia de usuario.
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
    name: opts?.name ?? "Usuario de prueba",
    email,
    password: opts?.password ?? "contraseña-segura",
    role: opts?.role ?? "MEMBER",
  });
  if (!result.ok) throw new Error(`seedUser falló: ${result.error}`);
  return result.user;
}

/** Crea un token de API para un usuario y devuelve el token EN CLARO (para el Bearer). */
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

/** Crea un tablero con su propietario (miembro OWNER), como hace createBoard. */
export async function seedBoard(
  ownerId: string,
  title = "Tablero de prueba",
): Promise<{ id: string; title: string }> {
  const board = await prisma.board.create({
    data: {
      title,
      ownerId,
      members: { create: { userId: ownerId, role: "OWNER" } },
    },
    select: { id: true, title: true },
  });
  return board;
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
  title = "Lista de prueba",
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
  title = "Tarjeta de prueba",
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

// --- Petición a un route handler --------------------------------------------------------

/** Construye un `Request` con (opcional) Bearer y cuerpo JSON, para invocar un handler. */
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

/** Azúcar para el segundo argumento `{ params }` de los route handlers de Next 16. */
export function ctx<T extends Record<string, string>>(params: T) {
  return { params: Promise.resolve(params) };
}
