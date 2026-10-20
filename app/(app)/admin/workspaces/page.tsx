import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/app/lib/dal";
import { getInstanceStats, getWorkspacesForAdmin } from "@/app/lib/queries";
import {
  deleteWorkspaceAsAdmin,
  suspendWorkspace,
  unsuspendWorkspace,
} from "@/app/lib/actions/admin";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import { formatDate } from "@/app/lib/format-date";

// The instance administrator's view of the whole service: figures and every workspace,
// with suspend / reactivate / delete. Metadata and counts only: there is no way from here
// into anyone's boards. See docs/workspaces.md.

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.admin.workspaces.meta.title };
}

function messageFor(
  messages: Record<string, string>,
  code: string | undefined,
) {
  return code && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

export default async function AdminWorkspacesPage({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    q?: string;
    ok?: string;
    error?: string;
  }>;
}) {
  await requireAdmin();
  const { m, intl } = await getI18n();
  const t = m.admin.workspaces;
  const params = await searchParams;
  const kind = params.kind === "PERSONAL" ? "PERSONAL" : "ORGANIZATION";
  const query = (params.q ?? "").slice(0, 60);
  const [stats, workspaces] = await Promise.all([
    getInstanceStats(),
    getWorkspacesForAdmin(kind, query),
  ]);
  const okMessage = messageFor(t.ok, params.ok);
  const errorMessage = messageFor(t.errors, params.error);

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {t.title}
        </h1>
      </div>
      <p className="mt-1.5 max-w-2xl text-sm text-ink-muted">{t.intro}</p>

      {okMessage && (
        <p
          role="status"
          className="mt-4 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"
        >
          {okMessage}
        </p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {errorMessage}
        </p>
      )}

      <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(Object.keys(stats) as (keyof typeof stats)[]).map((key) => (
          <div
            key={key}
            className="rounded-xl border border-border bg-surface p-4"
          >
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {t.stats[key]}
            </dt>
            <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">
              {new Intl.NumberFormat(intl).format(stats[key])}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label={t.columns.workspace}
          className="flex gap-1 rounded-xl bg-surface-2 p-1 text-sm"
        >
          {(["ORGANIZATION", "PERSONAL"] as const).map((k) =>
            k === kind ? (
              <span
                key={k}
                aria-current="page"
                className="rounded-lg bg-surface px-3 py-1.5 font-semibold shadow-sm"
              >
                {t.tabs[k]}
              </span>
            ) : (
              <Link
                key={k}
                href={`/admin/workspaces?kind=${k}`}
                className="rounded-lg px-3 py-1.5 font-medium text-ink-muted hover:text-ink"
              >
                {t.tabs[k]}
              </Link>
            ),
          )}
        </nav>
        <form className="flex gap-2" role="search">
          <input type="hidden" name="kind" value={kind} />
          <Input
            name="q"
            defaultValue={query}
            aria-label={t.search}
            placeholder={t.search}
            className="w-64"
          />
          <Button type="submit" variant="outline">
            {t.searchSubmit}
          </Button>
        </form>
      </div>

      {workspaces.length === 0 ? (
        <p className="mt-6 text-sm text-ink-muted">{t.empty}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-surface">
          <table className="w-full min-w-[60rem] text-left text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2.5 font-semibold">{t.columns.workspace}</th>
                <th className="px-4 py-2.5 font-semibold">{t.columns.owners}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.columns.members}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.columns.boards}</th>
                <th className="px-4 py-2.5 font-semibold">{t.columns.created}</th>
                <th className="px-4 py-2.5 font-semibold">{t.columns.status}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{t.columns.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {workspaces.map((w) => (
                <tr key={w.id} data-menu-scope="row" data-menu-title={w.name} className={`align-middle ${w.suspendedAt ? "bg-danger/[0.04]" : ""}`}>
                  <td className="px-4 py-3.5">
                    <p className="font-semibold">{w.name}</p>
                    <p className="font-mono text-xs text-ink-muted">/{w.slug}</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs">
                    {w.members.map((o) => (
                      <p key={o.user.email}>
                        {o.user.name} <span className="text-ink-muted">· {o.user.email}</span>
                      </p>
                    ))}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">{w._count.members}</td>
                  <td className="px-4 py-3.5 text-right font-mono tabular-nums">{w._count.boards}</td>
                  <td className="px-4 py-3.5 text-xs text-ink-muted">{formatDate(w.createdAt, intl)}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold ${
                        w.suspendedAt ? "bg-danger/12 text-danger" : "bg-success/12 text-success"
                      }`}
                    >
                      <span aria-hidden className="size-1.5 rounded-full bg-current" />
                      {w.suspendedAt ? t.suspendedLabel : t.active}
                    </span>
                    {w.suspendedReason && (
                      <p className="mt-1 max-w-56 text-xs text-ink-muted">{w.suspendedReason}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      {w.suspendedAt ? (
                        <form action={unsuspendWorkspace}>
                          <input type="hidden" name="workspaceId" value={w.id} />
                          <Button type="submit" variant="outline" className="h-9 px-3">
                            {t.unsuspend}
                          </Button>
                        </form>
                      ) : (
                        <ActionPopover label={t.suspend} tone="outline">
                          <form action={suspendWorkspace} className="flex flex-col gap-2">
                            <input type="hidden" name="workspaceId" value={w.id} />
                            <label className="text-xs font-semibold text-ink-muted">
                              {t.reasonLabel}
                              <Input name="reason" maxLength={300} className="mt-1" />
                            </label>
                            <Button type="submit" variant="dangerSolid" className="h-9">
                              {t.suspend}
                            </Button>
                          </form>
                        </ActionPopover>
                      )}
                      {w.kind === "ORGANIZATION" && (
                        <ActionPopover label={`${t.delete}…`} tone="danger">
                          <form action={deleteWorkspaceAsAdmin} className="flex flex-col gap-2">
                            <input type="hidden" name="workspaceId" value={w.id} />
                            <label className="text-xs font-semibold text-ink-muted">
                              {fmt(t.deleteConfirm, { slug: w.slug })}
                              <Input name="confirm" autoComplete="off" className="mt-1 font-mono" />
                            </label>
                            <Button type="submit" variant="dangerSolid" className="h-9">
                              {t.delete}
                            </Button>
                          </form>
                        </ActionPopover>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A button that opens a small panel with the confirmation form (no JavaScript needed). */
function ActionPopover({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "outline" | "danger";
  children: React.ReactNode;
}) {
  return (
    <details className="relative">
      <summary
        className={`inline-flex h-9 cursor-pointer list-none items-center rounded-lg border px-3 text-sm font-semibold shadow-sm transition [&::-webkit-details-marker]:hidden ${
          tone === "danger"
            ? "border-danger/40 bg-surface text-danger hover:bg-danger/5"
            : "border-ink/20 bg-surface text-ink hover:bg-surface-2"
        }`}
      >
        {label}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border bg-surface p-4 text-left shadow-[0_16px_40px_-16px_oklch(0.27_0.022_52/0.45)]">
        {children}
      </div>
    </details>
  );
}
