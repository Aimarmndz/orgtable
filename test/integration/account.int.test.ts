import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { access, rm } from "node:fs/promises";
import path from "node:path";

// Directorio de subida temporal: storage.ts lo fija al importarse (ver
// attachments-delete.int.test.ts).
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "orgtable-account-"));
  process.env.ORGTABLE_UPLOAD_DIR = dir;
  return dir;
});

import { prisma } from "@/app/lib/prisma";
import { saveAttachmentFile } from "@/app/lib/storage";
import { verifyPassword } from "@/app/lib/auth";
import { verifySession } from "@/app/lib/dal";
import {
  changePassword,
  deleteAccount,
  revokeOtherSessions,
  revokeSession,
  updateProfile,
} from "@/app/lib/actions/account";
import { exportUserData } from "@/app/lib/services/account";
import { GET as exportRoute } from "@/app/api/account/export/route";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  seedApiToken,
  addMember,
  loginAs,
} from "./helpers";

const PASSWORD = "contraseña-segura";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await rm(uploadDir, { recursive: true, force: true });
  delete process.env.ORGTABLE_UPLOAD_DIR;
  await disconnect();
});

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

async function redirectOf(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest?.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("La acción no redirigió");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Abre otra sesión del mismo usuario (otro navegador) sin tocar la cookie actual. */
async function openOtherSession(userId: string): Promise<string> {
  const s = await prisma.session.create({
    data: { userId, expiresAt: new Date(Date.now() + 86_400_000), userAgent: "otro" },
  });
  return s.id;
}

describe("perfil (updateProfile)", () => {
  it("cambia el nombre sin pedir la contraseña", async () => {
    const user = await seedUser({ email: "yo@test.local" });
    await loginAs(user.id);
    const state = await updateProfile(
      {},
      form({ name: "Nombre Nuevo", email: "yo@test.local", currentPassword: "" }),
    );
    expect(state.message).toBe("Perfil guardado.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).name).toBe(
      "Nombre Nuevo",
    );
  });

  it("cambiar el email exige la contraseña actual", async () => {
    const user = await seedUser({ email: "yo@test.local" });
    await loginAs(user.id);
    const state = await updateProfile(
      {},
      form({ name: "Yo", email: "otro@test.local", currentPassword: "mala" }),
    );
    expect(state.field).toBe("currentPassword");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
      "yo@test.local",
    );

    const ok = await updateProfile(
      {},
      form({ name: "Yo", email: "Otro@Test.local", currentPassword: PASSWORD }),
    );
    expect(ok.message).toBe("Perfil guardado.");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(
      "otro@test.local",
    );
  });

  it("no deja quedarse con el email de otra cuenta", async () => {
    await seedUser({ email: "ocupado@test.local" });
    const user = await seedUser({ email: "yo@test.local" });
    await loginAs(user.id);
    const state = await updateProfile(
      {},
      form({ name: "Yo", email: "ocupado@test.local", currentPassword: PASSWORD }),
    );
    expect(state.field).toBe("email");
  });
});

describe("contraseña y sesiones", () => {
  it("cambia la contraseña, cierra las otras sesiones y conserva la actual", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const current = (await verifySession())!.sessionId;
    const other = await openOtherSession(user.id);

    const state = await changePassword(
      {},
      form({
        currentPassword: PASSWORD,
        newPassword: "otra-contraseña-larga",
        confirmPassword: "otra-contraseña-larga",
      }),
    );
    expect(state.message).toBe("Contraseña cambiada. Se cerraron 1 sesiones más.");

    const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword("otra-contraseña-larga", u.passwordHash)).toBe(true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: other } })).revokedAt).not.toBeNull();
    expect((await prisma.session.findUniqueOrThrow({ where: { id: current } })).revokedAt).toBeNull();
  });

  it("rechaza una contraseña actual incorrecta y una confirmación distinta", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    const wrong = await changePassword(
      {},
      form({ currentPassword: "mala", newPassword: "nueva-larga", confirmPassword: "nueva-larga" }),
    );
    expect(wrong.field).toBe("currentPassword");
    const mismatch = await changePassword(
      {},
      form({ currentPassword: PASSWORD, newPassword: "nueva-larga", confirmPassword: "otra-cosa" }),
    );
    expect(mismatch.field).toBe("confirmPassword");
  });

  it("cierra una sesión propia pero no una ajena", async () => {
    const user = await seedUser();
    const stranger = await seedUser();
    const mine = await openOtherSession(user.id);
    const theirs = await openOtherSession(stranger.id);
    await loginAs(user.id);

    expect(await redirectOf(revokeSession(form({ sessionId: theirs })))).toBe(
      "/settings#seguridad",
    );
    expect((await prisma.session.findUniqueOrThrow({ where: { id: theirs } })).revokedAt).toBeNull();

    await redirectOf(revokeSession(form({ sessionId: mine })));
    expect((await prisma.session.findUniqueOrThrow({ where: { id: mine } })).revokedAt).not.toBeNull();
  });

  it("«cerrar las otras» deja abierta solo la actual", async () => {
    const user = await seedUser();
    await loginAs(user.id);
    await openOtherSession(user.id);
    await openOtherSession(user.id);
    await redirectOf(revokeOtherSessions());
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
    expect(await verifySession()).not.toBeNull();
  });
});

describe("exportar mis datos", () => {
  it("incluye lo propio y lo escrito en tableros ajenos, sin hashes", async () => {
    const owner = await seedUser({ email: "dueña@test.local" });
    const me = await seedUser({ email: "yo@test.local", name: "Yo" });
    const myBoard = await seedBoard(me.id, "Mi tablero");
    const myList = await seedList(myBoard.id);
    await seedCard(myList.id, "Mi tarjeta");
    const theirBoard = await seedBoard(owner.id, "Tablero ajeno");
    await addMember(theirBoard.id, me.id, "EDITOR");
    const theirCard = await seedCard((await seedList(theirBoard.id)).id, "Tarjeta ajena");
    await prisma.comment.create({
      data: { cardId: theirCard.id, authorId: me.id, text: "Mi comentario" },
    });
    await seedApiToken(me.id, { name: "script" });

    const data = await exportUserData(me.id);
    expect(data?.account).toMatchObject({ email: "yo@test.local", name: "Yo" });
    expect(data?.ownedBoards.map((b) => b.title)).toEqual(["Mi tablero"]);
    expect(data?.ownedBoards[0].lists[0].cards[0].title).toBe("Mi tarjeta");
    expect(data?.memberships.map((m) => m.boardTitle).sort()).toEqual([
      "Mi tablero",
      "Tablero ajeno",
    ]);
    expect(data?.comments).toEqual([
      expect.objectContaining({ text: "Mi comentario", cardTitle: "Tarjeta ajena" }),
    ]);
    expect(data?.apiTokens).toEqual([expect.objectContaining({ name: "script" })]);

    const json = JSON.stringify(data);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("tokenHash");
    // Nada del tablero ajeno que no haya escrito ella.
    expect(json).not.toContain("dueña@test.local");
  });

  it("la ruta exige sesión, descarga el JSON y lo audita", async () => {
    const user = await seedUser();
    expect((await exportRoute()).status).toBe(401);

    await loginAs(user.id);
    const res = await exportRoute();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="orgtable-mis-datos-/);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).account.id).toBe(user.id);
    expect(await prisma.auditLog.count({ where: { action: "account.exported" } })).toBe(1);
  });
});

describe("borrar mi cuenta (deleteAccount)", () => {
  it("borra cuenta, tableros propios con sus ficheros y comentarios; los ajenos siguen", async () => {
    const other = await seedUser();
    const me = await seedUser({ email: "yo@test.local" });
    const myBoard = await seedBoard(me.id);
    const myCard = await seedCard((await seedList(myBoard.id)).id);
    const { storedName, size } = await saveAttachmentFile(
      new File(["contenido"], "nota.txt", { type: "text/plain" }),
    );
    await prisma.attachment.create({
      data: { cardId: myCard.id, filename: "nota.txt", storedName, mimeType: "text/plain", size },
    });
    const filePath = path.join(uploadDir, storedName);

    const theirBoard = await seedBoard(other.id);
    await addMember(theirBoard.id, me.id);
    const theirCard = await seedCard((await seedList(theirBoard.id)).id);
    await prisma.comment.create({ data: { cardId: theirCard.id, authorId: me.id, text: "hola" } });
    // Fila de auditoría sobre esta cuenta con su email en `detail` (como user.created).
    await prisma.auditLog.create({
      data: { action: "user.created", targetType: "user", targetId: me.id, detail: "yo@test.local (MEMBER)" },
    });

    await loginAs(me.id);
    expect(await redirectOf(deleteAccount({}, form({ password: PASSWORD })))).toBe(
      "/login?cuenta=borrada",
    );

    expect(await prisma.user.findUnique({ where: { id: me.id } })).toBeNull();
    expect(await prisma.board.findUnique({ where: { id: myBoard.id } })).toBeNull();
    expect(await fileExists(filePath)).toBe(false);
    expect(await prisma.board.findUnique({ where: { id: theirBoard.id } })).not.toBeNull();
    expect(await prisma.comment.count()).toBe(0);
    expect(await prisma.session.count({ where: { userId: me.id } })).toBe(0);
    const auditDetails = (await prisma.auditLog.findMany()).map((a) => a.detail ?? "");
    expect(auditDetails.join(" ")).not.toContain("yo@test.local");
    expect(await prisma.auditLog.count({ where: { action: "account.deleted", userId: null } })).toBe(1);
  });

  it("con una contraseña incorrecta no borra nada", async () => {
    const me = await seedUser();
    await seedBoard(me.id);
    await loginAs(me.id);
    const state = await deleteAccount({}, form({ password: "mala" }));
    expect(state.field).toBe("password");
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.board.count()).toBe(1);
  });

  it("la única cuenta ADMIN no puede borrarse; con otro admin, sí", async () => {
    const admin = await seedUser({ role: "ADMIN" });
    await loginAs(admin.id);
    const state = await deleteAccount({}, form({ password: PASSWORD }));
    expect(state.error).toMatch(/única persona administradora/);
    expect(await prisma.user.count()).toBe(1);

    await seedUser({ role: "ADMIN" });
    expect(await redirectOf(deleteAccount({}, form({ password: PASSWORD })))).toBe(
      "/login?cuenta=borrada",
    );
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("dos admins que se borran a la vez no dejan la instancia sin admin", async () => {
    const a = await seedUser({ role: "ADMIN" });
    const b = await seedUser({ role: "ADMIN" });
    const { deleteOwnAccount } = await import("@/app/lib/services/account");
    const results = await Promise.all([
      deleteOwnAccount(a.id, PASSWORD),
      deleteOwnAccount(b.id, PASSWORD),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.error === "last_admin")).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: "ADMIN" } })).toBe(1);
  });

  it("tras borrarla, la cookie se quita y la sesión ya no existe", async () => {
    const me = await seedUser();
    await loginAs(me.id);
    await redirectOf(deleteAccount({}, form({ password: PASSWORD })));
    expect(await verifySession()).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });
});
