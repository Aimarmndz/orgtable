import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { prisma } from "@/app/lib/prisma";
import { accessibleBoardsWhere } from "@/app/lib/access";
import { listIncomingHooks } from "@/app/lib/services/incoming-hooks";
import { deleteIncomingAction } from "@/app/lib/actions/webhooks";
import { publicOrigin } from "@/app/lib/webhooks/render";
import { formatDate } from "@/app/lib/format-date";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { IncomingForm, RegenerateIncomingForm } from "@/app/components/workspace/webhook-forms";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

// /<slug>/settings/integrations: chat apps (Slack, Discord, Teams: webhooks with a ready-made
// message) and incoming webhooks that create cards ("integrations.manage"). docs/webhooks.md.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "integrations.manage");
  const { m } = await getI18n();
  return { title: `${m.webhooks.integrations.title} · ${workspace.name}` };
}

const APPS = [
  { format: "SLACK", letter: "S", color: "oklch(0.48 0.09 330)" },
  { format: "DISCORD", letter: "D", color: "oklch(0.5 0.07 248)" },
  { format: "TEAMS", letter: "T", color: "oklch(0.5 0.06 200)" },
] as const;

export default async function IntegrationsPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { user, workspace } = await requireOrgPermission(slug, "integrations.manage");
  const [{ intl, m }, counts, incoming, lists, h] = await Promise.all([
    getI18n(),
    prisma.webhook.groupBy({ by: ["format"], where: { workspaceId: workspace.id }, _count: { _all: true } }),
    listIncomingHooks(workspace.id),
    prisma.list.findMany({
      where: { board: { AND: [{ workspaceId: workspace.id }, accessibleBoardsWhere(user.id)] } },
      orderBy: [{ board: { title: "asc" } }, { position: "asc" }],
      select: { id: true, title: true, board: { select: { title: true } } },
    }),
    headers(),
  ]);
  const t = m.webhooks.integrations;
  const countOf = (f: string) => counts.find((c) => c.format === f)?._count._all ?? 0;
  const origin = publicOrigin() ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`;
  const texts = { SLACK: t.slackText, DISCORD: t.discordText, TEAMS: t.teamsText };

  return (
    <SettingsPage wide>
      <PageHeader address={`/${workspace.slug}/settings/integrations`} title={t.title} description={t.subtitle} />

      <SettingsCard title={t.chats}>
        <ul className="grid gap-3 md:grid-cols-3">
          {APPS.map((app) => (
            <li key={app.format} className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                <span
                  aria-hidden
                  className="grid size-10 place-items-center rounded-xl font-display text-lg font-bold text-white"
                  style={{ background: app.color }}
                >
                  {app.letter}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold">{m.webhooks.form.formats[app.format]}</p>
                  <p className="text-xs text-ink-muted">
                    {countOf(app.format) > 0 ? plural(intl, t.connected, countOf(app.format)) : t.notConnected}
                  </p>
                </div>
              </div>
              <p className="text-sm text-ink-muted">{texts[app.format]}</p>
              <Link
                href={`/${workspace.slug}/settings/webhooks/new?format=${app.format}`}
                className="mt-auto inline-flex h-9 items-center justify-center rounded-lg border border-ink/20 bg-surface px-3 text-sm font-semibold shadow-sm hover:bg-surface-2"
              >
                {t.connect}
              </Link>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard title={t.incoming} description={t.incomingText}>
        {incoming.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.noIncoming}</p>
        ) : (
          <ul className="divide-y divide-border">
            {incoming.map((hook) => (
              <li key={hook.id} className="flex flex-wrap items-start gap-3 py-3">
                <span className="min-w-0 flex-[1_1_14rem]">
                  <span className="block font-semibold">{hook.name}</span>
                  <span className="block text-xs text-ink-muted">
                    {hook.board.title} → {hook.list.title} · {plural(intl, t.uses, hook.useCount)}
                    {hook.lastUsedAt ? ` · ${fmt(t.lastUsed, { date: formatDate(hook.lastUsedAt, intl) })}` : ""}
                  </span>
                  <span className="block font-mono text-xs text-ink-muted">…/hooks/in/{hook.prefix}••••</span>
                </span>
                <RegenerateIncomingForm workspaceId={workspace.id} hookId={hook.id} />
                <form action={deleteIncomingAction}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input type="hidden" name="hookId" value={hook.id} />
                  <Button type="submit" variant="dangerOutline" className="h-8 px-3">
                    {m.common.actions.delete}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-3 text-sm font-semibold">{t.newIncoming}</p>
          <IncomingForm
            workspaceId={workspace.id}
            lists={lists.map((l) => ({ id: l.id, label: `${l.board.title} → ${l.title}` }))}
          />
        </div>
      </SettingsCard>

      <SettingsCard title={t.howTo} description={t.howToText}>
        <pre className="overflow-x-auto rounded-xl bg-[oklch(0.22_0.02_50)] p-4 font-mono text-xs leading-relaxed text-white/90">
          {`curl -X POST ${origin}/api/hooks/in/inb_… \\
  -H 'content-type: application/json' \\
  -d '{"title":"Call Hotel Mar","labels":["lead"],"due":"2026-11-02"}'`}
        </pre>
      </SettingsCard>
    </SettingsPage>
  );
}
