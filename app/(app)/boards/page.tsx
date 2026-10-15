import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { getBoardSummariesForUser, getWorkspacesForUser } from "@/app/lib/queries";
import { createBoard } from "@/app/lib/actions/boards";
import { BoardGrid } from "@/app/components/workspace/board-grid";
import { CreateOrganizationForm } from "@/app/components/workspace/forms";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { ImportBoardForm } from "./import-board-form";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.boards.index.metaTitle };
}

export default async function BoardsPage() {
  const user = await requireUser();
  const [boards, workspaces, { m }] = await Promise.all([
    getBoardSummariesForUser(user.id),
    getWorkspacesForUser(user.id),
    getI18n(),
  ]);
  const t = m.boards.index;
  const tw = m.workspaces;
  const memberOf = new Set(workspaces.map((w) => w.id));
  // Boards of workspaces the user is not in: someone added them to the board itself.
  const shared = boards.filter((b) => !memberOf.has(b.workspaceId));
  const creatable = workspaces.filter((w) => !w.suspendedAt && w.canCreateBoards);

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl overflow-y-auto p-6 sm:p-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-balance">
        {t.title}
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">{t.subtitle}</p>

      <form action={createBoard} className="mt-7 flex flex-wrap gap-2">
        <Input
          name="title"
          required
          maxLength={120}
          aria-label={t.newBoardName}
          placeholder={t.newBoardName}
          className="min-w-0 flex-1 sm:max-w-xs sm:flex-none"
        />
        {creatable.length > 1 && (
          <select
            name="workspaceId"
            aria-label={tw.dashboard.createIn}
            className="h-[38px] rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            {creatable.map((w) => (
              <option key={w.id} value={w.id}>
                {w.kind === "PERSONAL" ? `${tw.kind.PERSONAL} · /${w.slug}` : `${w.name} · /${w.slug}`}
              </option>
            ))}
          </select>
        )}
        <Button type="submit">{t.createBoard}</Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-x-6">
        {/* Importing and creating an organization are rare: collapsed so they do not
            compete with "Create board". */}
        <Collapsible label={t.importToggle}>
          <ImportBoardForm />
        </Collapsible>
        <Collapsible label={tw.createOrg.toggle}>
          <CreateOrganizationForm />
        </Collapsible>
      </div>

      {boards.length === 0 && !workspaces.some((w) => w.kind === "ORGANIZATION") && (
        <div className="mt-20 flex flex-col items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-border bg-surface text-accent shadow-[0_8px_24px_-12px_oklch(0.27_0.022_52/0.25)]">
            <svg
              className="size-7"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18M9 9v11" />
            </svg>
          </div>
          <p className="mt-5 font-display text-lg font-bold tracking-tight">{t.emptyTitle}</p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-muted">{t.emptyText}</p>
        </div>
      )}

      {workspaces.map((w) => {
          const own = boards.filter((b) => b.workspaceId === w.id);
          if (w.kind === "PERSONAL" && own.length === 0) return null;
          return (
            <section key={w.id} aria-labelledby={`ws-${w.id}`} className="mt-10">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 id={`ws-${w.id}`} className="font-display text-xl font-bold tracking-tight">
                  {w.kind === "PERSONAL" ? tw.dashboard.personalTitle : w.name}
                  <span className="ml-2 font-mono text-xs font-normal text-ink-muted">/{w.slug}</span>
                </h2>
                {w.kind === "ORGANIZATION" && (
                  <Link
                    href={`/${w.slug}`}
                    className="text-sm font-semibold text-accent underline-offset-2 hover:underline"
                  >
                    {fmt(tw.dashboard.openWorkspace, { name: w.name })}
                  </Link>
                )}
              </div>
              {own.length > 0 ? (
                <BoardGrid boards={own} />
              ) : (
                <p className="text-sm text-ink-muted">{tw.dashboard.noBoards}</p>
              )}
            </section>
          );
        })}

      {shared.length > 0 && (
        <section aria-labelledby="ws-shared" className="mt-10">
          <h2 id="ws-shared" className="font-display text-xl font-bold tracking-tight">
            {tw.dashboard.sharedTitle}
          </h2>
          <p className="mb-4 mt-1 text-sm text-ink-muted">{tw.dashboard.sharedText}</p>
          <BoardGrid boards={shared} />
        </section>
      )}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group/fold mt-0 text-sm">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 py-1 text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <svg
          className="size-3.5 transition-transform group-open/fold:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        {label}
      </summary>
      <div className="mt-2 max-w-2xl rounded-xl border border-border bg-surface p-4">{children}</div>
    </details>
  );
}
