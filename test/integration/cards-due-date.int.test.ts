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
  en,
} from "./helpers";
import { fmt } from "@/app/i18n/format";

beforeEach(async () => {
  await resetDb();
});
afterAll(async () => {
  await disconnect();
});

const DUE = new Date("2026-07-01T00:00:00.000Z");

/** Card with a due date and a description, and its owner already signed in. */
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

// Regression: an unparseable date turned into null and CLEARED the due date (and
// setCardDueDate answered ok:true).
describe("setCardDueDate validates the date", () => {
  it.each(["24/09/2026", "2026-02-31", "tomorrow"])(
    "%s gives ok:false and keeps the date",
    async (bad) => {
      const card = await seedCardWithDue();
      expect(await setCardDueDate({ cardId: card.id, dueDate: bad })).toEqual({
        ok: false,
      });
      expect((await readCard(card.id)).dueDate).toEqual(DUE);
    },
  );

  it("a valid date is stored at midnight UTC", async () => {
    const card = await seedCardWithDue();
    expect(await setCardDueDate({ cardId: card.id, dueDate: "2026-09-24" })).toEqual({
      ok: true,
    });
    expect((await readCard(card.id)).dueDate).toEqual(
      new Date("2026-09-24T00:00:00.000Z"),
    );
  });

  it("null clears the date", async () => {
    const card = await seedCardWithDue();
    expect(await setCardDueDate({ cardId: card.id, dueDate: null })).toEqual({ ok: true });
    expect((await readCard(card.id)).dueDate).toBeNull();
  });
});

describe("updateCard validates the date and the description", () => {
  it.each(["24/09/2026", "2026-02-31"])(
    "with date %s saves nothing and returns the error with what was sent",
    async (bad) => {
      const card = await seedCardWithDue();
      expect(await updateCard({}, detailsForm(card.id, "Changed", bad))).toEqual({
        error: en.errors.cards.invalidDueDate,
        description: "Changed",
        dueDate: bad,
      });
      expect(await readCard(card.id)).toEqual({ dueDate: DUE, description: "Original" });
    },
  );

  it("an empty date clears the due date", async () => {
    const card = await seedCardWithDue();
    expect(await updateCard({}, detailsForm(card.id, "Original", ""))).toEqual({});
    expect((await readCard(card.id)).dueDate).toBeNull();
  });

  // Regression: with more than 5000 characters the action returned without saving or
  // warning, and the form reset wiped what had been typed.
  it("a 5001-character description is not saved and returns the error", async () => {
    const card = await seedCardWithDue();
    const long = "x".repeat(5001);
    expect(await updateCard({}, detailsForm(card.id, long, "2026-07-01"))).toEqual({
      error: fmt(en.errors.cards.descriptionTooLong, { max: 5000, length: 5001 }),
      description: long,
      dueDate: "2026-07-01",
    });
    expect((await readCard(card.id)).description).toBe("Original");

    expect(
      await updateCard({}, detailsForm(card.id, "y".repeat(5000), "2026-07-01")),
    ).toEqual({});
    expect((await readCard(card.id)).description).toBe("y".repeat(5000));
  });

  // The browser sends line breaks as \r\n but maxLength counts them as one: 2500 lines
  // of "a\n" measure 5000 in the UI and arrive with 7500 characters.
  it("counts \\r\\n line breaks as one character", async () => {
    const card = await seedCardWithDue();
    const sent = "a\r\n".repeat(2500);
    expect(await updateCard({}, detailsForm(card.id, sent, "2026-07-01"))).toEqual({});
    // The validation's trim removes the last line break.
    expect((await readCard(card.id)).description).toBe("a\n".repeat(2500).trimEnd());
  });

  // Regression: a description from before the limit (over 5000) failed validation when
  // sent back unchanged, so the due date could not be changed.
  it("with a long legacy description sent unchanged, it saves the date", async () => {
    const card = await seedCardWithDue();
    const legacy = "z\r\n".repeat(3000);
    await prisma.card.update({ where: { id: card.id }, data: { description: legacy } });

    expect(await updateCard({}, detailsForm(card.id, legacy, "2026-09-24"))).toEqual({});
    expect(await readCard(card.id)).toEqual({
      dueDate: new Date("2026-09-24T00:00:00.000Z"),
      description: legacy,
    });

    const edited = legacy + "more";
    const result = await updateCard({}, detailsForm(card.id, edited, "2026-09-25"));
    expect(result.error).toBe(
      fmt(en.errors.cards.descriptionTooLong, { max: 5000, length: 6004 }),
    );
    expect(await readCard(card.id)).toEqual({
      dueDate: new Date("2026-09-24T00:00:00.000Z"),
      description: legacy,
    });
  });
});
