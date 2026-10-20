import type { Metadata } from "next";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { listApiKeys } from "@/app/lib/services/api-keys";
import { revokeApiKeyAction } from "@/app/lib/actions/api-keys";
import { formatDate } from "@/app/lib/format-date";
import { sourceCodeUrl } from "@/app/lib/site";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { ApiKeyForm } from "@/app/components/workspace/api-key-form";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// /<slug>/settings/api-keys: keys of the organization, not of a person ("apikeys.manage").
// See docs/api/public-api.md, "Organization keys".

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "apikeys.manage");
  const { m } = await getI18n();
  return { title: `${m.webhooks.keys.title} · ${workspace.name}` };
}

function expired(d: Date | null): boolean {
  return d !== null && d.getTime() < Date.now();
}

export default async function ApiKeysPage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "apikeys.manage");
  const [{ intl, m }, keys] = await Promise.all([getI18n(), listApiKeys(workspace.id)]);
  const t = m.webhooks.keys;
  return (
    <SettingsPage wide>
      <PageHeader
        address={`/${workspace.slug}/settings/api-keys`}
        title={t.title}
        description={fmt(t.subtitle, { name: workspace.name })}
      />
      <SettingsCard title={t.new}>
        <ApiKeyForm workspaceId={workspace.id} />
      </SettingsCard>
      <SettingsCard title={t.list}>
        {keys.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.empty}</p>
        ) : (
          <ul className="divide-y divide-border">
            {keys.map((k) => (
              <li key={k.id} data-menu-scope="row" data-menu-title={k.name} className="flex flex-wrap items-center gap-3 py-3">
                <span className="min-w-0 flex-[1_1_14rem]">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold">{k.name}</span>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                      {k.scope === "read" ? m.settings.tokens.scopeRead : m.settings.tokens.scopeFull}
                    </span>
                    {expired(k.expiresAt) && (
                      <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                        {m.settings.tokens.expired}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block font-mono text-xs text-ink-muted">
                    {k.prefix}… · {fmt(t.by, { name: k.createdBy.name })} ·{" "}
                    {k.expiresAt ? fmt(m.settings.tokens.expires, { date: formatDate(k.expiresAt, intl) }) : m.settings.tokens.neverExpires} ·{" "}
                    {k.lastUsedAt ? fmt(m.settings.tokens.used, { date: formatDate(k.lastUsedAt, intl) }) : m.settings.tokens.neverUsed}
                  </span>
                </span>
                <form action={revokeApiKeyAction}>
                  <input type="hidden" name="workspaceId" value={workspace.id} />
                  <input type="hidden" name="keyId" value={k.id} />
                  <Button type="submit" variant="dangerOutline" className="h-8 px-3">
                    {m.settings.tokens.revoke}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
      <p className="px-1 text-sm text-ink-muted">
        {fmt(t.note, { name: workspace.name })}{" "}
        <a href={`${sourceCodeUrl()}/blob/main/docs/api/public-api.md`} className="text-accent underline-offset-2 hover:underline">
          {t.docs}
        </a>
      </p>
    </SettingsPage>
  );
}
