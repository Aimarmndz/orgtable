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

// Endpoint POST /api/cron/reminders: 503 sin CRON_SECRET, 401 con cualquier credencial que
// no sea exactamente el secreto (sin lanzar excepción aunque la longitud difiera), 200 con
// el resultado de la pasada.

const SECRET = "s3cr3t-largo";
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

describe("POST /api/cron/reminders (integración)", () => {
  it("responde 503 si CRON_SECRET no está definido", async () => {
    delete process.env.CRON_SECRET;
    const res = await POST(cronRequest(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
  });

  it.each([
    ["secreto de la misma longitud", "Bearer s3cr3t-largX"],
    ["secreto más corto", "Bearer s"],
    ["sin cabecera", undefined],
    ["esquema Basic", `Basic ${SECRET}`],
    ["Bearer vacío", "Bearer "],
  ])("responde 401 con %s y no crea notificaciones", async (_caso, auth) => {
    const res = await POST(cronRequest(auth));
    expect(res.status).toBe(401);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("con el secreto correcto genera los avisos y es idempotente", async () => {
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
