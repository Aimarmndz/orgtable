import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Temporary upload and backup directories (read when the modules are imported).
const dirs = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const uploads = mkdtempSync(join(tmpdir(), "orgtable-bk-uploads-"));
  const backups = mkdtempSync(join(tmpdir(), "orgtable-bk-backups-"));
  process.env.ORGTABLE_UPLOAD_DIR = uploads;
  process.env.ORGTABLE_BACKUP_DIR = backups;
  return { uploads, backups };
});

import { zipSync, strToU8 } from "fflate";
import { prisma } from "@/app/lib/prisma";
import { buildOrganizationZip, readOrganizationZip } from "@/app/lib/backups/organization";
import { insertionPlan } from "@/app/lib/backups/instance";
import {
  backupBytes,
  importIntoOrganization,
  isDue,
  restoreInstance,
  restoreOrganization,
  runBackup,
  runDueBackups,
  testDestination,
  updateDestination,
  updateSchedule,
} from "@/app/lib/services/backups";
import { createCustomRole } from "@/app/lib/services/roles";
import { createTeam, addTeamMember, setTeamBoard } from "@/app/lib/services/teams";
import { changeMemberRole } from "@/app/lib/services/workspaces";
import { GET as downloadBackup } from "@/app/api/workspaces/[slug]/backups/[id]/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  seedList,
  seedCard,
  loginAs,
} from "./helpers";

// Backups, export, import and restore (docs/backups.md).

// A tiny S3 stand-in: PUT/GET/DELETE objects in memory, refusing unsigned requests.
const objects = new Map<string, Buffer>();
let s3: http.Server;
let s3Url = "";

beforeAll(async () => {
  s3 = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!String(req.headers.authorization ?? "").startsWith("AWS4-HMAC-SHA256 Credential=AK/")) {
        res.writeHead(403).end("unsigned");
        return;
      }
      const key = decodeURIComponent(req.url ?? "");
      if (req.method === "PUT") objects.set(key, Buffer.concat(chunks));
      if (req.method === "GET") {
        const body = objects.get(key);
        if (!body) return void res.writeHead(404).end();
        return void res.writeHead(200).end(body);
      }
      if (req.method === "DELETE") objects.delete(key);
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((r) => s3.listen(0, "127.0.0.1", r));
  s3Url = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb();
  objects.clear();
  process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS = "1";
  await prisma.instanceConfig.create({ data: { id: "singleton", instanceName: "Test", setupCompletedAt: new Date() } });
});

afterAll(async () => {
  await new Promise((r) => s3.close(r));
  await rm(dirs.uploads, { recursive: true, force: true });
  await rm(dirs.backups, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  delete process.env.ORGTABLE_BACKUP_DIR;
  delete process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS;
  await disconnect();
});

/** An organization with everything an export carries. */
async function seedRichOrg(slug = "acme") {
  const owner = await seedUser({ name: "Owner", email: `owner-${slug}@test.local` });
  const ana = await seedUser({ name: "Ana", email: `ana-${slug}@test.local` });
  const org = await seedOrganization(owner.id, slug);
  await addWorkspaceMember(org.id, ana.id, "MEMBER");
  const role = await createCustomRole({
    workspaceId: org.id,
    actorId: owner.id,
    role: { name: "Accounting", color: "amber", description: null, permissions: ["audit.view"] },
  });
  if (!role.ok) throw new Error(role.error);
  await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: ana.id, role: "MEMBER", customRoleId: role.id });
  const board = await seedBoard(owner.id, "Roadmap", { workspaceId: org.id, visibility: "PRIVATE" });
  const list = await seedList(board.id, "To do");
  const card = await seedCard(list.id, "Ship it");
  const label = await prisma.label.create({ data: { boardId: board.id, name: "Urgent", color: "rose" } });
  await prisma.cardLabel.create({ data: { cardId: card.id, labelId: label.id } });
  await prisma.cardAssignee.create({ data: { cardId: card.id, userId: ana.id } });
  await prisma.checklist.create({
    data: { cardId: card.id, title: "Steps", position: "a0", items: { create: [{ text: "One", done: true, position: "a0" }] } },
  });
  await prisma.comment.create({ data: { cardId: card.id, authorId: ana.id, text: "On it" } });
  await writeFile(path.join(dirs.uploads, `file-${slug}.txt`), "hello");
  await prisma.attachment.create({
    data: { cardId: card.id, filename: "notes.txt", storedName: `file-${slug}.txt`, mimeType: "text/plain", size: 5 },
  });
  const team = await createTeam({ workspaceId: org.id, actorId: owner.id, team: { name: "Design", description: null, color: "teal" } });
  if (!team.ok) throw new Error(team.error);
  await addTeamMember({ workspaceId: org.id, actorId: owner.id, teamId: team.id, userId: ana.id });
  await setTeamBoard({ workspaceId: org.id, actorId: owner.id, teamId: team.id, boardId: board.id, role: "EDITOR" });
  return { owner, ana, org, board, list, card };
}

describe("export format", () => {
  it("round-trips everything into another organization, matching people by email", async () => {
    const { owner, ana, org } = await seedRichOrg();
    const zip = await buildOrganizationZip(org.id, true);
    const { data, files } = readOrganizationZip(zip);
    expect(data.boards[0].lists[0].cards[0]).toMatchObject({ title: "Ship it", assignees: [ana.email] });
    expect(files.size).toBe(1);

    const target = await seedOrganization(owner.id, "globex");
    await addWorkspaceMember(target.id, ana.id, "MEMBER");
    const r = await importIntoOrganization({ workspaceId: target.id, actorId: owner.id, zip });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary).toMatchObject({ boards: 1, cards: 1, attachments: 1, roles: 1, teams: 1 });
    const card = await prisma.card.findFirstOrThrow({
      where: { list: { board: { workspaceId: target.id } } },
      include: { labels: { include: { label: true } }, assignees: true, checklists: { include: { items: true } }, comments: true, attachments: true },
    });
    expect(card.labels.map((l) => l.label.name)).toEqual(["Urgent"]);
    expect(card.assignees.map((a) => a.userId)).toEqual([ana.id]);
    expect(card.checklists[0].items[0]).toMatchObject({ text: "One", done: true });
    expect(card.comments[0]).toMatchObject({ authorId: ana.id, text: "On it" });
    expect(readFileSync(path.join(dirs.uploads, card.attachments[0].storedName), "utf8")).toBe("hello");
    const team = await prisma.team.findFirstOrThrow({ where: { workspaceId: target.id }, include: { members: true, boards: true } });
    expect(team.members.map((m) => m.userId)).toEqual([ana.id]);
    expect(team.boards).toHaveLength(1);
    // A safety backup of the target was taken first.
    expect(await prisma.backup.count({ where: { workspaceId: target.id, kind: "BEFORE_IMPORT", status: "SUCCESS" } })).toBe(1);
  });

  it("people who are not members never get in: their comments keep the name, assignments drop", async () => {
    const { owner, org } = await seedRichOrg();
    const zip = await buildOrganizationZip(org.id, false);
    const target = await seedOrganization(owner.id, "globex");
    const r = await importIntoOrganization({ workspaceId: target.id, actorId: owner.id, zip });
    if (!r.ok) throw new Error(r.error);
    const card = await prisma.card.findFirstOrThrow({
      where: { list: { board: { workspaceId: target.id } } },
      include: { assignees: true, comments: true, attachments: true },
    });
    expect(card.assignees).toHaveLength(0);
    expect(card.comments[0]).toMatchObject({ authorId: owner.id, text: "[Ana] On it" });
    expect(card.attachments).toHaveLength(0);
    expect(await prisma.workspaceMember.count({ where: { workspaceId: target.id } })).toBe(1);
  });

  it("refuses files that are not an export, and changes nothing", async () => {
    const { owner, org } = await seedRichOrg();
    const before = await prisma.board.count();
    const junk = Buffer.from(zipSync({ "organization.json": strToU8(JSON.stringify({ format: "nope" })) }));
    expect((await importIntoOrganization({ workspaceId: org.id, actorId: owner.id, zip: junk })).ok).toBe(false);
    expect((await importIntoOrganization({ workspaceId: org.id, actorId: owner.id, zip: Buffer.from("not a zip") })).ok).toBe(false);
    expect(await prisma.board.count()).toBe(before);
  });
});

describe("backups of an organization", () => {
  it("are encrypted on disk and come back as the plain zip", async () => {
    const { org } = await seedRichOrg();
    const b = await runBackup({ workspaceId: org.id, kind: "MANUAL", actorId: null });
    expect(b.status).toBe("SUCCESS");
    expect(b.encrypted).toBe(true);
    const raw = readFileSync(path.join(dirs.backups, b.location!));
    expect(raw.subarray(0, 2).toString()).not.toBe("PK");
    const back = await backupBytes(org.id, b.id);
    expect(back!.bytes.subarray(0, 2).toString()).toBe("PK");
  });

  it("restore puts the organization back as it was, after a safety backup", async () => {
    const { owner, org, card } = await seedRichOrg();
    const b = await runBackup({ workspaceId: org.id, kind: "MANUAL", actorId: owner.id });
    await prisma.card.delete({ where: { id: card.id } });
    await seedBoard(owner.id, "Created later", { workspaceId: org.id });
    const r = await restoreOrganization({ workspaceId: org.id, actorId: owner.id, backupId: b.id });
    expect(r.ok).toBe(true);
    const boards = await prisma.board.findMany({ where: { workspaceId: org.id }, select: { title: true } });
    expect(boards.map((x) => x.title)).toEqual(["Roadmap"]);
    expect(await prisma.card.count({ where: { list: { board: { workspaceId: org.id } } } })).toBe(1);
    expect(await prisma.workspaceCustomRole.count({ where: { workspaceId: org.id } })).toBe(1);
    expect(await prisma.backup.count({ where: { workspaceId: org.id, kind: "BEFORE_RESTORE" } })).toBe(1);
    // The custom role of Ana came back too.
    const ana = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: org.id, role: "MEMBER" }, include: { customRole: true } });
    expect(ana.customRole?.name).toBe("Accounting");
  });

  it("are only reachable from their own organization", async () => {
    const { org } = await seedRichOrg("acme");
    const other = await seedRichOrg("globex");
    const b = await runBackup({ workspaceId: org.id, kind: "MANUAL", actorId: null });
    expect(await backupBytes(other.org.id, b.id)).toBeNull();
    expect(await restoreOrganization({ workspaceId: other.org.id, actorId: other.owner.id, backupId: b.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    await loginAs(other.owner.id);
    const res = await downloadBackup(new Request("http://x"), { params: Promise.resolve({ slug: "globex", id: b.id }) });
    expect(res.status).toBe(404);
    await loginAs(other.ana.id);
    const mine = await runBackup({ workspaceId: other.org.id, kind: "MANUAL", actorId: null });
    const denied = await downloadBackup(new Request("http://x"), { params: Promise.resolve({ slug: "globex", id: mine.id }) });
    expect(denied.status).toBe(404);
  });

  it("need backups.manage", async () => {
    const { ana, org } = await seedRichOrg();
    expect(await importIntoOrganization({ workspaceId: org.id, actorId: ana.id, zip: Buffer.from("x") })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("go to S3, signed, and are pruned to the retention", async () => {
    const { org } = await seedRichOrg();
    expect(
      await testDestination(org.id, {
        destination: "S3",
        endpoint: s3Url,
        region: "eu-west-3",
        bucket: "bk",
        prefix: "orgtable",
        accessKey: "AK",
        secretKey: "SK",
        encrypt: true,
      }),
    ).toEqual({ ok: true });
    await updateDestination(org.id, {
      destination: "S3",
      endpoint: s3Url,
      region: "eu-west-3",
      bucket: "bk",
      prefix: "orgtable",
      accessKey: "AK",
      secretKey: "SK",
      encrypt: true,
    });
    await updateSchedule({ workspaceId: org.id, frequency: "DAILY", hour: 3, retention: 2, includeAttachments: true });
    for (let i = 0; i < 3; i++) await runBackup({ workspaceId: org.id, kind: "SCHEDULED", actorId: null });
    const kept = await prisma.backup.findMany({ where: { workspaceId: org.id } });
    expect(kept).toHaveLength(2);
    expect(objects.size).toBe(2);
    expect([...objects.keys()][0]).toMatch(/^\/bk\/orgtable\/org-/);
    const back = await backupBytes(org.id, kept[0].id);
    expect(back!.bytes.subarray(0, 2).toString()).toBe("PK");
    const config = await prisma.backupConfig.findUniqueOrThrow({ where: { workspaceId: org.id } });
    expect(config.s3SecretKeyEnc).not.toContain("SK");
  });

  it("refuse an S3 endpoint inside private networks unless allowed", async () => {
    const { org } = await seedRichOrg();
    delete process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS;
    const r = await testDestination(org.id, {
      destination: "S3",
      endpoint: "https://127.0.0.1:9000",
      region: "",
      bucket: "bk",
      prefix: "",
      accessKey: "AK",
      secretKey: "SK",
      encrypt: false,
    });
    expect(r.ok).toBe(false);
  });
});

describe("scheduling", () => {
  it("is due once at the configured local hour, on the right days", () => {
    const tz = "Europe/Madrid";
    // 2026-10-19 is a Monday; 01:00 UTC is 03:00 in Madrid (CEST).
    const monday3 = new Date("2026-10-19T01:00:00Z");
    expect(isDue({ frequency: "DAILY", hour: 3, lastScheduledAt: null }, monday3, tz)).toBe(true);
    expect(isDue({ frequency: "DAILY", hour: 4, lastScheduledAt: null }, monday3, tz)).toBe(false);
    expect(isDue({ frequency: "DAILY", hour: 3, lastScheduledAt: new Date("2026-10-19T01:05:00Z") }, monday3, tz)).toBe(false);
    expect(isDue({ frequency: "WEEKLY", hour: 3, lastScheduledAt: null }, monday3, tz)).toBe(true);
    expect(isDue({ frequency: "WEEKLY", hour: 3, lastScheduledAt: null }, new Date("2026-10-20T01:00:00Z"), tz)).toBe(false);
    expect(isDue({ frequency: "MONTHLY", hour: 3, lastScheduledAt: null }, monday3, tz)).toBe(false);
    expect(isDue({ frequency: "OFF", hour: 3, lastScheduledAt: null }, monday3, tz)).toBe(false);
  });

  it("the cron runs each due backup once", async () => {
    const { org } = await seedRichOrg();
    await prisma.workspace.update({ where: { id: org.id }, data: { timezone: "UTC" } });
    await updateSchedule({ workspaceId: org.id, frequency: "DAILY", hour: 3, retention: 5, includeAttachments: false });
    const now = new Date("2026-10-19T03:10:00Z");
    expect(await runDueBackups(now)).toEqual({ ran: 1, failed: 0 });
    expect(await runDueBackups(now)).toEqual({ ran: 0, failed: 0 });
  });
});

describe("instance backups", () => {
  it("orders tables by their foreign keys, breaking the nullable cycle", () => {
    const plan = insertionPlan(
      ["User", "Workspace", "Board"],
      [
        { table: "User", ref: "Workspace", columns: ["managedById"], nullable: true },
        { table: "Workspace", ref: "User", columns: ["personalOwnerId"], nullable: true },
        { table: "Board", ref: "Workspace", columns: ["workspaceId"], nullable: false },
        { table: "Board", ref: "User", columns: ["ownerId"], nullable: false },
      ],
    );
    expect(plan.order.indexOf("Board")).toBeGreaterThan(plan.order.indexOf("User"));
    expect(plan.order.indexOf("Board")).toBeGreaterThan(plan.order.indexOf("Workspace"));
    expect([...plan.deferred.values()].flat()).toHaveLength(1);
  });

  it("restores the whole database and the files", async () => {
    const { owner, org, card } = await seedRichOrg();
    // An employee account (User.managedById → Workspace): the cycle in practice.
    await prisma.user.update({ where: { email: "ana-acme@test.local" }, data: { managedById: org.id } });
    const b = await runBackup({ workspaceId: null, kind: "MANUAL", actorId: owner.id });
    expect(b.status).toBe("SUCCESS");
    const before = { users: await prisma.user.count(), cards: await prisma.card.count(), audit: await prisma.auditLog.count() };
    await prisma.card.delete({ where: { id: card.id } });
    await seedUser({ name: "Intruder" });
    await rm(path.join(dirs.uploads, "file-acme.txt"));
    const r = await restoreInstance(owner.id, b.id);
    expect(r.ok).toBe(true);
    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.card.count()).toBe(before.cards);
    expect((await prisma.user.findUniqueOrThrow({ where: { email: "ana-acme@test.local" } })).managedById).toBe(org.id);
    expect(existsSync(path.join(dirs.uploads, "file-acme.txt"))).toBe(true);
    // The safety backup taken before restoring survives the restore.
    expect(await prisma.backup.count({ where: { workspaceId: null, kind: "BEFORE_RESTORE" } })).toBe(1);
  });

  it("refuses a backup from another schema version", async () => {
    const { owner } = await seedRichOrg();
    await updateDestination(null, { destination: "LOCAL", endpoint: "", region: "", bucket: "", prefix: "", accessKey: "", secretKey: "", encrypt: false });
    const b = await runBackup({ workspaceId: null, kind: "MANUAL", actorId: owner.id });
    await prisma.$executeRawUnsafe(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES ('zz', 'x', '99999999999999_future', now(), now(), 1)`);
    try {
      await expect(restoreInstance(owner.id, b.id)).rejects.toThrow(/version/);
    } finally {
      await prisma.$executeRawUnsafe(`DELETE FROM "_prisma_migrations" WHERE id = 'zz'`);
    }
  });
});
