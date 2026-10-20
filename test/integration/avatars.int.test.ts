import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";

// Temporary upload directory (storage.ts reads it when imported).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-avatar-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import { canSeeAvatar, removeAvatar, setAvatar } from "@/app/lib/services/avatars";
import { deleteUserAccount } from "@/app/lib/services/users";
import { GET as avatarRoute } from "@/app/api/users/[id]/avatar/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  addMember,
  loginAs,
} from "./helpers";

// Profile photos (docs/privacy.md, "Profile photo").

beforeEach(resetDb);
afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

const photoOf = async (id: string) =>
  (await prisma.user.findUniqueOrThrow({ where: { id }, select: { avatarStoredName: true } })).avatarStoredName;
const fetchPhoto = (id: string) =>
  avatarRoute(new Request(`http://localhost/api/users/${id}/avatar`), { params: Promise.resolve({ id }) });

describe("profile photos", () => {
  it("takes PNG/JPEG/WebP by their bytes, refuses SVG and big files, and replaces the old file", async () => {
    const ana = await seedUser();
    expect(await setAvatar(ana.id, SVG)).toEqual({ ok: false, error: "bad_image" });
    expect(await setAvatar(ana.id, Buffer.alloc(600 * 1024))).toEqual({ ok: false, error: "too_big" });
    expect(await photoOf(ana.id)).toBeNull();

    expect(await setAvatar(ana.id, PNG)).toEqual({ ok: true });
    const first = (await photoOf(ana.id))!;
    expect(existsSync(path.join(uploadDir, first))).toBe(true);
    await setAvatar(ana.id, PNG);
    expect(existsSync(path.join(uploadDir, first))).toBe(false);

    const second = (await photoOf(ana.id))!;
    await removeAvatar(ana.id);
    expect(await photoOf(ana.id)).toBeNull();
    expect(existsSync(path.join(uploadDir, second))).toBe(false);
  });

  it("is seen by people who share an organization or a board, and by nobody else", async () => {
    const owner = await seedUser();
    const colleague = await seedUser();
    const guest = await seedUser();
    const stranger = await seedUser();
    const org = await seedOrganization(owner.id);
    await addWorkspaceMember(org.id, colleague.id);
    const board = await seedBoard(owner.id, "Shared", { workspaceId: org.id });
    // A guest: on a board of the organization, not in the organization.
    await addMember(board.id, guest.id, "VIEWER");

    expect(await canSeeAvatar(owner.id, owner.id)).toBe(true);
    expect(await canSeeAvatar(colleague.id, owner.id)).toBe(true);
    expect(await canSeeAvatar(guest.id, colleague.id)).toBe(true);
    expect(await canSeeAvatar(colleague.id, guest.id)).toBe(true);
    expect(await canSeeAvatar(stranger.id, owner.id)).toBe(false);
    expect(await canSeeAvatar(owner.id, stranger.id)).toBe(false);
  });

  it("the route serves it as a non-sniffed image to who may see it; 404 to the rest", async () => {
    const owner = await seedUser();
    const colleague = await seedUser();
    const stranger = await seedUser();
    const org = await seedOrganization(owner.id);
    await addWorkspaceMember(org.id, colleague.id);
    await setAvatar(owner.id, PNG);

    await loginAs(colleague.id);
    const ok = await fetchPhoto(owner.id);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    // Someone without a photo: the same 404 as someone you may not see.
    expect((await fetchPhoto(colleague.id)).status).toBe(404);

    await loginAs(stranger.id);
    expect((await fetchPhoto(owner.id)).status).toBe(404);
  });

  it("deleting the account deletes the photo file", async () => {
    const ana = await seedUser();
    await setAvatar(ana.id, PNG);
    const file = (await photoOf(ana.id))!;
    // Their personal workspace has no boards, so the administrator may delete them.
    expect(await deleteUserAccount(ana.id)).toEqual({ ok: true });
    expect(existsSync(path.join(uploadDir, file))).toBe(false);
  });
});
