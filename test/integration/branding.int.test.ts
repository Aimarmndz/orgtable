import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

// Temporary upload directory (storage.ts reads it when imported).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-brand-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import { removeLogo, setLogo, updateBrand } from "@/app/lib/services/branding";
import { purgeWorkspace } from "@/app/lib/services/workspaces";
import { GET as logoRoute } from "@/app/api/workspaces/[slug]/logo/route";
import { resetDb, disconnect, seedUser, seedOrganization, addWorkspaceMember, loginAs } from "./helpers";

// Brand of an organization (docs/workspaces.md, "Brand").

beforeEach(resetDb);
afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

function fetchLogo(slug: string) {
  return logoRoute(new Request(`http://localhost/api/workspaces/${slug}/logo`), { params: Promise.resolve({ slug }) });
}

describe("brand", () => {
  it("owners and admins set the colour and time zone; members cannot", async () => {
    const owner = await seedUser();
    const member = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    await addWorkspaceMember(org.id, member.id, "MEMBER");
    expect(await updateBrand({ workspaceId: org.id, actorId: member.id, brandColor: "teal", timezone: null })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await updateBrand({ workspaceId: org.id, actorId: owner.id, brandColor: "pink", timezone: null })).toEqual({
      ok: false,
      error: "bad_color",
    });
    expect(await updateBrand({ workspaceId: org.id, actorId: owner.id, brandColor: "teal", timezone: "Mars/Olympus" })).toEqual({
      ok: false,
      error: "bad_timezone",
    });
    expect(await updateBrand({ workspaceId: org.id, actorId: owner.id, brandColor: "teal", timezone: "Europe/Madrid" })).toEqual({ ok: true });
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: org.id } });
    expect(w).toMatchObject({ brandColor: "teal", timezone: "Europe/Madrid" });
  });

  it("takes PNG/JPEG/WebP logos by their bytes and refuses SVG", async () => {
    const owner = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    expect(await setLogo({ workspaceId: org.id, actorId: owner.id, bytes: SVG })).toEqual({ ok: false, error: "bad_image" });
    expect(await setLogo({ workspaceId: org.id, actorId: owner.id, bytes: Buffer.alloc(600 * 1024) })).toEqual({
      ok: false,
      error: "too_big",
    });
    expect(await setLogo({ workspaceId: org.id, actorId: owner.id, bytes: PNG })).toEqual({ ok: true });
    const first = (await prisma.workspace.findUniqueOrThrow({ where: { id: org.id } })).logoStoredName!;
    expect(existsSync(path.join(uploadDir, first))).toBe(true);
    // Replacing deletes the old file; removing deletes the new one.
    await setLogo({ workspaceId: org.id, actorId: owner.id, bytes: PNG });
    const second = (await prisma.workspace.findUniqueOrThrow({ where: { id: org.id } })).logoStoredName!;
    expect(existsSync(path.join(uploadDir, first))).toBe(false);
    await removeLogo({ workspaceId: org.id, actorId: owner.id });
    expect(existsSync(path.join(uploadDir, second))).toBe(false);
  });

  it("serves the logo to its members only, as an image that is not sniffed", async () => {
    const owner = await seedUser();
    const outsider = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    await setLogo({ workspaceId: org.id, actorId: owner.id, bytes: PNG });
    await loginAs(owner.id);
    const ok = await fetchLogo("acme");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    await loginAs(outsider.id);
    expect((await fetchLogo("acme")).status).toBe(404);
  });

  it("deleting the organization deletes its logo file", async () => {
    const owner = await seedUser();
    const org = await seedOrganization(owner.id, "acme");
    await setLogo({ workspaceId: org.id, actorId: owner.id, bytes: PNG });
    const file = (await prisma.workspace.findUniqueOrThrow({ where: { id: org.id } })).logoStoredName!;
    await purgeWorkspace(org.id);
    expect(existsSync(path.join(uploadDir, file))).toBe(false);
  });
});
