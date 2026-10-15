import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { recentDeliveries } from "@/app/lib/services/webhooks";
import { deleteWebhookAction, redeliverAction, setWebhookActiveAction } from "@/app/lib/actions/webhooks";
import { formatDateTime } from "@/app/lib/format-date";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { PingForm, RotateSecretForm, WebhookForm } from "@/app/components/workspace/webhook-forms";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";
import { boardsForWebhooks } from "../data";

// /<slug>/settings/webhooks/<id>: one webhook, its secret, a test, and its deliveries with
// what was sent and what came back. Looked up by { workspaceId, id }.

type Params = Promise<{ workspace: string; id: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug, id } = await params;
  const { workspace } = await requireOrgPermission(slug, "integrations.manage");
  const hook = await prisma.webhook.findUnique({ where: { workspaceId_id: { workspaceId: workspace.id, id } }, select: { name: true } });
  return { title: `${hook?.name ?? "Webhook"} · ${workspace.name}` };
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

export default async function WebhookPage({ params }: { params: Params }) {
  const { workspace: slug, id } = await params;
  const { user, workspace } = await requireOrgPermission(slug, "integrations.manage");
  const hook = await prisma.webhook.findUnique({
    where: { workspaceId_id: { workspaceId: workspace.id, id } },
    select: {
      id: true,
      name: true,
      url: true,
      format: true,
      boardId: true,
      events: true,
      active: true,
      disabledAt: true,
      consecutiveFailures: true,
    },
  });
  if (!hook) notFound();
  const [{ intl, m }, boards, deliveries] = await Promise.all([
    getI18n(),
    boardsForWebhooks(workspace.id, user.id),
    recentDeliveries(workspace.id, hook.id, 30),
  ]);
  const t = m.webhooks.form;
  const base = `/${workspace.slug}/settings/webhooks`;

  return (
    <SettingsPage wide>
      <Link href={base} className="text-sm font-semibold text-ink-muted hover:text-ink">
        ‹ {t.back}
      </Link>
      <PageHeader
        address={`${base}/${hook.id}`}
        title={hook.name}
        description={hook.disabledAt ? m.webhooks.page.disabled : hook.active ? m.webhooks.page.active : m.webhooks.page.paused}
        action={
          <div className="flex flex-wrap items-start gap-2">
            <PingForm workspaceId={workspace.id} webhookId={hook.id} />
            <form action={setWebhookActiveAction}>
              <input type="hidden" name="workspaceId" value={workspace.id} />
              <input type="hidden" name="webhookId" value={hook.id} />
              <input type="hidden" name="active" value={String(!hook.active || Boolean(hook.disabledAt))} />
              <Button type="submit" variant="outline" className="h-10">
                {!hook.active || hook.disabledAt ? t.resume : t.pause}
              </Button>
            </form>
          </div>
        }
      />

      <SettingsCard>
        <WebhookForm workspaceId={workspace.id} slug={workspace.slug} boards={boards} webhook={hook} />
      </SettingsCard>

      <SettingsCard title={t.secretTitle}>
        <RotateSecretForm workspaceId={workspace.id} webhookId={hook.id} />
      </SettingsCard>

      <SettingsCard title={t.deliveries}>
        {deliveries.length === 0 ? (
          <p className="text-sm text-ink-muted">{m.webhooks.page.noDeliveries}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {deliveries.map((d) => (
              <li key={d.id}>
                <details className="rounded-xl border border-border">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-3 py-2 text-sm">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        d.status === "SUCCESS" ? "bg-success/12 text-success" : d.status === "FAILED" ? "bg-danger/10 text-danger" : "bg-surface-2 text-ink-muted"
                      }`}
                    >
                      {m.webhooks.status[d.status]}
                    </span>
                    <span className="font-mono text-xs">{d.event}</span>
                    <span className="text-xs text-ink-muted">{plural(intl, t.attempts, d.attempts)}</span>
                    {d.status === "PENDING" && d.nextAttemptAt && (
                      <span className="text-xs text-ink-muted">{fmt(t.nextTry, { date: formatDateTime(d.nextAttemptAt, intl) })}</span>
                    )}
                    <span className="ml-auto font-mono text-[11px] text-ink-muted">
                      {d.responseStatus ? `HTTP ${d.responseStatus} · ` : ""}
                      {formatDateTime(d.createdAt, intl)}
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-border p-3 lg:grid-cols-2">
                    <div className="min-w-0">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.request}</p>
                      <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px]">{pretty(d.body)}</pre>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{t.response}</p>
                      <pre className="max-h-72 overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-[11px]">
                        {d.error ? `${d.error}\n\n` : ""}
                        {d.responseBody ?? ""}
                      </pre>
                      <form action={redeliverAction} className="mt-2">
                        <input type="hidden" name="workspaceId" value={workspace.id} />
                        <input type="hidden" name="deliveryId" value={d.id} />
                        <Button type="submit" variant="outline" className="h-8 px-3">
                          {t.redeliver}
                        </Button>
                      </form>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard tone="danger" title={t.delete} description={t.deleteText}>
        <form action={deleteWebhookAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="webhookId" value={hook.id} />
          <Button type="submit" variant="dangerSolid">
            {t.delete}
          </Button>
        </form>
      </SettingsCard>
    </SettingsPage>
  );
}
