import Link from "next/link";
import { BOARD_COLORS, type BoardColor } from "@/app/lib/colors";
import { MEMBER_PERMISSIONS, PERMISSIONS } from "@/app/lib/permissions";
import type { WorkspaceRole } from "@/app/lib/roles";
import type { Messages } from "@/app/i18n/config";
import { fmt } from "@/app/i18n/format";

// The list of roles of an organization: the three base ones (locked) and the custom ones,
// each with how many people hold it. Used by the roles index and, on wide screens, next to
// the editor. `current` marks the open one.

export const BASE_ROLE_SLUGS: Record<string, WorkspaceRole> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};

type CustomRoleRow = { id: string; name: string; color: string; permissions: string[]; _count: { members: number } };

const LOCK = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

export function RoleList({
  slug,
  m,
  baseCounts,
  custom,
  current,
}: {
  slug: string;
  m: Messages;
  baseCounts: Record<WorkspaceRole, number>;
  custom: CustomRoleRow[];
  current?: string;
}) {
  const t = m.workspaces.rolesPage;
  const total = String(PERMISSIONS.length);
  const row = (key: string, href: string, dot: string, name: string, sub: string, count: number, locked: boolean) => (
    <li key={key}>
      <Link
        href={href}
        aria-current={current === key ? "page" : undefined}
        className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-accent ${
          current === key ? "bg-surface shadow-sm ring-1 ring-border" : "hover:bg-surface"
        }`}
      >
        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 font-semibold">
            <span className="truncate">{name}</span>
            {locked && <span className="text-ink-muted">{LOCK}</span>}
          </span>
          <span className="block truncate text-xs text-ink-muted">{sub}</span>
        </span>
        <span className="font-mono text-sm text-ink-muted">{count}</span>
      </Link>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t.base}</p>
        <ul className="flex flex-col gap-0.5">
          {row("owner", `/${slug}/settings/roles/owner`, "var(--color-ink)", m.workspaces.roles.OWNER, fmt(t.count, { count: total, total }), baseCounts.OWNER, true)}
          {row("admin", `/${slug}/settings/roles/admin`, "var(--color-accent)", m.workspaces.roles.ADMIN, fmt(t.count, { count: total, total }), baseCounts.ADMIN, true)}
          {row(
            "member",
            `/${slug}/settings/roles/member`,
            "var(--color-ink-muted)",
            m.workspaces.roles.MEMBER,
            fmt(t.count, { count: String(MEMBER_PERMISSIONS.length), total }),
            baseCounts.MEMBER,
            true,
          )}
        </ul>
      </div>
      <div>
        <p className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">{t.custom}</p>
        {custom.length === 0 ? (
          <p className="px-3 text-sm text-ink-muted">{t.noCustom}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {custom.map((r) =>
              row(
                r.id,
                `/${slug}/settings/roles/${r.id}`,
                BOARD_COLORS[(r.color in BOARD_COLORS ? r.color : "blue") as BoardColor],
                r.name,
                fmt(t.count, { count: String(r.permissions.length), total }),
                r._count.members,
                false,
              ),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
