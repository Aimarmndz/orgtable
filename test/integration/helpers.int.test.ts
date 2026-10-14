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

// Guard for the test infrastructure itself: resetDb must empty ALL tables (the fixed list
// had lost CardAssignee and Comment) and leave the stub's "request" without a session or
// headers; loginAs, on the other hand, keeps the injected headers.
describe("resetDb", () => {
  it("empties every table, including CardAssignee, Comment and InstanceConfig", async () => {
    await resetDb();
    const u = await seedUser();
    const board = await seedBoard(u.id);
    const list = await seedList(board.id);
    const card = await seedCard(list.id);
    await prisma.cardAssignee.create({ data: { cardId: card.id, userId: u.id } });
    await prisma.comment.create({ data: { cardId: card.id, authorId: u.id, text: "hello" } });
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

  // The test above also passed with the fixed list (CardAssignee and Comment go through the
  // CASCADE of Card/User). A table with no FK to anything is only emptied if resetDb reads
  // the catalog, which is what has to be guaranteed for future tables.
  it("also empties a table without FKs that it does not know in advance", async () => {
    // In case an earlier run died before the finally.
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "zz_reset_probe"`);
    await prisma.$executeRawUnsafe(
      `CREATE TABLE "zz_reset_probe" ("id" INTEGER PRIMARY KEY)`,
    );
    try {
      await prisma.$executeRawUnsafe(`INSERT INTO "zz_reset_probe" ("id") VALUES (1)`);

      await resetDb();

      const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "zz_reset_probe"`,
      );
      expect(Number(rows[0]?.n)).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "zz_reset_probe"`);
    }
  });
});

describe("loginAs and the request headers", () => {
  it("keeps the headers set earlier: the cookie is Secure after X-Forwarded-Proto https", async () => {
    await resetDb();
    const u = await seedUser();
    __setHeaders({ "x-forwarded-proto": "https", "x-forwarded-for": "203.0.113.5" });

    await loginAs(u.id);

    expect(__getCookieOptions("session")).toMatchObject({ secure: true });
    expect((await headers()).get("x-forwarded-for")).toBe("203.0.113.5");
  });

  it("resetDb does clear the injected headers", async () => {
    __setHeaders({ "x-forwarded-proto": "https" });
    await resetDb();
    expect((await headers()).get("x-forwarded-proto")).toBeNull();
  });
});
