import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { recordAudit } from "@/app/lib/audit";
import { listOrgAudit, readableDetails } from "@/app/lib/services/org-audit";
import { createCustomRole } from "@/app/lib/services/roles";
import { changeMemberRole } from "@/app/lib/services/workspaces";
import { GET as exportAudit } from "@/app/api/workspaces/[slug]/audit/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  loginAs,
} from "./helpers";

// An organization's own activity log (docs/audit.md): events land in the right organization,
// details only resolve names of that organization, and the CSV export follows "audit.view".

beforeEach(resetDb);
afterAll(disconnect);

function exportRequest(slug: string, query = "") {
  return exportAudit(new Request(`http://localhost/api/workspaces/${slug}/audit${query}`), {
    params: Promise.resolve({ slug }),
  });
}

describe("organization activity log", () => {
  it("files workspace and board events under their organization, and no other", async () => {
    const owner = await seedUser({ name: "Owner" });
    const acme = await seedOrganization(owner.id, "acme");
    const globex = await seedOrganization(owner.id, "globex");
    const board = await seedBoard(owner.id, "Roadmap", { workspaceId: acme.id });
    await recordAudit({ action: "workspace.updated", userId: owner.id, targetType: "workspace", targetId: acme.id, ip: null });
    await recordAudit({ action: "board.visibility_changed", userId: owner.id, targetType: "board", targetId: board.id, ip: null });
    await recordAudit({ action: "workspace.updated", userId: owner.id, targetType: "workspace", targetId: globex.id, ip: null });
    const acmeLog = await listOrgAudit(acme.id, {});
    expect(acmeLog.rows.map((r) => r.action).sort()).toEqual(["board.visibility_changed", "workspace.updated"]);
    const people = await listOrgAudit(acme.id, { category: "people" });
    expect(people.rows).toHaveLength(0);
    const boards = await listOrgAudit(acme.id, { category: "boards" });
    expect(boards.rows.map((r) => r.action)).toEqual(["board.visibility_changed"]);
  });

  it("pages with a cursor", async () => {
    const owner = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    for (let i = 0; i < 5; i++) {
      await recordAudit({ action: "workspace.updated", userId: owner.id, targetType: "workspace", targetId: org.id, detail: String(i), ip: null });
    }
    const first = await listOrgAudit(org.id, {}, 3);
    expect(first.rows).toHaveLength(3);
    expect(first.next).toBeTruthy();
    const second = await listOrgAudit(org.id, { after: first.next! }, 3);
    expect(second.rows).toHaveLength(2);
    expect(second.next).toBeNull();
    const all = [...first.rows, ...second.rows].map((r) => r.detail);
    expect(new Set(all).size).toBe(5);
  });

  it("resolves names of its own people and roles only", async () => {
    const owner = await seedUser({ name: "Owner" });
    const ana = await seedUser({ name: "Ana" });
    const stranger = await seedUser({ name: "Stranger" });
    const org = await seedOrganization(owner.id, "acme");
    await addWorkspaceMember(org.id, ana.id, "MEMBER");
    const role = await createCustomRole({
      workspaceId: org.id,
      actorId: owner.id,
      role: { name: "Accounting", color: "blue", description: null, permissions: [] },
    });
    if (!role.ok) throw new Error(role.error);
    await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: ana.id, role: "MEMBER", customRoleId: role.id });
    const detail = `${ana.id} → MEMBER custom:${role.id}`;
    const foreign = `${stranger.id} removed`;
    const map = await readableDetails(org.id, [detail, foreign]);
    expect(map.get(detail)).toBe("Ana → MEMBER «Accounting»");
    expect(map.get(foreign)).toBe(foreign);
  });
});

describe("CSV export", () => {
  it("needs audit.view in that organization: everyone else gets the same 404", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const outsider = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    await addWorkspaceMember(org.id, member.id, "MEMBER");
    for (const who of [member, outsider]) {
      await loginAs(who.id);
      expect((await exportRequest("acme")).status).toBe(404);
    }
    expect((await exportRequest("nope")).status).toBe(404);
  });

  it("exports the rows with spreadsheet formulas neutralised, and logs the export", async () => {
    const owner = await seedUser({ name: "Owner" });
    const org = await seedOrganization(owner.id, "acme");
    await recordAudit({
      action: "workspace.updated",
      userId: owner.id,
      targetType: "workspace",
      targetId: org.id,
      detail: "=HYPERLINK(\"http://evil\")",
      ip: null,
    });
    await loginAs(owner.id);
    const res = await exportRequest("acme");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const body = await res.text();
    expect(body).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(body.split("\r\n")[0]).toContain('"date","person"');
    expect(await prisma.auditLog.count({ where: { workspaceId: org.id, action: "workspace.export" } })).toBe(1);
  });
});
