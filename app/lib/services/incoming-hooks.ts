import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole, workspaceAccessOf } from "@/app/lib/access";
import { canEditBoard } from "@/app/lib/roles";
import { createCardAtEnd } from "@/app/lib/services/cards";
import { apiDueDateSchema, cardTitleSchema, CARD_DESCRIPTION_MAX } from "@/app/lib/validators";
import { revalidateBoard } from "@/app/lib/realtime/notify";
import { cardSnapshot, emitCard } from "@/app/lib/webhooks/emit";

// Incoming webhooks (docs/webhooks.md, "Incoming"): a secret URL that creates cards in one
// list. Other tools (a web form, a monitoring alert, Zapier) POST JSON to it, no account
// needed. Only the SHA-256 of the token is stored; it is shown once.
//
// The cards are created on behalf of whoever made the hook, so they must still be able to
// edit the board: if they lose access, the hook stops working.

export const MAX_INCOMING = 25;

export type IncomingError = "forbidden" | "not_found" | "too_many";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return `inb_${randomBytes(24).toString("base64url")}`;
}

async function mayManage(workspaceId: string, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return false;
  return Boolean((await workspaceAccessOf(workspaceId, actorId))?.permissions.has("integrations.manage"));
}

export async function createIncomingHook(input: {
  workspaceId: string;
  actorId: string;
  name: string;
  listId: string;
}): Promise<{ ok: true; id: string; token: string } | { ok: false; error: IncomingError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if ((await prisma.incomingHook.count({ where: { workspaceId: input.workspaceId } })) >= MAX_INCOMING) {
    return { ok: false, error: "too_many" };
  }
  const list = await prisma.list.findFirst({
    where: { id: input.listId, board: { workspaceId: input.workspaceId } },
    select: { id: true, boardId: true },
  });
  if (!list) return { ok: false, error: "not_found" };
  const role = await effectiveBoardRole(list.boardId, input.actorId);
  if (!role || !canEditBoard(role)) return { ok: false, error: "not_found" };
  const token = newToken();
  const hook = await prisma.incomingHook.create({
    data: {
      workspaceId: input.workspaceId,
      boardId: list.boardId,
      listId: list.id,
      name: input.name,
      tokenHash: hashToken(token),
      prefix: token.slice(0, 8),
      createdById: input.actorId,
    },
    select: { id: true },
  });
  return { ok: true, id: hook.id, token };
}

/** A new URL for a hook (the old one stops working at once). */
export async function regenerateIncomingHook(input: {
  workspaceId: string;
  actorId: string;
  hookId: string;
}): Promise<{ ok: true; token: string } | { ok: false; error: IncomingError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const token = newToken();
  const { count } = await prisma.incomingHook.updateMany({
    where: { id: input.hookId, workspaceId: input.workspaceId },
    data: { tokenHash: hashToken(token), prefix: token.slice(0, 8), createdById: input.actorId },
  });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true, token };
}

export async function deleteIncomingHook(input: {
  workspaceId: string;
  actorId: string;
  hookId: string;
}): Promise<{ ok: true } | { ok: false; error: IncomingError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.incomingHook.deleteMany({ where: { id: input.hookId, workspaceId: input.workspaceId } });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

export async function listIncomingHooks(workspaceId: string) {
  return prisma.incomingHook.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      useCount: true,
      board: { select: { title: true, slug: true } },
      list: { select: { title: true } },
    },
  });
}

// What a POST may carry. Only the title is required.
export const incomingCardSchema = z.object({
  title: cardTitleSchema,
  description: z.string().max(CARD_DESCRIPTION_MAX).nullish(),
  due: apiDueDateSchema.nullish(),
  // Names of the board's labels (case does not matter; unknown ones are ignored).
  labels: z.array(z.string().max(60)).max(20).optional(),
  // Email of someone who can open the board.
  assignee: z.email().max(254).optional(),
});

export type IncomingResult =
  | { ok: true; cardId: string; boardId: string }
  | { ok: false; status: 403 | 404 | 422; error: string };

/** Handles a POST to a hook's URL: creates the card and tells everyone watching. */
export async function receiveIncomingCard(token: string, payload: unknown): Promise<IncomingResult> {
  if (!token.startsWith("inb_") || token.length > 100) return { ok: false, status: 404, error: "Not found." };
  const hook = await prisma.incomingHook.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      name: true,
      boardId: true,
      listId: true,
      createdById: true,
      workspace: { select: { suspendedAt: true } },
    },
  });
  if (!hook || hook.workspace.suspendedAt) return { ok: false, status: 404, error: "Not found." };
  const creatorRole = hook.createdById ? await effectiveBoardRole(hook.boardId, hook.createdById) : null;
  if (!creatorRole || !canEditBoard(creatorRole)) {
    return { ok: false, status: 403, error: "Whoever created this hook can no longer edit the board." };
  }
  const parsed = incomingCardSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, status: 422, error: `Invalid "${issue?.path.join(".") || "body"}".` };
  }
  const data = parsed.data;
  const card = await createCardAtEnd({
    listId: hook.listId,
    title: data.title,
    description: data.description ?? null,
    dueDate: data.due ? new Date(data.due) : null,
  });
  if (data.labels?.length) {
    const wanted = data.labels.map((l) => l.trim().toLowerCase());
    const labels = await prisma.label.findMany({ where: { boardId: hook.boardId }, select: { id: true, name: true } });
    const ids = labels.filter((l) => wanted.includes(l.name.trim().toLowerCase())).map((l) => l.id);
    if (ids.length) {
      await prisma.cardLabel.createMany({ data: ids.map((labelId) => ({ cardId: card.id, labelId })), skipDuplicates: true });
    }
  }
  if (data.assignee) {
    const person = await prisma.user.findUnique({ where: { email: data.assignee.toLowerCase() }, select: { id: true } });
    if (person && (await effectiveBoardRole(hook.boardId, person.id))) {
      await prisma.cardAssignee.create({ data: { cardId: card.id, userId: person.id } }).catch(() => undefined);
    }
  }
  await prisma.incomingHook.update({
    where: { id: hook.id },
    data: { lastUsedAt: new Date(), useCount: { increment: 1 } },
  });
  revalidateBoard(hook.boardId);
  await emitCard("card.created", await cardSnapshot(card.id), null, { source: { incomingHook: hook.name } });
  return { ok: true, cardId: card.id, boardId: hook.boardId };
}
