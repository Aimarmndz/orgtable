import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { auditCategoryPrefixes, type AuditCategory } from "@/app/lib/audit-categories";

// An organization's own activity log (docs/audit.md): the AuditLog rows whose workspaceId is
// the organization, newest first, with filters and a cursor. Only ever filtered by the
// workspace id the caller resolved through requireOrgPermission(slug, "audit.view").

export const AUDIT_PAGE = 50;

export type OrgAuditFilters = {
  category?: AuditCategory;
  userId?: string;
  // Cursor: the id of the last row of the previous page.
  after?: string;
};

function where(workspaceId: string, f: OrgAuditFilters): Prisma.AuditLogWhereInput {
  return {
    workspaceId,
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.category ? { OR: auditCategoryPrefixes(f.category).map((p) => ({ action: { startsWith: p } })) } : {}),
  };
}

export async function listOrgAudit(workspaceId: string, filters: OrgAuditFilters, take = AUDIT_PAGE) {
  const rows = await prisma.auditLog.findMany({
    where: where(workspaceId, filters),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(filters.after ? { cursor: { id: filters.after }, skip: 1 } : {}),
    select: {
      id: true,
      action: true,
      detail: true,
      ip: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  });
  const more = rows.length > take;
  const page = more ? rows.slice(0, take) : rows;
  return { rows: page, next: more ? page[page.length - 1].id : null };
}

// Candidate ids in a detail: word-like tokens of 6 to 40 letters, digits, "_" or "-" (cuids,
// and ids written by tests and seeds). Most are just words: they are looked up as ids within
// THIS organization and left alone when nothing matches.
const ID = /[A-Za-z0-9_-]{6,40}/g;
const MAX_IDS = 500;

/**
 * Readable details: ids of people, boards, roles and teams OF THIS ORGANIZATION are replaced
 * by their names. Ids of anything else stay as they are, so a detail can never be used to
 * read a name from another organization.
 */
export async function readableDetails(
  workspaceId: string,
  details: (string | null)[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const d of details) for (const m of d?.match(ID) ?? []) if (ids.size < MAX_IDS) ids.add(m);
  const names = new Map<string, string>();
  if (ids.size > 0) {
    const list = [...ids];
    const [members, boards, roles, teams] = await Promise.all([
      prisma.workspaceMember.findMany({
        where: { workspaceId, userId: { in: list } },
        select: { user: { select: { id: true, name: true } } },
      }),
      prisma.board.findMany({ where: { workspaceId, id: { in: list } }, select: { id: true, title: true } }),
      prisma.workspaceCustomRole.findMany({ where: { workspaceId, id: { in: list } }, select: { id: true, name: true } }),
      prisma.team.findMany({ where: { workspaceId, id: { in: list } }, select: { id: true, name: true } }),
    ]);
    for (const m of members) names.set(m.user.id, m.user.name);
    for (const b of boards) names.set(b.id, `«${b.title}»`);
    for (const r of roles) names.set(r.id, `«${r.name}»`);
    for (const t of teams) names.set(t.id, `«${t.name}»`);
  }
  const out = new Map<string, string>();
  for (const d of details) {
    if (!d) continue;
    out.set(
      d,
      d.replace(ID, (id) => names.get(id) ?? id).replace(/custom:«/g, "«"),
    );
  }
  return out;
}

/** The people who appear in the organization's log, for the "person" filter. */
export async function auditPeople(workspaceId: string) {
  const rows = await prisma.auditLog.findMany({
    where: { workspaceId, userId: { not: null } },
    distinct: ["userId"],
    select: { user: { select: { id: true, name: true } } },
    take: 500,
  });
  return rows
    .flatMap((r) => (r.user ? [r.user] : []))
    .sort((a, b) => a.name.localeCompare(b.name));
}
