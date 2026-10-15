import type { Metadata } from "next";
import { requireOrgPermission } from "@/app/lib/org-settings";
import { WEBHOOK_FORMATS, type WebhookFormat } from "@/app/lib/webhooks/events";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { WebhookForm } from "@/app/components/workspace/webhook-forms";
import { getI18n } from "@/app/i18n/server";
import { boardsForWebhooks } from "../data";

// /<slug>/settings/webhooks/new (?format=SLACK… from the chat apps page).

type Params = Promise<{ workspace: string }>;
type Search = Promise<{ format?: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgPermission(slug, "integrations.manage");
  const { m } = await getI18n();
  return { title: `${m.webhooks.page.new} · ${workspace.name}` };
}

export default async function NewWebhookPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { workspace: slug } = await params;
  const { format } = await searchParams;
  const { user, workspace } = await requireOrgPermission(slug, "integrations.manage");
  const [{ m }, boards] = await Promise.all([getI18n(), boardsForWebhooks(workspace.id, user.id)]);
  const defaultFormat = (WEBHOOK_FORMATS as readonly string[]).includes(format ?? "") ? (format as WebhookFormat) : "JSON";
  return (
    <SettingsPage>
      <PageHeader address={`/${workspace.slug}/settings/webhooks/new`} title={m.webhooks.page.new} description={m.webhooks.page.scopeNote} />
      <SettingsCard>
        <WebhookForm workspaceId={workspace.id} slug={workspace.slug} boards={boards} defaultFormat={defaultFormat} />
      </SettingsCard>
    </SettingsPage>
  );
}
