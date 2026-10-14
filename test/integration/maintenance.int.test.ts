import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { purgeExpiredData } from "@/app/lib/services/maintenance";
import { POST } from "@/app/api/cron/maintenance/route";
import { resetDb, disconnect, seedUser } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("purgeExpiredData", () => {
  it("deletes what expired under the privacy policy's retention periods, and nothing else", async () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const user = await seedUser();

    await prisma.auditLog.createMany({
      data: [
        { action: "auth.login", createdAt: ago(91), ip: "203.0.113.1" },
        { action: "auth.login", createdAt: ago(89), ip: "203.0.113.2" },
      ],
    });
    await prisma.session.createMany({
      data: [
        { userId: user.id, createdAt: ago(40), expiresAt: ago(33) }, // expired >30 d ago
        { userId: user.id, createdAt: ago(10), expiresAt: ago(3) }, // expired recently
        { userId: user.id, createdAt: ago(40), expiresAt: ago(33 - 7), revokedAt: ago(35) }, // revoked >30 d ago
        { userId: user.id, createdAt: ago(1), expiresAt: new Date(now.getTime() + 6 * DAY) }, // still valid
      ],
    });
    await prisma.notification.createMany({
      data: [
        { userId: user.id, type: "x", title: "old", createdAt: ago(181) },
        { userId: user.id, type: "x", title: "recent", createdAt: ago(179) },
      ],
    });

    const result = await purgeExpiredData(now);
    expect(result).toEqual({
      auditLogsDeleted: 1,
      sessionsDeleted: 2,
      notificationsDeleted: 1,
      accountLinksDeleted: 0,
    });
    expect((await prisma.auditLog.findMany()).map((a) => a.ip)).toEqual(["203.0.113.2"]);
    expect(await prisma.session.count()).toBe(2);
    expect((await prisma.notification.findMany()).map((n) => n.title)).toEqual(["recent"]);
  });

  it("honours ORGTABLE_AUDIT_RETENTION_DAYS and fails with an invalid value", async () => {
    const now = new Date();
    await prisma.auditLog.create({
      data: { action: "auth.login", createdAt: new Date(now.getTime() - 10 * DAY) },
    });
    process.env.ORGTABLE_AUDIT_RETENTION_DAYS = "7";
    try {
      expect((await purgeExpiredData(now)).auditLogsDeleted).toBe(1);
      process.env.ORGTABLE_AUDIT_RETENTION_DAYS = "0";
      await expect(purgeExpiredData(now)).rejects.toThrow(/ORGTABLE_AUDIT_RETENTION_DAYS/);
    } finally {
      delete process.env.ORGTABLE_AUDIT_RETENTION_DAYS;
    }
  });
});

describe("POST /api/cron/maintenance", () => {
  const req = (auth?: string) =>
    new Request("http://localhost/api/cron/maintenance", {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    });

  it("503 without CRON_SECRET, 401 with a wrong secret and 200 with the right one", async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req("Bearer x"))).status).toBe(503);

    process.env.CRON_SECRET = "long-test-secret";
    try {
      expect((await POST(req("Bearer other"))).status).toBe(401);
      const ok = await POST(req("Bearer long-test-secret"));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ auditLogsDeleted: 0 });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});
