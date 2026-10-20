import { backupConfig, listBackups } from "@/app/lib/services/backups";
import { deleteBackupAction } from "@/app/lib/actions/backups";
import { formatDateTime } from "@/app/lib/format-date";
import { SettingsCard } from "@/app/components/settings/page-header";
import { DestinationForm, RestoreForm, ScheduleForm } from "@/app/components/settings/backup-forms";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// The backups panel shared by an organization (/<slug>/settings/backups) and the instance
// administration (/admin/backups): figures, schedule, destination and history. Server
// Component; the forms are client components (backup-forms.tsx). docs/backups.md.

function size(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function BackupsPanel({
  workspaceId,
  scope,
  downloadBase,
  confirm,
  timeZone,
}: {
  workspaceId: string | null;
  scope: string;
  // "/api/workspaces/<slug>/backups" or "/api/admin/backups".
  downloadBase: string;
  // What to type to restore (the organization's address, or "instance").
  confirm: string;
  timeZone: string;
}) {
  const [{ intl, m }, config, backups] = await Promise.all([getI18n(), backupConfig(workspaceId), listBackups(workspaceId)]);
  const t = m.backups;
  const last = backups.find((b) => b.status === "SUCCESS");
  const kept = backups.filter((b) => b.kind === "SCHEDULED" && b.status === "SUCCESS").length;
  const destination = config.destination === "S3" ? `S3 · ${config.s3Bucket ?? ""}` : t.stats.local;
  const STATUS: Record<string, string> = {
    SUCCESS: "bg-success/12 text-success",
    FAILED: "bg-danger/10 text-danger",
    RUNNING: "bg-surface-2 text-ink-muted",
  };

  return (
    <>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          [t.stats.last, last ? formatDateTime(last.createdAt, intl) : t.stats.none, last ? size(last.size) : ""],
          [t.stats.next, config.frequency === "OFF" ? t.stats.off : t.schedule[config.frequency], `${String(config.hour).padStart(2, "0")}:00 · ${timeZone}`],
          [t.stats.destination, destination, config.encrypt ? t.history.encrypted : ""],
          [t.stats.kept, fmt(t.stats.keptOf, { count: String(kept), max: String(config.retention) }), ""],
        ].map(([label, value, sub]) => (
          <div key={label} className="rounded-2xl border border-border bg-surface p-4">
            <dt className="text-xs font-bold uppercase tracking-wide text-ink-muted">{label}</dt>
            <dd className="mt-1.5 truncate font-semibold">{value}</dd>
            {sub && <dd className="truncate text-xs text-ink-muted">{sub}</dd>}
          </div>
        ))}
      </dl>

      <div className="grid gap-5 lg:grid-cols-2">
        <SettingsCard title={t.schedule.title} description={fmt(t.schedule.hint, { tz: timeZone })}>
          <ScheduleForm scope={scope} config={config} />
          <p className="mt-3 text-xs text-ink-muted">{t.schedule.cronNote}</p>
        </SettingsCard>
        <SettingsCard title={t.destination.title} description={t.destination.hint}>
          <DestinationForm
            scope={scope}
            config={{
              destination: config.destination,
              s3Endpoint: config.s3Endpoint,
              s3Region: config.s3Region,
              s3Bucket: config.s3Bucket,
              s3Prefix: config.s3Prefix,
              hasKeys: Boolean(config.s3AccessKeyEnc && config.s3SecretKeyEnc),
              encrypt: config.encrypt,
            }}
          />
        </SettingsCard>
      </div>

      <SettingsCard title={t.history.title}>
        {backups.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.history.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs font-bold uppercase tracking-wide text-ink-muted">
                  <th className="py-2 pr-3">{t.history.date}</th>
                  <th className="py-2 pr-3">{t.history.kind}</th>
                  <th className="py-2 pr-3">{t.history.size}</th>
                  <th className="py-2 pr-3">{t.history.status}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {backups.map((b) => (
                  <tr key={b.id} data-menu-scope="row" className="align-top">
                    <td className="py-2.5 pr-3 font-mono text-xs">{formatDateTime(b.createdAt, intl)}</td>
                    <td className="py-2.5 pr-3">
                      {t.history.kinds[b.kind]}
                      <span className="block text-xs text-ink-muted">
                        {[b.destination === "S3" ? "S3" : t.stats.local, b.encrypted ? t.history.encrypted : "", b.includesAttachments ? "" : t.history.noFiles]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs">{size(b.size)}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[b.status]}`}>{t.history.statuses[b.status]}</span>
                      {b.error && <span className="mt-1 block max-w-xs break-words text-xs text-danger">{b.error}</span>}
                    </td>
                    <td className="py-2.5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {b.status === "SUCCESS" && (
                          <>
                            <a
                              href={`${downloadBase}/${b.id}`}
                              download
                              className="inline-flex h-8 items-center rounded-lg border border-ink/20 bg-surface px-3 text-xs font-semibold shadow-sm hover:bg-surface-2"
                            >
                              {t.history.download}
                            </a>
                            <RestoreForm scope={scope} backupId={b.id} confirm={confirm} instance={workspaceId === null} />
                          </>
                        )}
                        <form action={deleteBackupAction}>
                          <input type="hidden" name="scope" value={scope} />
                          <input type="hidden" name="backupId" value={b.id} />
                          <Button type="submit" variant="dangerOutline" className="h-8 px-3 text-xs">
                            {t.history.delete}
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SettingsCard>
    </>
  );
}
