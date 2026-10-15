import type { Metadata } from "next";
import { requireUser } from "@/app/lib/dal";
import { getApiTokensForUser } from "@/app/lib/queries";
import { revokeApiToken } from "@/app/lib/actions/tokens";
import { formatDate } from "@/app/lib/format-date";
import { sourceCodeUrl } from "@/app/lib/site";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";
import { CreateTokenForm } from "../create-token-form";

// /settings/tokens: personal access tokens for the public API.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.nav.tokens };
}

// Outside the component: reading the clock during render would break the purity rule.
function isExpired(d: Date | null): boolean {
  return d !== null && d.getTime() < Date.now();
}

export default async function TokensSettingsPage() {
  const user = await requireUser();
  const [{ intl, m }, tokens] = await Promise.all([getI18n(), getApiTokensForUser(user.id)]);
  const t = m.settings;
  return (
    <SettingsPage>
      <PageHeader
        address="/settings/tokens"
        title={t.nav.tokens}
        description={rich(t.tokens.description, {
          strong: (chunk) => <strong>{chunk}</strong>,
          link: (chunk) => (
            <a
              href={`${sourceCodeUrl()}/blob/main/docs/api/public-api.md`}
              className="text-accent underline-offset-2 hover:underline"
            >
              {chunk}
            </a>
          ),
        })}
      />
      <SettingsCard title={t.tokens.newTitle}>
        <CreateTokenForm />
      </SettingsCard>
      <SettingsCard title={t.tokens.listTitle}>
        {tokens.length === 0 ? (
          <p className="text-sm text-ink-muted">{t.tokens.empty}</p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {tokens.map((tk) => (
              <li key={tk.id} className="flex items-center gap-3 bg-surface px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{tk.name}</span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-muted">
                      {tk.scope === "read" ? t.tokens.scopeRead : t.tokens.scopeWrite}
                    </span>
                    {isExpired(tk.expiresAt) && (
                      <span className="shrink-0 rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">
                        {t.tokens.expired}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    {tk.prefix}… · {fmt(t.tokens.created, { date: formatDate(tk.createdAt, intl) })} ·{" "}
                    {tk.expiresAt
                      ? fmt(t.tokens.expires, { date: formatDate(tk.expiresAt, intl) })
                      : t.tokens.neverExpires}{" "}
                    ·{" "}
                    {tk.lastUsedAt
                      ? fmt(t.tokens.used, { date: formatDate(tk.lastUsedAt, intl) })
                      : t.tokens.neverUsed}
                  </p>
                </div>
                <form action={revokeApiToken}>
                  <input type="hidden" name="id" value={tk.id} />
                  <Button type="submit" variant="dangerOutline" className="h-8 px-3">
                    {t.tokens.revoke}
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>
    </SettingsPage>
  );
}
