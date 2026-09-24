import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { cookies, headers } from "next/headers";
import { __getCookieOptions, __setHeaders } from "../stubs/next-headers";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  loginAs,
} from "./helpers";

afterAll(async () => {
  await disconnect();
});

// Guarda de la propia infraestructura de tests: resetDb debe dejar vacías TODAS las
// tablas (la lista fija se había quedado sin CardAssignee ni Comment) y la "petición" del
// stub sin sesión ni cabeceras; loginAs, en cambio, conserva las cabeceras inyectadas.
describe("resetDb", () => {
  it("vacía todas las tablas, incluidas CardAssignee, Comment e InstanceConfig", async () => {
    await resetDb();
    const u = await seedUser();
    const board = await seedBoard(u.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    await prisma.cardAssignee.create({ data: { cardId: card.id, userId: u.id } });
    await prisma.comment.create({ data: { cardId: card.id, authorId: u.id, text: "hola" } });
    await prisma.instanceConfig.create({
      data: { id: "singleton", instanceName: "x", setupCompletedAt: new Date() },
    });
    await loginAs(u.id);

    await resetDb();

    const counts = await Promise.all([
      prisma.user.count(),
      prisma.session.count(),
      prisma.board.count(),
      prisma.card.count(),
      prisma.cardAssignee.count(),
      prisma.comment.count(),
      prisma.instanceConfig.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect((await cookies()).get("session")).toBeUndefined();
  });
});

describe("loginAs y las cabeceras de la petición", () => {
  it("conserva las cabeceras puestas antes: la cookie sale Secure tras X-Forwarded-Proto https", async () => {
    await resetDb();
    const u = await seedUser();
    __setHeaders({ "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.5" });

    await loginAs(u.id);

    expect(__getCookieOptions("session")).toMatchObject({ secure: true });
    expect((await headers()).get("x-forwarded-for")).toBe("203.0.113.5");
  });

  it("resetDb sí vacía las cabeceras inyectadas", async () => {
    __setHeaders({ "x-forwarded-proto": "https" });
    await resetDb();
    expect((await headers()).get("x-forwarded-proto")).toBeNull();
  });
});
