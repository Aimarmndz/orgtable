import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import {
  addBoardMember,
  removeBoardMember,
  updateBoardMemberRole,
} from "@/app/lib/actions/members";
import { removeMemberFromBoard } from "@/app/lib/services/members";
import { subscribeBoard, type BoardEvent } from "@/app/lib/realtime/bus";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  addMember,
  loginAs,
} from "./helpers";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

describe("expulsar miembros (integración)", () => {
  it("removeMemberFromBoard borra sus asignaciones en ese tablero y no en otros", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const board = await seedBoard(owner.id);
    const other = await seedBoard(owner.id, "Otro tablero");
    await addMember(board.id, editor.id);
    await addMember(other.id, editor.id);
    const card = await seedCard((await seedList(board.id)).id);
    const otherCard = await seedCard((await seedList(other.id)).id);
    await prisma.cardAssignee.createMany({
      data: [
        { cardId: card.id, userId: editor.id },
        { cardId: otherCard.id, userId: editor.id },
      ],
    });

    expect(await removeMemberFromBoard(board.id, editor.id)).toBe(1);

    expect(
      await prisma.boardMember.count({
        where: { boardId: board.id, userId: editor.id },
      }),
    ).toBe(0);
    const left = await prisma.cardAssignee.findMany({
      where: { userId: editor.id },
      select: { cardId: true },
    });
    expect(left).toEqual([{ cardId: otherCard.id }]);
  });

  it("removeBoardMember notifica y audita una sola vez, aunque se repita", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id);
    await loginAs(owner.id);

    const fd = () => form({ boardId: board.id, userId: editor.id });
    await removeBoardMember(fd());
    await removeBoardMember(fd());

    expect(
      await prisma.notification.count({
        where: { userId: editor.id, type: "member.removed" },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "member.removed" } }),
    ).toBe(1);
  });

  it("removeBoardMember con un usuario que no es miembro no notifica ni audita", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    await removeBoardMember(form({ boardId: board.id, userId: stranger.id }));

    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });
});

describe("cambiar el rol (integración)", () => {
  it("con un usuario que no es miembro no notifica ni audita", async () => {
    const owner = await seedUser();
    const stranger = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    await updateBoardMemberRole(
      form({ boardId: board.id, userId: stranger.id, role: "VIEWER" }),
    );

    expect(await prisma.notification.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it("cambia el rol una vez y no repite el aviso si el rol no cambia", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    await loginAs(owner.id);

    const fd = () =>
      form({ boardId: board.id, userId: editor.id, role: "VIEWER" });
    await updateBoardMemberRole(fd());
    await updateBoardMemberRole(fd());

    const member = await prisma.boardMember.findUniqueOrThrow({
      where: { boardId_userId: { boardId: board.id, userId: editor.id } },
    });
    expect(member.role).toBe("VIEWER");
    expect(
      await prisma.notification.count({
        where: { userId: editor.id, type: "member.role_changed" },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({ where: { action: "member.role_changed" } }),
    ).toBe(1);
  });
});

describe("tiempo real en la gestión de miembros (integración)", () => {
  it("cambiar el rol y expulsar publican board:changed en el bus", async () => {
    const owner = await seedUser();
    const editor = await seedUser();
    const board = await seedBoard(owner.id);
    await addMember(board.id, editor.id, "EDITOR");
    await loginAs(owner.id);

    const events: BoardEvent[] = [];
    const unsubscribe = subscribeBoard(board.id, (e) => events.push(e));
    try {
      await updateBoardMemberRole(
        form({ boardId: board.id, userId: editor.id, role: "VIEWER" }),
      );
      expect(events).toHaveLength(1);
      await removeBoardMember(form({ boardId: board.id, userId: editor.id }));
      expect(events).toHaveLength(2);
    } finally {
      unsubscribe();
    }
    expect(events.every((e) => e.type === "board:changed")).toBe(true);
  });

  it("invitar publica board:changed en el bus", async () => {
    const owner = await seedUser();
    const guest = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const events: BoardEvent[] = [];
    const unsubscribe = subscribeBoard(board.id, (e) => events.push(e));
    try {
      const state = await addBoardMember(
        {},
        form({ boardId: board.id, email: guest.email, role: "EDITOR" }),
      );
      expect(state.error).toBeUndefined();
    } finally {
      unsubscribe();
    }
    expect(events).toHaveLength(1);
  });
});

describe("formulario de invitación (integración)", () => {
  it("con un email que no existe devuelve lo enviado para no vaciar el campo", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const state = await addBoardMember(
      {},
      form({ boardId: board.id, email: "nadie@test.local", role: "VIEWER" }),
    );

    expect(state.error).toBeDefined();
    expect(state.values).toEqual({ email: "nadie@test.local", role: "VIEWER" });
  });

  it("si la invitación sale bien no devuelve valores (el formulario se vacía)", async () => {
    const owner = await seedUser();
    const guest = await seedUser();
    const board = await seedBoard(owner.id);
    await loginAs(owner.id);

    const state = await addBoardMember(
      {},
      form({ boardId: board.id, email: guest.email, role: "EDITOR" }),
    );

    expect(state.message).toBeDefined();
    expect(state.values).toBeUndefined();
  });
});

// Con la sesión real, estas acciones pasan por requireBoardAccess + canManageBoard. Antes
// el DAL estaba sustituido y devolvía el rol que pedía el test, así que una guarda rota no
// se habría notado.
describe("autorización de la gestión de miembros (integración)", () => {
  for (const role of ["EDITOR", "VIEWER"] as const) {
    it(`un ${role} no puede invitar, cambiar roles ni expulsar`, async () => {
      const owner = await seedUser();
      const actor = await seedUser();
      const target = await seedUser();
      const guest = await seedUser();
      const board = await seedBoard(owner.id);
      await addMember(board.id, actor.id, role);
      await addMember(board.id, target.id, "EDITOR");
      await loginAs(actor.id);

      const state = await addBoardMember(
        {},
        form({ boardId: board.id, email: guest.email, role: "EDITOR" }),
      );
      expect(state.error).toBe("Solo el propietario puede gestionar los miembros.");
      await updateBoardMemberRole(
        form({ boardId: board.id, userId: target.id, role: "VIEWER" }),
      );
      await removeBoardMember(form({ boardId: board.id, userId: target.id }));

      const members = await prisma.boardMember.findMany({
        where: { boardId: board.id },
        select: { userId: true, role: true },
      });
      expect(members).toHaveLength(3);
      expect(members).toContainEqual({ userId: target.id, role: "EDITOR" });
      expect(members.some((m) => m.userId === guest.id)).toBe(false);
      expect(await prisma.notification.count()).toBe(0);
      expect(await prisma.auditLog.count()).toBe(0);
    });
  }
});
