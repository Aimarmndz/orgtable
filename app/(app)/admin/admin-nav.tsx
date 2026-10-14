import Link from "next/link";

const TABS = [
  { href: "/admin/users", label: "Usuarios" },
  { href: "/admin/instance", label: "Instancia" },
  { href: "/admin/audit", label: "Auditoría" },
] as const;

/** Pestañas de las páginas de administración. */
export function AdminNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav aria-label="Administración" className="flex flex-wrap gap-1 text-sm">
      {TABS.map((t) =>
        t.href === current ? (
          <span
            key={t.href}
            aria-current="page"
            className="rounded-lg bg-surface-2 px-2.5 py-1 font-medium"
          >
            {t.label}
          </span>
        ) : (
          <Link
            key={t.href}
            href={t.href}
            className="rounded-lg px-2.5 py-1 text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {t.label}
          </Link>
        ),
      )}
    </nav>
  );
}
