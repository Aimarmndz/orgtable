import "server-only";
import { generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";
import { freeBoardSlug } from "@/app/lib/services/workspaces";
import { sanitizeCustomPermissions } from "@/app/lib/permissions";
import { BOARD_COLOR_KEYS } from "@/app/lib/colors";
import { deleteAttachmentFile, saveAttachmentBytes } from "@/app/lib/storage";
import type { OrganizationExport } from "@/app/lib/backups/organization";

// Imports an organization export (organization.json + attachments) INTO an existing
// organization (docs/backups.md, "Import and restore"). Everything gets new ids; boards get
// free addresses. People are matched by email against the organization's CURRENT members:
// nobody is ever created or added by an import. What points at someone who is not a member
// falls back to the person importing (owners of boards, authors of comments, whose name is
// kept in the text) or is dropped (assignees, board and team memberships).
//
// The file is untrusted input: its shape is checked with zod and every length is bounded.

const text = (max: number) => z.string().max(max);
const position = z.string().max(200);
const boardRole = z.enum(["OWNER", "EDITOR", "VIEWER"]);
const date = z.string().max(40).nullable();

const cardSchema = z.object({
  id: text(100),
  title: text(500),
  description: text(20_000).nullable(),
  position,
  dueDate: date,
  createdAt: text(40),
  labels: z.array(text(100)).max(100),
  assignees: z.array(text(254)).max(200),
  checklists: z
    .array(
      z.object({
        title: text(500),
        position,
        items: z.array(z.object({ text: text(1000), done: z.boolean(), position })).max(500),
      }),
    )
    .max(100),
  comments: z
    .array(z.object({ author: text(254).nullable(), authorName: text(200).nullable(), text: text(10_000), createdAt: text(40) }))
    .max(5000),
  attachments: z
    .array(z.object({ filename: text(255), mimeType: text(255), size: z.number().int().nonnegative(), file: text(300).nullable() }))
    .max(500),
});

export const exportSchema = z.object({
  format: z.literal("orgtable-organization"),
  version: z.number().int(),
  exportedAt: text(40),
  workspace: z.object({ name: text(200), slug: text(100), brandColor: text(20).nullable(), timezone: text(64).nullable() }),
  members: z
    .array(z.object({ email: text(254), name: text(200), role: z.enum(["OWNER", "ADMIN", "MEMBER"]), customRole: text(100).nullable() }))
    .max(10_000),
  customRoles: z
    .array(z.object({ name: text(60), color: text(20), description: text(200).nullable(), permissions: z.array(text(40)).max(40) }))
    .max(100),
  teams: z
    .array(
      z.object({
        name: text(60),
        description: text(200).nullable(),
        color: text(20),
        members: z.array(text(254)).max(10_000),
        boards: z.array(z.object({ board: text(100), role: boardRole })).max(1000),
      }),
    )
    .max(200),
  boards: z
    .array(
      z.object({
        id: text(100),
        title: text(200),
        description: text(2000).nullable(),
        background: text(40).nullable(),
        visibility: z.enum(["WORKSPACE", "PRIVATE"]),
        owner: text(254).nullable(),
        createdAt: text(40),
        labels: z.array(z.object({ id: text(100), name: text(100), color: text(40) })).max(200),
        members: z.array(z.object({ email: text(254), role: boardRole })).max(10_000),
        lists: z.array(z.object({ id: text(100), title: text(200), position, cards: z.array(cardSchema).max(20_000) })).max(500),
      }),
    )
    .max(5000),
});

export type ImportSummary = { boards: number; cards: number; attachments: number; roles: number; teams: number };

function validDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const color = (c: string, fallback: string) => ((BOARD_COLOR_KEYS as string[]).includes(c) ? c : fallback);

/**
 * Imports into `workspaceId` as `actorId`. Roles and teams are only created (and, with
 * `assignRoles`, people's custom roles restored) when the actor is an owner or admin: those
 * are things only they may do by hand.
 */
export async function importOrganization(input: {
  workspaceId: string;
  actorId: string;
  data: OrganizationExport;
  files: Map<string, Buffer>;
  asManager: boolean;
  assignRoles?: boolean;
  // Restore: the organization's current boards, teams and custom roles are replaced, in the
  // same transaction as the import, so a failure leaves everything as it was.
  replace?: boolean;
}): Promise<ImportSummary> {
  const parsed = exportSchema.parse(input.data);
  const { workspaceId, actorId } = input;

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    select: { role: true, user: { select: { id: true, email: true } } },
  });
  const byEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m.user.id]));
  const memberId = (email: string | null) => (email ? (byEmail.get(email.toLowerCase()) ?? null) : null);

  // Attachment files first (outside the transaction); removed again if the import fails.
  const written: string[] = [];
  const fileFor = new Map<string, string>();
  try {
    for (const board of parsed.boards)
      for (const list of board.lists)
        for (const card of list.cards)
          for (const a of card.attachments) {
            const bytes = a.file ? input.files.get(a.file) : undefined;
            if (!bytes || fileFor.has(a.file!)) continue;
            const ext = (a.filename.match(/\.[A-Za-z0-9]{1,10}$/)?.[0] ?? "").toLowerCase();
            const storedName = await saveAttachmentBytes(bytes, ext);
            written.push(storedName);
            fileFor.set(a.file!, storedName);
          }

    const summary: ImportSummary = { boards: 0, cards: 0, attachments: 0, roles: 0, teams: 0 };
    // Each stored file backs one attachment (the name is unique); a repeated path is skipped.
    const usedFiles = new Set<string>();
    let oldFiles: string[] = [];
    await prisma.$transaction(
      async (tx) => {
        if (input.replace) {
          oldFiles = (
            await tx.attachment.findMany({
              where: { card: { list: { board: { workspaceId } } } },
              select: { storedName: true },
            })
          ).map((a) => a.storedName);
          await tx.board.deleteMany({ where: { workspaceId } });
          await tx.team.deleteMany({ where: { workspaceId } });
          await tx.workspaceMember.updateMany({ where: { workspaceId }, data: { customRoleId: null } });
          await tx.workspaceCustomRole.deleteMany({ where: { workspaceId } });
        }
        const roleIds = new Map<string, string>();
        if (input.asManager) {
          const existing = await tx.workspaceCustomRole.findMany({ where: { workspaceId }, select: { id: true, name: true } });
          for (const r of existing) roleIds.set(r.name, r.id);
          for (const r of parsed.customRoles) {
            if (roleIds.has(r.name)) continue;
            const created = await tx.workspaceCustomRole.create({
              data: {
                workspaceId,
                name: r.name,
                color: color(r.color, "blue"),
                description: r.description,
                permissions: sanitizeCustomPermissions(r.permissions),
              },
              select: { id: true },
            });
            roleIds.set(r.name, created.id);
            summary.roles += 1;
          }
          if (input.assignRoles) {
            for (const m of parsed.members) {
              const userId = memberId(m.email);
              const current = members.find((x) => x.user.id === userId);
              if (!userId || current?.role !== "MEMBER") continue;
              await tx.workspaceMember.update({
                where: { workspaceId_userId: { workspaceId, userId } },
                data: { customRoleId: m.customRole ? (roleIds.get(m.customRole) ?? null) : null },
              });
            }
          }
        }

        const boardIds = new Map<string, string>();
        for (const b of parsed.boards) {
          const ownerId = memberId(b.owner) ?? actorId;
          const board = await tx.board.create({
            data: {
              workspaceId,
              ownerId,
              title: b.title,
              slug: await freeBoardSlug(tx, workspaceId, b.title),
              description: b.description,
              background: b.background,
              visibility: b.visibility,
              members: { create: { userId: ownerId, role: "OWNER" } },
            },
            select: { id: true },
          });
          boardIds.set(b.id, board.id);
          summary.boards += 1;
          for (const m of b.members) {
            const userId = memberId(m.email);
            if (!userId || userId === ownerId) continue;
            await tx.boardMember.create({ data: { boardId: board.id, userId, role: m.role === "OWNER" ? "EDITOR" : m.role } });
          }
          const labelIds = new Map<string, string>();
          for (const l of b.labels) {
            const label = await tx.label.create({ data: { boardId: board.id, name: l.name, color: l.color }, select: { id: true } });
            labelIds.set(l.id, label.id);
          }
          const listKeys = generateNKeysBetween(null, null, b.lists.length);
          for (const [li, l] of b.lists.entries()) {
            const list = await tx.list.create({ data: { boardId: board.id, title: l.title, position: listKeys[li] }, select: { id: true } });
            const cardKeys = generateNKeysBetween(null, null, l.cards.length);
            for (const [ci, c] of l.cards.entries()) {
              const card = await tx.card.create({
                data: {
                  listId: list.id,
                  title: c.title,
                  description: c.description,
                  position: cardKeys[ci],
                  dueDate: validDate(c.dueDate),
                  createdAt: validDate(c.createdAt) ?? undefined,
                },
                select: { id: true },
              });
              summary.cards += 1;
              const labels = c.labels.flatMap((id) => (labelIds.has(id) ? [labelIds.get(id)!] : []));
              if (labels.length) await tx.cardLabel.createMany({ data: labels.map((labelId) => ({ cardId: card.id, labelId })), skipDuplicates: true });
              const assignees = [...new Set(c.assignees.flatMap((e) => (memberId(e) ? [memberId(e)!] : [])))];
              if (assignees.length) await tx.cardAssignee.createMany({ data: assignees.map((userId) => ({ cardId: card.id, userId })) });
              const checkKeys = generateNKeysBetween(null, null, c.checklists.length);
              for (const [ki, ch] of c.checklists.entries()) {
                const itemKeys = generateNKeysBetween(null, null, ch.items.length);
                await tx.checklist.create({
                  data: {
                    cardId: card.id,
                    title: ch.title,
                    position: checkKeys[ki],
                    items: { create: ch.items.map((it, ii) => ({ text: it.text, done: it.done, position: itemKeys[ii] })) },
                  },
                });
              }
              for (const cm of c.comments) {
                const authorId = memberId(cm.author);
                await tx.comment.create({
                  data: {
                    cardId: card.id,
                    authorId: authorId ?? actorId,
                    text: authorId ? cm.text : `[${cm.authorName ?? cm.author ?? "?"}] ${cm.text}`.slice(0, 10_000),
                    createdAt: validDate(cm.createdAt) ?? undefined,
                  },
                });
              }
              for (const a of c.attachments) {
                const storedName = a.file ? fileFor.get(a.file) : undefined;
                if (!storedName || usedFiles.has(storedName)) continue;
                usedFiles.add(storedName);
                await tx.attachment.create({
                  data: { cardId: card.id, filename: a.filename, storedName, mimeType: a.mimeType, size: a.size },
                });
                summary.attachments += 1;
              }
            }
          }
        }

        if (input.asManager) {
          const existingTeams = new Set((await tx.team.findMany({ where: { workspaceId }, select: { name: true } })).map((t) => t.name));
          for (const t of parsed.teams) {
            if (existingTeams.has(t.name)) continue;
            const team = await tx.team.create({
              data: { workspaceId, name: t.name, description: t.description, color: color(t.color, "teal") },
              select: { id: true },
            });
            summary.teams += 1;
            const people = [...new Set(t.members.flatMap((e) => (memberId(e) ? [memberId(e)!] : [])))];
            if (people.length) await tx.teamMember.createMany({ data: people.map((userId) => ({ teamId: team.id, workspaceId, userId })) });
            const boards = t.boards.flatMap((b) => (boardIds.has(b.board) ? [{ boardId: boardIds.get(b.board)!, role: b.role }] : []));
            if (boards.length) await tx.teamBoard.createMany({ data: boards.map((b) => ({ ...b, teamId: team.id, workspaceId })) });
          }
        }
      },
      { timeout: 10 * 60_000, maxWait: 30_000 },
    );
    // After the commit: the replaced boards' files are no longer referenced.
    await Promise.all(oldFiles.map((f) => deleteAttachmentFile(f)));
    return summary;
  } catch (error) {
    await Promise.all(written.map((f) => deleteAttachmentFile(f)));
    throw error;
  }
}
