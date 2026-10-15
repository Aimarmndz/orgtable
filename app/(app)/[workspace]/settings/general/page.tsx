import type { Metadata } from "next";
import { headers } from "next/headers";
import { requireOrgSettings } from "@/app/lib/org-settings";
import { removeMemberAction } from "@/app/lib/actions/workspaces";
import { canOwnWorkspace } from "@/app/lib/roles";
import { prisma } from "@/app/lib/prisma";
import { publicHost } from "@/app/lib/mail/config";
import {
  DeleteOrganizationForm,
  OrganizationSettingsForm,
} from "@/app/components/workspace/forms";
import { Button } from "@/app/components/ui/button";
import { PageHeader } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// General settings of an organization: /<slug>/settings/general. Name and address (owners),
// leaving, and the danger zone (owners). See DESIGN.md, "Settings and administration".

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { workspace: slug } = await params;
  const { workspace } = await requireOrgSettings(slug);
  const { m } = await getI18n();
  return { title: `${m.workspaces.nav.general} · ${workspace.name}` };
}

export default async function WorkspaceGeneralPage({
  params,
}: {
  params: Params;
}) {
  const { workspace: slug } = await params;
  const { user, workspace, role } = await requireOrgSettings(slug);
  const owner = canOwnWorkspace(role);
  const [{ m }, boards, host] = await Promise.all([
    getI18n(),
    prisma.board.count({ where: { workspaceId: workspace.id } }),
    headers().then((h) => publicHost(h.get("host"))),
  ]);
  const t = m.workspaces;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-6 sm:p-8 lg:p-10">
      <PageHeader
        address={`/${workspace.slug}/settings/general`}
        title={t.general.title}
        description={t.general.subtitle}
      />

      {owner ? (
        <OrganizationSettingsForm
          workspaceId={workspace.id}
          name={workspace.name}
          slug={workspace.slug}
          host={host}
        />
      ) : (
        <p className="rounded-2xl border border-border bg-surface p-5 text-sm text-ink-muted">
          {t.settings.ownerOnly}
        </p>
      )}

      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-6">
        <div className="min-w-0 flex-[1_1_16rem]">
          <h2 className="font-display text-lg font-bold tracking-tight">
            {t.general.leaveTitle}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">{t.members.leaveHint}</p>
        </div>
        <form action={removeMemberAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="userId" value={user.id} />
          <Button
            type="submit"
            variant="dangerOutline"
            className="min-h-10 gap-2 px-4"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="size-4"
              aria-hidden
            >
              <path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3" />
            </svg>
            {fmt(t.general.leaveButton, { name: workspace.name })}
          </Button>
        </form>
      </section>

      {owner && (
        <section
          aria-labelledby="danger-title"
          className="rounded-2xl border-[1.5px] border-danger/40 bg-danger/[0.04] p-6"
        >
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-lg bg-danger/12 text-danger"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="size-[18px]"
              >
                <path d="M12 3 2 20h20L12 3z" />
                <path d="M12 10v4M12 17v.5" />
              </svg>
            </span>
            <h2
              id="danger-title"
              className="font-display text-lg font-bold tracking-tight text-danger"
            >
              {t.general.dangerTitle}
            </h2>
          </div>
          <div className="mt-4">
            <DeleteOrganizationForm
              workspaceId={workspace.id}
              slug={workspace.slug}
              boards={boards}
            />
          </div>
        </section>
      )}
    </div>
  );
}
