import { describe, it, expect, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { cookies } from "next/headers";
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
// stub sin sesión.
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
