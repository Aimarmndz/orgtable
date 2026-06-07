import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { generateDueReminders } from "@/app/lib/services/reminders";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

// La dedup diaria compara el createdAt REAL de la notificación con el inicio del día de
// `now`. Para que casen, los tests usan el ahora real y fechas relativas a él (TZ=UTC fijo
// en la config de integración hace esto determinista).
const realNow = new Date();
const base = new Date(realNow);
base.setUTCHours(0, 0, 0, 0);
function isoDay(offset: number): string {
  const d = new Date(base);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

async function seedCardDue(
  listId: string,
  title: string,
  dueDate: string | null,
  assigneeId?: string,
) {
  const card = await prisma.card.create({
    data: {
      listId,
      title,
      position: "a0",
      dueDate: dueDate ? new Date(dueDate) : null,
    },
    select: { id: true },
  });
  if (assigneeId) {
    await prisma.cardAssignee.create({
      data: { cardId: card.id, userId: assigneeId },
    });
  }
  return card;
}

describe("recordatorios de vencimiento (integración)", () => {
  it("avisa de tarjetas asignadas que vencen pronto o están vencidas, y nada más", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);

    const soon = await seedCardDue(list.id, "Vence hoy", isoDay(0), owner.id);
    const overdue = await seedCardDue(
      list.id,
      "Vencida",
      isoDay(-2),
      owner.id,
    );
    await seedCardDue(list.id, "Futura", isoDay(10), owner.id); // fuera de ventana
    await seedCardDue(list.id, "Sin asignar", isoDay(0)); // sin asignado
    await seedCardDue(list.id, "Sin fecha", null, owner.id); // sin vencimiento

    const result = await generateDueReminders(new Date());
    expect(result.created).toBe(2);

    const notes = await prisma.notification.findMany({
      where: { userId: owner.id, type: "due.reminder" },
    });
    expect(notes).toHaveLength(2);
    expect(notes.map((n) => n.cardId).sort()).toEqual(
      [soon.id, overdue.id].sort(),
    );
    expect(notes.some((n) => n.title.startsWith("Tarea vencida"))).toBe(true);
    expect(notes.some((n) => n.title.startsWith("Vence pronto"))).toBe(true);
  });

  it("es idempotente el mismo día (no duplica el aviso)", async () => {
    const owner = await seedUser();
    const board = await seedBoard(owner.id);
    const list = await seedList(board.id);
    await seedCardDue(list.id, "Vence hoy", isoDay(0), owner.id);

    const first = await generateDueReminders(new Date());
    expect(first.created).toBe(1);

    const second = await generateDueReminders(new Date());
    expect(second.created).toBe(0);
    expect(
      await prisma.notification.count({ where: { type: "due.reminder" } }),
    ).toBe(1);
  });
});
