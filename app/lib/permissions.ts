// What a person may do in an organization, as named permissions. Shared by server and client
// (deliberately NOT "server-only", like roles.ts): pages and forms import it to show only
// what is allowed; the services check it again against the database.
//
// Three BASE roles stay as they were (roles.ts) and cannot be edited or deleted: OWNER and
// ADMIN hold every permission, MEMBER holds MEMBER_PERMISSIONS. On top of them each
// organization defines CUSTOM roles (WorkspaceCustomRole): a member with a custom role holds
// exactly that role's permissions instead of MEMBER_PERMISSIONS. See docs/roles.md.

import type { WorkspaceRole } from "@/app/lib/roles";

export const PERMISSION_GROUPS = {
  boards: ["boards.view_all", "boards.create", "boards.visibility", "boards.delete"],
  people: ["people.invite", "people.teams", "people.roles", "people.remove"],
  integrations: ["integrations.manage", "apikeys.manage"],
  data: ["audit.view", "data.export", "backups.manage"],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;
export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

export const PERMISSIONS: Permission[] = Object.values(PERMISSION_GROUPS).flat();

/**
 * Permissions a custom role can never hold. Changing roles stays with owners and admins: a
 * custom role that could hand out roles could hand itself (or a friend) admin.
 */
export const BASE_ONLY_PERMISSIONS: readonly Permission[] = ["people.roles"];

/** What a plain member (no custom role) may do besides working on the shared boards. */
export const MEMBER_PERMISSIONS: readonly Permission[] = ["boards.create"];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as string[]).includes(value);
}

/** The permissions a custom role may hold, from untrusted input: known, deduplicated, allowed. */
export function sanitizeCustomPermissions(values: readonly string[]): Permission[] {
  const set = new Set(values.filter(isPermission));
  for (const p of BASE_ONLY_PERMISSIONS) set.delete(p);
  return PERMISSIONS.filter((p) => set.has(p));
}

/**
 * The permissions of a member: everything for owners and admins, the custom role's for a
 * member who has one, MEMBER_PERMISSIONS otherwise. A custom role's list is sanitized again
 * here, so a row written by hand cannot smuggle in a base-only permission.
 */
export function permissionsOf(
  role: WorkspaceRole,
  customPermissions?: readonly string[] | null,
): ReadonlySet<Permission> {
  if (role === "OWNER" || role === "ADMIN") return new Set(PERMISSIONS);
  if (customPermissions) return new Set(sanitizeCustomPermissions(customPermissions));
  return new Set(MEMBER_PERMISSIONS);
}

export function can(perms: ReadonlySet<Permission>, permission: Permission): boolean {
  return perms.has(permission);
}
