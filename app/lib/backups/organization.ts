import "server-only";
import { strToU8, strFromU8, unzipSync, zipSync, type Zippable } from "fflate";
import { prisma } from "@/app/lib/prisma";
import { readAttachmentFile } from "@/app/lib/storage";

// The export of an organization (docs/backups.md, "Format"): a .zip with a readable
// organization.json and, optionally, the attachment files under attachments/. People are
// referred to by email (accounts are not part of an organization's data and are never
// created by an import); ids inside the file are local to it and replaced on import.
// Webhooks, API keys and incoming webhooks are not exported: they hold secrets.

export const FORMAT = "orgtable-organization";
export const FORMAT_VERSION = 1;

export type ExportedCard = {
  id: string;
  title: string;
  description: string | null;
  position: string;
  dueDate: string | null;
  createdAt: string;
  labels: string[];
  assignees: string[];
  checklists: { title: string; position: string; items: { text: string; done: boolean; position: string }[] }[];
  comments: { author: string | null; authorName: string | null; text: string; createdAt: string }[];
  attachments: { filename: string; mimeType: string; size: number; file: string | null }[];
};

export type OrganizationExport = {
  format: typeof FORMAT;
  version: number;
  exportedAt: string;
  workspace: { name: string; slug: string; brandColor: string | null; timezone: string | null };
  members: { email: string; name: string; role: "OWNER" | "ADMIN" | "MEMBER"; customRole: string | null }[];
  customRoles: { name: string; color: string; description: string | null; permissions: string[] }[];
  teams: {
    name: string;
    description: string | null;
    color: string;
    members: string[];
    boards: { board: string; role: "OWNER" | "EDITOR" | "VIEWER" }[];
  }[];
  boards: {
    id: string;
    title: string;
    description: string | null;
    background: string | null;
    visibility: "WORKSPACE" | "PRIVATE";
    owner: string | null;
    createdAt: string;
    labels: { id: string; name: string; color: string }[];
    members: { email: string; role: "OWNER" | "EDITOR" | "VIEWER" }[];
    lists: { id: string; title: string; position: string; cards: ExportedCard[] }[];
  }[];
};

/** Reads the organization into the export structure, and the attachment files to include. */
export async function collectOrganization(
  workspaceId: string,
  includeAttachments: boolean,
): Promise<{ data: OrganizationExport; files: Map<string, string> }> {
  const w = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      name: true,
      slug: true,
      brandColor: true,
      timezone: true,
      members: {
        select: { role: true, customRole: { select: { name: true } }, user: { select: { email: true, name: true } } },
      },
      customRoles: { select: { name: true, color: true, description: true, permissions: true } },
      teams: {
        select: {
          name: true,
          description: true,
          color: true,
          members: { select: { member: { select: { user: { select: { email: true } } } } } },
          boards: { select: { boardId: true, role: true } },
        },
      },
      boards: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          background: true,
          visibility: true,
          createdAt: true,
          owner: { select: { email: true } },
          labels: { select: { id: true, name: true, color: true } },
          members: { select: { role: true, user: { select: { email: true } } } },
          lists: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              position: true,
              cards: {
                orderBy: { position: "asc" },
                select: {
                  id: true,
                  title: true,
                  description: true,
                  position: true,
                  dueDate: true,
                  createdAt: true,
                  labels: { select: { labelId: true } },
                  assignees: { select: { user: { select: { email: true } } } },
                  checklists: {
                    orderBy: { position: "asc" },
                    select: {
                      title: true,
                      position: true,
                      items: { orderBy: { position: "asc" }, select: { text: true, done: true, position: true } },
                    },
                  },
                  comments: {
                    orderBy: { createdAt: "asc" },
                    select: { text: true, createdAt: true, author: { select: { email: true, name: true } } },
                  },
                  attachments: { select: { filename: true, mimeType: true, size: true, storedName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const files = new Map<string, string>();
  const data: OrganizationExport = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: { name: w.name, slug: w.slug, brandColor: w.brandColor, timezone: w.timezone },
    members: w.members.map((m) => ({
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      customRole: m.customRole?.name ?? null,
    })),
    customRoles: w.customRoles,
    teams: w.teams.map((t) => ({
      name: t.name,
      description: t.description,
      color: t.color,
      members: t.members.map((m) => m.member.user.email),
      boards: t.boards.map((b) => ({ board: b.boardId, role: b.role })),
    })),
    boards: w.boards.map((b) => ({
      id: b.id,
      title: b.title,
      description: b.description,
      background: b.background,
      visibility: b.visibility,
      owner: b.owner?.email ?? null,
      createdAt: b.createdAt.toISOString(),
      labels: b.labels,
      members: b.members.map((m) => ({ email: m.user.email, role: m.role })),
      lists: b.lists.map((l) => ({
        id: l.id,
        title: l.title,
        position: l.position,
        cards: l.cards.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          position: c.position,
          dueDate: c.dueDate?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
          labels: c.labels.map((x) => x.labelId),
          assignees: c.assignees.map((a) => a.user.email),
          checklists: c.checklists,
          comments: c.comments.map((cm) => ({
            author: cm.author.email,
            authorName: cm.author.name,
            text: cm.text,
            createdAt: cm.createdAt.toISOString(),
          })),
          attachments: c.attachments.map((a) => {
            const file = includeAttachments ? `attachments/${a.storedName}` : null;
            if (file) files.set(file, a.storedName);
            return { filename: a.filename, mimeType: a.mimeType, size: a.size, file };
          }),
        })),
      })),
    })),
  };
  return { data, files };
}

/** The .zip of an organization: organization.json plus attachments (missing files skipped). */
export async function buildOrganizationZip(workspaceId: string, includeAttachments: boolean): Promise<Buffer> {
  const { data, files } = await collectOrganization(workspaceId, includeAttachments);
  const entries: Zippable = {
    "organization.json": [strToU8(JSON.stringify(data, null, 2)), { level: 6 }],
    "README.txt": [
      strToU8(
        `orgtable export of "${data.workspace.name}" (${data.exportedAt}).\n` +
          "organization.json holds the boards, lists, cards, comments, roles and teams.\n" +
          "attachments/ holds the files of the cards, if they were included.\n" +
          "Import it from Settings > Backups of an organization on any orgtable instance.\n",
      ),
      { level: 6 },
    ],
  };
  for (const [path, storedName] of files) {
    try {
      entries[path] = [new Uint8Array(await readAttachmentFile(storedName)), { level: 0 }];
    } catch {
      // A file missing on disk is left out; the card keeps its metadata.
      const card = data.boards.flatMap((b) => b.lists.flatMap((l) => l.cards)).flatMap((c) => c.attachments);
      const a = card.find((x) => x.file === path);
      if (a) a.file = null;
      entries["organization.json"] = [strToU8(JSON.stringify(data, null, 2)), { level: 6 }];
    }
  }
  return Buffer.from(zipSync(entries));
}

// Limits when opening a zip someone uploaded: total size once unzipped and number of entries,
// so a crafted archive (a "zip bomb") cannot exhaust memory.
const MAX_UNZIPPED = 2 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

export class InvalidArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidArchiveError";
  }
}

/** Opens an export: its organization.json, checked, and its attachment files by path. */
export function readOrganizationZip(zip: Buffer): { data: OrganizationExport; files: Map<string, Buffer> } {
  let total = 0;
  let count = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(zip), {
      filter: (f) => {
        count += 1;
        total += f.originalSize;
        if (count > MAX_ENTRIES || total > MAX_UNZIPPED) throw new InvalidArchiveError("The archive is too large");
        return f.name === "organization.json" || /^attachments\/[A-Za-z0-9._-]+$/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof InvalidArchiveError) throw e;
    throw new InvalidArchiveError("Not a valid .zip file");
  }
  const json = entries["organization.json"];
  if (!json) throw new InvalidArchiveError("organization.json is missing");
  let data: OrganizationExport;
  try {
    data = JSON.parse(strFromU8(json));
  } catch {
    throw new InvalidArchiveError("organization.json is not valid JSON");
  }
  if (data?.format !== FORMAT || typeof data.version !== "number" || data.version > FORMAT_VERSION) {
    throw new InvalidArchiveError("This is not an orgtable organization export (or it is from a newer version)");
  }
  if (!Array.isArray(data.boards)) throw new InvalidArchiveError("organization.json has no boards");
  const files = new Map<string, Buffer>();
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.startsWith("attachments/")) files.set(name, Buffer.from(bytes));
  }
  return { data, files };
}
