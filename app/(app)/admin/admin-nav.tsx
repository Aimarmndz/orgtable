import Link from "next/link";
import { getI18n } from "@/app/i18n/server";

const TABS = [
  { href: "/admin/workspaces", key: "workspaces" },
  { href: "/admin/users", key: "users" },
  { href: "/admin/instance", key: "instance" },
  { href: "/admin/audit", key: "audit" },
] as const;

/** Tabs of the administration pages. */
export async function AdminNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  const { m } = await getI18n();
  return (
    <nav aria-label={m.admin.nav.label} className="flex flex-wrap gap-1 text-sm">
      {TABS.map((t) =>
        t.href === current ? (
          <span
            key={t.href}
            aria-current="page"
            className="rounded-lg bg-surface-2 px-2.5 py-1 font-medium"
          >
            {m.admin.nav[t.key]}
          </span>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-lg px-2.5 py-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {m.admin.nav[t.key]}
          </Link>
        ),
      )}
    </nav>
  );
}
