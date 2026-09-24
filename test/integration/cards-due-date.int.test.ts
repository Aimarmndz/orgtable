import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/app/lib/prisma";
import { setCardDueDate, updateCard } from "@/app/lib/actions/cards";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedList,
  seedCard,
  loginAs,
} from "./helpers";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

const DUE = new Date("2026-07-01T00:00:00.000Z");

/** Tarjeta con vencimiento y descripción, y el propietario ya con sesión. */
async function seedCardWithDue() {
  const owner = await seedUser();
  const board = await seedBoard(owner.id);
  const card = await seedCard((await seedList(board.id)).id);
  await prisma.card.update({
    where: { id: card.id },
    data: { dueDate: DUE, description: "Original" },
  });
  await loginAs(owner.id);
  return card;
}

async function readCard(id: string) {
  return prisma.card.findUniqueOrThrow({
    where: { id },
    select: { dueDate: true, description: true },
  });
}

function detailsForm(cardId: string, description: string, dueDate: string): FormData {
  const fd = new FormData();
  fd.set("cardId", cardId);
  fd.set("description", description);
  fd.set("dueDate", dueDate);
  return fd;
}

// Regresión: una fecha no parseable se convertía en null y BORRABA el vencimiento (y
// setCardDueDate respondía ok:true).
describe("setCardDueDate valida la fecha", () => {
  it.each(["24/09/2026", "2026-02-31", "mañana"])(
    "%s da ok:false y conserva la fecha",
    async (bad) => {
      const card = await seedCardWithDue();
      expect(await setCardDueDate({ cardId: card.id, dueDate: bad })).toEqual({
        ok: false,
      });
      expect((await readCard(card.id)).dueDate).toEqual(DUE);
    },
  );

  it("una fecha válida se guarda a medianoche UTC", async () => {
    const card = await seedCardWithDue();
    expect(await setCardDueDate({ cardId: card.id, dueDate: "2026-09-24" })).toEqual({
      ok: true,
    });
    expect((await readCard(card.id)).dueDate).toEqual(
      new Date("2026-09-24T00:00:00.000Z"),
    );
  });

  it("null quita la fecha", async () => {
    const card = await seedCardWithDue();
    expect(await setCardDueDate({ cardId: card.id, dueDate: null })).toEqual({ ok: true });
    expect((await readCard(card.id)).dueDate).toBeNull();
  });
});

describe("updateCard valida fecha y descripción", () => {
  it.each(["24/09/2026", "2026-02-31"])(
    "con fecha %s no guarda nada y devuelve el error con lo enviado",
    async (bad) => {
      const card = await seedCardWithDue();
      expect(await updateCard({}, detailsForm(card.id, "Cambiada", bad))).toEqual({
        error: "La fecha de vencimiento no es válida.",
        description: "Cambiada",
        dueDate: bad,
      });
      expect(await readCard(card.id)).toEqual({ dueDate: DUE, description: "Original" });
    },
  );

  it("una fecha vacía quita el vencimiento", async () => {
    const card = await seedCardWithDue();
    expect(await updateCard({}, detailsForm(card.id, "Original", ""))).toEqual({});
    expect((await readCard(card.id)).dueDate).toBeNull();
  });

  // Regresión: con más de 5000 caracteres la acción volvía sin guardar ni avisar, y el
  // reseteo del formulario borraba lo escrito.
  it("una descripción de 5001 caracteres no se guarda y devuelve el error", async () => {
    const card = await seedCardWithDue();
    const long = "x".repeat(5001);
    expect(await updateCard({}, detailsForm(card.id, long, "2026-07-01"))).toEqual({
      error: "La descripción no puede superar 5000 caracteres (tiene 5001).",
      description: long,
      dueDate: "2026-07-01",
    });
    expect((await readCard(card.id)).description).toBe("Original");

    expect(
      await updateCard({}, detailsForm(card.id, "y".repeat(5000), "2026-07-01")),
    ).toEqual({});
    expect((await readCard(card.id)).description).toBe("y".repeat(5000));
  });

  // El navegador envía los saltos de línea como \r\n pero maxLength los cuenta como uno:
  // 2500 líneas de "a\n" miden 5000 en la UI y llegan con 7500 caracteres.
  it("cuenta los saltos de línea \\r\\n como un carácter", async () => {
    const card = await seedCardWithDue();
    const sent = "a\r\n".repeat(2500);
    expect(await updateCard({}, detailsForm(card.id, sent, "2026-07-01"))).toEqual({});
    // El trim de la validación quita el último salto de línea.
    expect((await readCard(card.id)).description).toBe("a\n".repeat(2500).trimEnd());
  });

  // Regresión: una descripción anterior al límite (más de 5000) hacía fallar la
  // validación al reenviarla sin cambios y no se podía cambiar el vencimiento.
  it("con una descripción heredada larga y sin cambios guarda la fecha", async () => {
    const card = await seedCardWithDue();
    const legacy = "z\r\n".repeat(3000);
    await prisma.card.update({ where: { id: card.id }, data: { description: legacy } });

    expect(await updateCard({}, detailsForm(card.id, legacy, "2026-09-24"))).toEqual({});
    expect(await readCard(card.id)).toEqual({
      dueDate: new Date("2026-09-24T00:00:00.000Z"),
      description: legacy,
    });

    const edited = legacy + "más";
    const result = await updateCard({}, detailsForm(card.id, edited, "2026-09-25"));
    expect(result.error).toMatch(/no puede superar 5000 caracteres/);
    expect(await readCard(card.id)).toEqual({
      dueDate: new Date("2026-09-24T00:00:00.000Z"),
      description: legacy,
    });
  });
});
