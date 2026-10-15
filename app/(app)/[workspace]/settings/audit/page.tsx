import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { auditPeople, listOrgAudit, readableDetails } from "@/app/lib/services/org-audit";
import { AUDIT_CATEGORIES, auditCategory, isAuditCategory, type AuditCategory } from "@/app/lib/audit-categories";
import { BOARD_COLORS, pickBoardColor } from "@/app/lib/colors";
import { initials } from "@/app/lib/initials";
import { formatDay, formatTime } from "@/app/lib/format-date";
import { PageHeader, SettingsPage } from "@/app/components/settings/page-header";
import { SELECT } from "@/app/components/settings/form-bits";
import { getI18n } from "@/app/i18n/server";

// /<slug>/settings/audit: what happened in the organization, newest first and grouped by
// day ("audit.view"). Filters by category and person live in the address, so a filtered
// view can be shared and exported as is. See docs/audit.md.

type Params = Promise<{ workspace: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "audit.view");
  const { m } = await getI18n();
  return { title: `${m.workspaces.audit.title} · ${workspace.name}` };
}

const CHIP: Record<AuditCategory, string> = {
  organization: "bg-ink/10 text-ink",
  people: "bg-accent/12 text-accent",
  boards: "bg-success/12 text-success",
  integrations: "bg-[oklch(0.5_0.07_248/0.14)] text-[oklch(0.42_0.08_248)]",
  data: "bg-[oklch(0.54_0.09_62/0.16)] text-[oklch(0.42_0.09_62)]",
  security: "bg-danger/10 text-danger",
};

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : "";
}

export default async function OrgAuditPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { workspace: slug } = await params;
  const sp = await searchParams;
  const { workspace } = await requireOrgPermission(slug, "audit.view");
  const rawCategory = one(sp.category);
  const category = isAuditCategory(rawCategory) ? rawCategory : undefined;
  const person = one(sp.person) || undefined;
  const after = one(sp.after) || undefined;
  const [{ intl, m }, { rows, next }, people] = await Promise.all([
    getI18n(),
    listOrgAudit(workspace.id, { category, userId: person, after }),
    auditPeople(workspace.id),
  ]);
  const details = await readableDetails(
    workspace.id,
    rows.map((r) => r.detail),
  );
  const t = m.workspaces.audit;
  const labels: Record<string, string> = m.admin.audit.actions;
  const base = `/${workspace.slug}/settings/audit`;
  const query = new URLSearchParams({ ...(category ? { category } : {}), ...(person ? { person } : {}) });
  const exportHref = `/api/workspaces/${workspace.slug}/audit${query.size ? `?${query}` : ""}`;

  // Group by day in the instance's time zone.
  const days: { day: string; rows: typeof rows }[] = [];
  for (const r of rows) {
    const day = formatDay(r.createdAt, intl);
    if (days.at(-1)?.day !== day) days.push({ day, rows: [] });
    days.at(-1)!.rows.push(r);
  }

  return (
    <SettingsPage wide>
      <PageHeader
        address={base}
        title={t.title}
        description={t.subtitle}
        action={
          <a
            href={exportHref}
            download
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-ink/20 bg-surface px-4 text-sm font-semibold shadow-sm transition hover:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-4" aria-hidden>
              <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
            </svg>
            {t.export}
          </a>
        }
      />

      <form method="get" action={base} className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-surface p-4">
        <label className="min-w-40 flex-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.category}</span>
          <select name="category" defaultValue={category ?? ""} className={SELECT}>
            <option value="">{t.allCategories}</option>
            {AUDIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t.categories[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-40 flex-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.person}</span>
          <select name="person" defaultValue={person ?? ""} className={SELECT}>
            <option value="">{t.everyone}</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-lg border border-ink/20 bg-surface px-4 text-sm font-semibold shadow-sm hover:bg-surface-2"
        >
          {t.filter}
        </button>
        {(category || person) && (
          <Link href={base} className="inline-flex h-10 items-center px-2 text-sm font-semibold text-ink-muted hover:text-ink">
            {t.clear}
          </Link>
        )}
      </form>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-ink-muted">
          {t.empty}
        </p>
      ) : (
        days.map(({ day, rows: dayRows }) => (
          <section key={day} aria-label={day}>
            <h2 className="px-1 pb-2 text-sm font-bold first-letter:uppercase">{day}</h2>
            <ol className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {dayRows.map((r) => {
                const cat = auditCategory(r.action);
                return (
                  <li key={r.id} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-3 px-4 py-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto]">
                    <time dateTime={r.createdAt.toISOString()} className="pt-1 font-mono text-xs text-ink-muted">
                      {formatTime(r.createdAt, intl)}
                    </time>
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
                        style={{ background: r.user ? BOARD_COLORS[pickBoardColor(r.user.id)] : "var(--color-ink)" }}
                      >
                        {r.user ? initials(r.user.name) : "o"}
                      </span>
                      <p className="min-w-0 text-sm">
                        <span className="font-semibold">{r.user?.name ?? t.system}</span>{" "}
                        <span className="text-ink-muted">·</span>{" "}
                        {Object.hasOwn(labels, r.action) ? labels[r.action] : r.action}
                        {r.detail && (
                          <span className="block break-words text-ink-muted">{details.get(r.detail) ?? r.detail}</span>
                        )}
                      </p>
                    </div>
                    <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:flex-col sm:items-end">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CHIP[cat]}`}>
                        {t.categories[cat]}
                      </span>
                      {r.ip && <span className="font-mono text-[11px] text-ink-muted">{r.ip}</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))
      )}

      {next && (
        <Link
          href={`${base}?${new URLSearchParams({ ...Object.fromEntries(query), after: next })}`}
          className="mx-auto inline-flex h-10 items-center rounded-lg border border-ink/20 bg-surface px-4 text-sm font-semibold shadow-sm hover:bg-surface-2"
        >
          {t.more}
        </Link>
      )}
    </SettingsPage>
  );
}
