import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { listWebhooks, recentDeliveries } from "@/app/lib/services/webhooks";
import { isSecretKeyConfigured } from "@/app/lib/crypto/secrets";
import { formatDateTime } from "@/app/lib/format-date";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

// /<slug>/settings/webhooks: the organization's outgoing webhooks, recent deliveries and how
// to verify the signature ("integrations.manage"). See docs/webhooks.md.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "integrations.manage");
  const { m } = await getI18n();
  return { title: `${m.webhooks.page.title} · ${workspace.name}` };
}

const STATUS: Record<string, string> = {
  SUCCESS: "bg-success/12 text-success",
  FAILED: "bg-danger/10 text-danger",
  PENDING: "bg-surface-2 text-ink-muted",
};

export default async function WebhooksPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "integrations.manage");
  const [{ intl, m }, hooks, deliveries] = await Promise.all([
    getI18n(),
    listWebhooks(workspace.id),
    recentDeliveries(workspace.id, undefined, 15),
  ]);
  const t = m.webhooks.page;
  const failing = hooks.filter((h) => h.disabledAt || h.consecutiveFailures > 0).length;
  const keyReady = isSecretKeyConfigured();
  const base = `/${workspace.slug}/settings/webhooks`;

  return (
    <SettingsPage wide>
      <PageHeader
        address={base}
        title={t.title}
        description={t.subtitle}
        action={
          keyReady ? (
            <Link
              href={`${base}/new`}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink shadow-sm transition hover:bg-accent-hover"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="size-4" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
              {t.new}
            </Link>
          ) : undefined
        }
      />
      {!keyReady && <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-ink-muted">{t.noKey}</p>}
      {failing > 0 && (
        <p role="alert" className="rounded-2xl border border-danger/30 bg-danger/[0.06] p-4 text-sm font-medium text-danger">
          {plural(intl, t.failing, failing)}
        </p>
      )}

      <SettingsCard title={t.endpoints}>
        {hooks.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {hooks.map((h) => {
              const last = h.deliveries[0];
              const state = h.disabledAt ? t.disabled : h.active ? t.active : t.paused;
              return (
                <li key={h.id}>
                  <Link href={`${base}/${h.id}`} className="flex flex-wrap items-center gap-3 py-3 hover:bg-surface-2/50">
                    <span className="min-w-0 flex-[1_1_14rem]">
                      <span className="block truncate font-semibold">{h.name}</span>
                      <span className="block truncate font-mono text-xs text-ink-muted">{h.url}</span>
                    </span>
                    <span className="text-xs text-ink-muted">
                      {h.board ? fmt(t.scopeBoard, { board: h.board.title }) : t.scopeOrg} ·{" "}
                      {m.webhooks.form.formats[h.format]} · {plural(intl, t.events, h.events.length)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        h.disabledAt ? "bg-danger/10 text-danger" : h.active ? "bg-success/12 text-success" : "bg-surface-2 text-ink-muted"
                      }`}
                    >
                      {state}
                    </span>
                    <span className="font-mono text-[11px] text-ink-muted">
                      {last ? `${m.webhooks.status[last.status]} · ${formatDateTime(last.createdAt, intl)}` : t.never}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-muted">{t.scopeNote}</p>
      </SettingsCard>

      <SettingsCard title={t.recent}>
        {deliveries.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.noDeliveries}</p>
        ) : (
          <ul className="divide-y divide-border">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[d.status]}`}>
                  {m.webhooks.status[d.status]}
                </span>
                <span className="font-mono text-xs">{d.event}</span>
                <Link href={`${base}/${d.webhook.id}`} className="text-ink-muted hover:underline">
                  {d.webhook.name}
                </Link>
                <span className="ml-auto font-mono text-[11px] text-ink-muted">
                  {d.responseStatus ? `HTTP ${d.responseStatus} · ` : ""}
                  {d.durationMs !== null ? `${d.durationMs} ms · ` : ""}
                  {formatDateTime(d.createdAt, intl)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title={t.verifyTitle} description={t.verifyText}>
        <pre className="overflow-x-auto rounded-xl bg-[oklch(0.22_0.02_50)] p-4 font-mono text-xs leading-relaxed text-white/90">
          {`POST /your/endpoint
Content-Type: application/json
X-Orgtable-Event: card.created
X-Orgtable-Delivery: 9b2f…
X-Orgtable-Signature: t=1792065600,v1=5f8a…

// Node.js
const [t, ...sigs] = header.split(",");
const expected = crypto.createHmac("sha256", secret)
  .update(\`\${t.slice(2)}.\${rawBody}\`).digest("hex");
const ok = sigs.some((s) => s === \`v1=\${expected}\`);`}
        </pre>
      </SettingsCard>
    </SettingsPage>
  );
}
