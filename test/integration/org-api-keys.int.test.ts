import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { createApiKey, revokeApiKey } from "@/app/lib/services/api-keys";
import { removeMember } from "@/app/lib/services/workspaces";
import { GET as listBoards, POST as createBoardApi } from "@/app/api/v1/boards/route";
import { GET as getBoard, PATCH as renameBoard, DELETE as deleteBoardApi } from "@/app/api/v1/boards/[id]/route";
import { POST as createCardApi } from "@/app/api/v1/lists/[id]/cards/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  seedList,
  apiRequest,
  ctx,
} from "./helpers";

// API keys of an organization (docs/api/public-api.md, "Organization keys"): they reach only
// that organization's boards, at most as editors, and die with their creator's membership.

beforeEach(async () => {
  await resetDb();
  await prisma.instanceConfig.create({ data: { id: "singleton", instanceName: "Test", setupCompletedAt: new Date() } });
});
afterAll(disconnect);

async function seedCompany() {
  const owner = await seedUser({ name: "Owner" });
  const admin = await seedUser({ name: "Admin" });
  const member = await seedUser({ name: "Member" });
  const org = await seedOrganization(owner.id, "acme");
  await addWorkspaceMember(org.id, admin.id, "ADMIN");
  await addWorkspaceMember(org.id, member.id, "MEMBER");
  const board = await seedBoard(admin.id, "Roadmap", { workspaceId: org.id });
  const list = await seedList(board.id);
  const personal = await seedBoard(admin.id, "Diary");
  return { owner, admin, member, org, board, list, personal };
}

async function key(workspaceId: string, actorId: string, scope: "read" | "full" = "full", expiryDays = 0) {
  const r = await createApiKey({ workspaceId, actorId, name: "ERP", scope, expiryDays });
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("organization API keys", () => {
  it("need apikeys.manage", async () => {
    const { member, org } = await seedCompany();
    expect(await createApiKey({ workspaceId: org.id, actorId: member.id, name: "x", scope: "read", expiryDays: 0 })).toEqual({
      ok: false,
      error: "forbidden",
    });
  });

  it("see only the organization's boards, never the creator's personal ones", async () => {
    const { admin, org, board, personal } = await seedCompany();
    const { token } = await key(org.id, admin.id);
    expect(token).toMatch(/^ot_org_/);
    const res = await listBoards(apiRequest("GET", "/api/v1/boards", { token }));
    const ids = (await res.json()).boards.map((b: { id: string }) => b.id);
    expect(ids).toEqual([board.id]);
    expect((await getBoard(apiRequest("GET", `/api/v1/boards/${personal.id}`, { token }), ctx({ id: personal.id }))).status).toBe(404);
    expect((await getBoard(apiRequest("GET", `/api/v1/boards/${board.id}`, { token }), ctx({ id: board.id }))).status).toBe(200);
  });

  it("edit but never delete or rename boards, even when the creator owns them", async () => {
    const { admin, org, board, list } = await seedCompany();
    const { token } = await key(org.id, admin.id);
    const created = await createCardApi(
      apiRequest("POST", `/api/v1/lists/${list.id}/cards`, { token, body: { title: "From the ERP" } }),
      ctx({ id: list.id }),
    );
    expect(created.status).toBe(201);
    expect((await renameBoard(apiRequest("PATCH", `/api/v1/boards/${board.id}`, { token, body: { title: "X" } }), ctx({ id: board.id }))).status).toBe(403);
    expect((await deleteBoardApi(apiRequest("DELETE", `/api/v1/boards/${board.id}`, { token }), ctx({ id: board.id }))).status).toBe(403);
    expect(await prisma.board.count({ where: { id: board.id } })).toBe(1);
  });

  it("create boards in their organization only", async () => {
    const { admin, org } = await seedCompany();
    const { token } = await key(org.id, admin.id);
    const ok = await createBoardApi(apiRequest("POST", "/api/v1/boards", { token, body: { title: "Via key" } }));
    expect(ok.status).toBe(201);
    expect((await prisma.board.findFirstOrThrow({ where: { title: "Via key" } })).workspaceId).toBe(org.id);
    const personalSlug = (await prisma.workspace.findUniqueOrThrow({ where: { personalOwnerId: admin.id } })).slug;
    const other = await createBoardApi(apiRequest("POST", "/api/v1/boards", { token, body: { title: "Mine", workspace: personalSlug } }));
    expect(other.status).toBe(404);
  });

  it("read-only keys cannot write", async () => {
    const { admin, org, list } = await seedCompany();
    const { token } = await key(org.id, admin.id, "read");
    const r = await createCardApi(apiRequest("POST", `/api/v1/lists/${list.id}/cards`, { token, body: { title: "x" } }), ctx({ id: list.id }));
    expect(r.status).toBe(403);
  });

  it("stop working when expired, revoked, or when their creator leaves", async () => {
    const { owner, admin, org } = await seedCompany();
    const a = await key(org.id, admin.id);
    const b = await key(org.id, admin.id);
    await prisma.workspaceApiKey.update({ where: { id: b.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await listBoards(apiRequest("GET", "/api/v1/boards", { token: b.token }))).status).toBe(401);
    const c = await key(org.id, owner.id);
    await revokeApiKey({ workspaceId: org.id, actorId: owner.id, keyId: c.id });
    expect((await listBoards(apiRequest("GET", "/api/v1/boards", { token: c.token }))).status).toBe(401);
    expect((await listBoards(apiRequest("GET", "/api/v1/boards", { token: a.token }))).status).toBe(200);
    await removeMember({ workspaceId: org.id, actorId: owner.id, userId: admin.id });
    expect((await listBoards(apiRequest("GET", "/api/v1/boards", { token: a.token }))).status).toBe(401);
  });

  it("write their use to the activity log, once an hour", async () => {
    const { admin, org } = await seedCompany();
    const { token } = await key(org.id, admin.id);
    await listBoards(apiRequest("GET", "/api/v1/boards", { token }));
    await listBoards(apiRequest("GET", "/api/v1/boards", { token }));
    expect(await prisma.auditLog.count({ where: { action: "workspace.apikey_used", workspaceId: org.id } })).toBe(1);
  });

  it("are never managed across organizations", async () => {
    const { owner, org } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const theirs = await key(globex.id, stranger.id);
    expect(await revokeApiKey({ workspaceId: org.id, actorId: owner.id, keyId: theirs.id })).toEqual({ ok: false, error: "not_found" });
  });
});
