import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { POST } from "@/app/api/cron/reminders/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
} from "./helpers";

// POST /api/cron/reminders endpoint: 503 without CRON_SECRET, 401 with any credential that
// is not exactly the secret (without throwing even if the length differs), 200 with the
// result of the run.

const SECRET = "s3cr3t-longer";
const originalSecret = process.env.CRON_SECRET;

function cronRequest(authorization?: string): Request {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers["Authorization"] = authorization;
  return new Request("http://test/api/cron/reminders", {
    method: "POST",
    headers,
  });
}

beforeEach(async () => {
  await resetDb();
  process.env.CRON_SECRET = SECRET;
});
afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});
afterAll(async () => {
  await disconnect();
});

describe("POST /api/cron/reminders (integration)", () => {
  it("answers 503 if CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(cronRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it.each([
    ["a secret of the same length", "Bearer s3cr3t-longeX"],
    ["a shorter secret", "Bearer s"],
    ["no header", undefined],
    ["Basic scheme", `Basic ${SECRET}`],
    ["empty Bearer", "Bearer "],
  ])("answers 401 with %s and creates no notifications", async (_case, auth) => {
    const res = await POST(cronRequest(auth));
    expect(res.status).toBe(401);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("with the right secret it creates the reminders and is idempotent", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const card = await seedCard((await seedList(board.id)).id);
    const today = new Date().toISOString().slice(0, 10);
    await prisma.card.update({
      where: { id: card.id },
      data: {
        dueDate: new Date(today),
        assignees: { create: { userId: owner.id } },
      },
    });

    const first = await POST(cronRequest(`Bearer ${SECRET}`));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ created: 1, scanned: 1 });

    const second = await POST(cronRequest(`Bearer ${SECRET}`));
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ created: 0, scanned: 1 });
  });
});
