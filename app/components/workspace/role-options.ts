import type { Messages } from "@/app/i18n/config";
import type { WorkspaceRole } from "@/app/lib/roles";
import { fmt } from "@/app/i18n/format";

// The entries of a role picker: the base roles the actor may grant and, when they may grant
// MEMBER and give roles at all, the organization's custom roles as "custom:<id>" (always on
// top of MEMBER; memberRoleChoiceSchema parses it back).

export function roleOptions(
  m: Messages,
  grantable: WorkspaceRole[],
  customRoles: { id: string; name: string }[],
): { value: string; label: string }[] {
  const base = grantable.map((r) => ({ value: r, label: m.workspaces.roles[r] }));
  if (!grantable.includes("MEMBER")) return base;
  return [
    ...base,
    ...customRoles.map((r) => ({
      value: `custom:${r.id}`,
      label: fmt(m.workspaces.members.memberAs, { role: r.name }),
    })),
  ];
}
