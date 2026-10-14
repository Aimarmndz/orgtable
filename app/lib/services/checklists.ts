import "server-only";
import { prisma } from "@/app/lib/prisma";
import { positionAtEnd } from "@/app/lib/ordering";

// Appends checklists and items with the parent row locked (`FOR UPDATE`), so two
// concurrent creates do not store the same position. Same reasoning as createCardAtEnd
// (app/lib/services/cards.ts).

/** Creates a checklist at the end of the card. */
export async function createChecklistAtEnd(data: {
  cardId: string;
  title: string;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Card" WHERE id = ${data.cardId} FOR UPDATE`;
    const last = await tx.checklist.findFirst({
      where: { cardId: data.cardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return tx.checklist.create({
      data: {
        cardId: data.cardId,
        title: data.title,
        position: positionAtEnd(last?.position ?? null),
      },
      select: { id: true },
    });
  });
}

/** Creates an item at the end of the checklist. */
export async function createChecklistItemAtEnd(data: {
  checklistId: string;
  text: string;
}): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Checklist" WHERE id = ${data.checklistId} FOR UPDATE`;
    const last = await tx.checklistItem.findFirst({
      where: { checklistId: data.checklistId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    return tx.checklistItem.create({
      data: {
        checklistId: data.checklistId,
        text: data.text,
        position: positionAtEnd(last?.position ?? null),
      },
      select: { id: true },
    });
  });
}
