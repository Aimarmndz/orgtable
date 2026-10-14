import type { Metadata } from "next";
import { requireAdmin } from "@/app/lib/dal";
import { getRecentAuditLogs } from "@/app/lib/queries";
import type { AuditAction } from "@/app/lib/audit";
import { getI18n } from "@/app/i18n/server";
import { formatDateTime } from "@/app/lib/format-date";
import { plural } from "@/app/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.admin.audit.meta.title, description: m.admin.audit.meta.description };
}

// Risky actions worth highlighting.
const WARN_ACTIONS = new Set<string>([
  "auth.login_failed",
  "auth.login_rate_limited",
  "auth.register_rate_limited",
  "user.deleted",
  "account.deleted",
  "board.deleted",
]);

export default async function AdminAuditPage() {
  await requireAdmin();
  const { intl, m } = await getI18n();
  const t = m.admin.audit;
  // Typed against AuditAction: adding an action without its label in locales/en/admin.json
  // fails the type check. Rows written by an older or newer version may hold an action
  // that is no longer listed: those show the raw code.
  const labels: Record<AuditAction, string> = t.actions;
  const actionLabel = (action: string): string =>
    Object.hasOwn(labels, action) ? labels[action as AuditAction] : action;
  const logs = await getRecentAuditLogs();

  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {t.title}
        </h1>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {plural(intl, t.intro, logs.length)}
      </p>

      {logs.length === 0 ? (
        <p className="mt-8 text-sm text-ink-muted">{t.empty}</p>
      ) : (
        // overflow-x-auto: on mobile the table scrolls instead of being clipped.
        <div className="mt-6 overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">{t.table.when}</th>
                <th className="px-4 py-3 font-semibold">{t.table.action}</th>
                <th className="px-4 py-3 font-semibold">{t.table.who}</th>
                <th className="px-4 py-3 font-semibold">{t.table.detail}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="bg-surface align-top">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-ink-muted tabular-nums">
                    {formatDateTime(log.createdAt, intl)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={
                        WARN_ACTIONS.has(log.action)
                          ? "font-medium text-danger"
                          : "font-medium"
                      }
                    >
                      {actionLabel(log.action)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-ink-muted">
                    {log.user ? (
                      <span title={log.user.email}>{log.user.name}</span>
                    ) : (
                      <span className="italic">—</span>
                    )}
                    {log.ip && (
                      <span className="ml-1 text-xs text-ink-muted/70">
                        ({log.ip})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-muted">
                    {[log.targetType, log.detail].filter(Boolean).join(" · ") ||
                      "—"}
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
