import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { generateDueReminders } from "@/app/lib/services/reminders";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
} from "./helpers";

const originalTz = process.env.TZ;

beforeEach(async () => {
  await resetDb();
});
afterEach(() => {
  // Algún test cambia la zona del proceso; Node la aplica en cuanto se asigna TZ.
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});
afterAll(async () => {
  await disconnect();
});

const DAY_MS = 24 * 60 * 60 * 1000;

// La dedup compara el createdAt REAL de la notificación (lo pone la BD al insertar) con el
// día de `now`. Por eso cada test usa un único `now` real (o de su mismo día UTC) y saca de
// él las fechas: si se calculara al importar el módulo, un test que cruzara la medianoche
// UTC mezclaría dos días. No se usan fake timers porque no afectan a ese createdAt.
function isoDay(now: Date, offset: number): string {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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

async function seedOwnerList() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const list = await seedList(board.id);
  return { owner, board, list };
}

describe("recordatorios de vencimiento (integración)", () => {
  it("avisa de tarjetas asignadas que vencen pronto o están vencidas, y nada más", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();

    const soon = await seedCardDue(list.id, "Vence hoy", isoDay(now, 0), owner.id);
    const overdue = await seedCardDue(
      list.id,
      "Vencida",
      isoDay(now, -2),
      owner.id,
    );
    await seedCardDue(list.id, "Futura", isoDay(now, 10), owner.id); // fuera de ventana
    await seedCardDue(list.id, "Sin asignar", isoDay(now, 0)); // sin asignado
    await seedCardDue(list.id, "Sin fecha", null, owner.id); // sin vencimiento

    const result = await generateDueReminders(now);
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
    const now = new Date();
    const { owner, list } = await seedOwnerList();
    await seedCardDue(list.id, "Vence hoy", isoDay(now, 0), owner.id);

    const first = await generateDueReminders(now);
    expect(first.created).toBe(1);

    const second = await generateDueReminders(now);
    expect(second.created).toBe(0);
    expect(
      await prisma.notification.count({ where: { type: "due.reminder" } }),
    ).toBe(1);
  });

  it("cuenta el día en UTC aunque el servidor esté en otra zona", async () => {
    const real = new Date();
    // Las 15:00 UTC de hoy: en Nueva York sigue siendo el mismo día, pero su medianoche
    // local (04:00/05:00 UTC) es posterior a la medianoche UTC en que se guarda dueDate.
    const now = new Date(
      Date.UTC(real.getUTCFullYear(), real.getUTCMonth(), real.getUTCDate(), 15),
    );
    process.env.TZ = "America/New_York";
    const { owner, list } = await seedOwnerList();
    const today = isoDay(now, 0);
    await seedCardDue(list.id, "Vence hoy", today, owner.id);

    const result = await generateDueReminders(now);
    expect(result.created).toBe(1);

    const note = await prisma.notification.findFirstOrThrow({
      where: { type: "due.reminder" },
    });
    expect(note.title).toBe("Vence pronto: «Vence hoy»");
    const expectedDay = new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(today));
    expect(note.body).toBe(`Vencimiento: ${expectedDay}.`);
  });

  it("avisa de una tarea vencida una sola vez, no cada día", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();
    await seedCardDue(list.id, "Vencida", isoDay(now, -2), owner.id);

    expect((await generateDueReminders(now)).created).toBe(1);
    // Al día siguiente sigue vencida, pero ya se avisó tras vencer.
    const tomorrow = new Date(now.getTime() + DAY_MS);
    const next = await generateDueReminders(tomorrow);
    expect(next).toEqual({ created: 0, scanned: 1 });
  });

  it("no repite el aviso de vencida si ya hubo uno después del vencimiento", async () => {
    const now = new Date();
    const { owner, board, list } = await seedOwnerList();
    const card = await seedCardDue(list.id, "Vencida", isoDay(now, -3), owner.id);
    // Aviso enviado ayer, con la tarjeta ya vencida.
    await prisma.notification.create({
      data: {
        userId: owner.id,
        type: "due.reminder",
        title: "Tarea vencida: «Vencida»",
        boardId: board.id,
        cardId: card.id,
        createdAt: new Date(now.getTime() - DAY_MS),
      },
    });

    expect(await generateDueReminders(now)).toEqual({ created: 0, scanned: 1 });
  });

  it("ignora las tarjetas que vencieron hace más de 7 días", async () => {
    const now = new Date();
    const { owner, list } = await seedOwnerList();
    await seedCardDue(list.id, "Olvidada", isoDay(now, -8), owner.id);
    await seedCardDue(list.id, "Reciente", isoDay(now, -7), owner.id);

    expect(await generateDueReminders(now)).toEqual({ created: 1, scanned: 1 });
  });

  it("no avisa a un asignado que ya no es miembro del tablero", async () => {
    const now = new Date();
    const { list } = await seedOwnerList();
    const expelled = await seedUser();
    // Asignación huérfana: como las que dejaba la expulsión antes de borrarlas.
    await seedCardDue(list.id, "Vence hoy", isoDay(now, 0), expelled.id);

    expect(await generateDueReminders(now)).toEqual({ created: 0, scanned: 1 });
    expect(
      await prisma.notification.count({ where: { userId: expelled.id } }),
    ).toBe(0);
  });
});
