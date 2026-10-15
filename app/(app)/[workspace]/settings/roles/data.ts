import "server-only";
import { prisma } from "@/app/lib/prisma";
import { listCustomRoles } from "@/app/lib/services/roles";
import type { WorkspaceRole } from "@/app/lib/roles";

/** The roles of an organization with how many people hold each (base and custom). */
export async function loadRoles(workspaceId: string) {
  const [grouped, custom] = await Promise.all([
    prisma.workspaceMember.groupBy({
      by: ["role"],
      where: { workspaceId, customRoleId: null },
      _count: { _all: true },
    }),
    listCustomRoles(workspaceId),
  ]);
  const baseCounts: Record<WorkspaceRole, number> = { OWNER: 0, ADMIN: 0, MEMBER: 0 };
  for (const g of grouped) baseCounts[g.role] = g._count._all;
  return { baseCounts, custom };
}
