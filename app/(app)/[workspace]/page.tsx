import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import {
  getBoardSummariesForUser,
  getWorkspaceForUser,
} from "@/app/lib/queries";
import { createBoard } from "@/app/lib/actions/boards";
import { BoardGrid } from "@/app/components/workspace/board-grid";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

// A workspace's page: /<slug>. Its boards (the ones the viewer can open), a form to create
// one there and, for organizations, the link to members and settings. Someone who is not a
// member and cannot open any of its boards gets a 404, like a workspace that does not exist.

type Params = Promise<{ workspace: string }>;

export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(slug, user.id);
  return { title: workspace?.name ?? slug };
}

export default async function WorkspacePage({ params }: { params: Params }) {
  const { workspace: slug } = await params;
  const user = await requireUser();
  const workspace = await getWorkspaceForUser(slug, user.id);
  if (!workspace) notFound();
  const { m } = await getI18n();
  const t = m.workspaces;
  const isOrg = workspace.kind === "ORGANIZATION";

  if (workspace.suspendedAt) {
    return (
      <div className="relative z-10 mx-auto w-full max-w-3xl p-6 sm:p-8">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {workspace.name}
        </h1>
        <div
          role="alert"
          className="mt-6 rounded-xl border border-danger/30 bg-danger/10 p-5"
        >
          <p className="font-semibold text-danger">{t.page.suspendedTitle}</p>
          <p className="mt-1 text-sm text-ink">
            {fmt(t.page.suspendedText, {
              reason: workspace.suspendedReason || t.page.noReason,
            })}
          </p>
        </div>
      </div>
    );
  }

  const boards = await getBoardSummariesForUser(user.id, workspace.id);

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-ink-muted">
            /{workspace.slug} · {t.kind[workspace.kind]}
          </p>
          <h1 className="mt-1 font-display text-3xl font-bold tracking-tight text-balance">
            {workspace.kind === "PERSONAL"
              ? t.dashboard.personalTitle
              : workspace.name}
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            {workspace.role
              ? fmt(t.page.yourRole, { role: t.roles[workspace.role] })
              : t.page.guest}
          </p>
        </div>
        {isOrg && workspace.role && (
          <Link
            href={`/${workspace.slug}/settings`}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:bg-surface-2"
          >
            {t.page.settings}
          </Link>
        )}
      </div>

      {workspace.canCreateBoards && (
        <form action={createBoard} className="mt-7 flex flex-wrap gap-2">
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <Input
            name="title"
            required
            maxLength={120}
            aria-label={m.boards.index.newBoardName}
            placeholder={m.boards.index.newBoardName}
            className="min-w-0 flex-1 sm:max-w-xs sm:flex-none"
          />
          <Button type="submit">{m.boards.index.createBoard}</Button>
        </form>
      )}

      <h2 className="mb-4 mt-10 font-display text-xl font-bold tracking-tight">
        {t.page.boardsTitle}
      </h2>
      {boards.length > 0 ? (
        <BoardGrid boards={boards} />
      ) : (
        <p className="text-sm text-ink-muted">{t.page.empty}</p>
      )}
    </div>
  );
}
