import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { getBoardSummariesForUser } from "@/app/lib/queries";
import { initials } from "@/app/lib/initials";
import { createBoard } from "@/app/lib/actions/boards";
import { boardBackgroundFor } from "@/app/lib/colors";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { ImportBoardForm } from "./import-board-form";
import { DeleteBoardButton } from "./delete-board-button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.boards.index.metaTitle };
}

// Corner actions of each board. On desktop they appear on hover or when reached with
// the keyboard; on screens without hover (touch) they are always visible, otherwise
// there would be no way to discover them.
const CORNER_ACTION =
  "grid size-7 place-items-center rounded-md bg-black/20 text-white/90 opacity-0 transition hover:bg-black/40 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

export default async function BoardsPage() {
  const user = await requireUser();
  const boards = await getBoardSummariesForUser(user.id);
  const { m, intl } = await getI18n();
  const t = m.boards.index;

  return (
    <div className="relative z-10 mx-auto w-full max-w-6xl overflow-y-auto p-6 sm:p-8">
      <h1 className="font-display text-3xl font-bold tracking-tight text-balance">
        {t.title}
      </h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        {t.subtitle}
      </p>

      <form action={createBoard} className="mt-7 flex flex-wrap gap-2">
        <Input
          name="title"
          required
          maxLength={120}
          aria-label={t.newBoardName}
          placeholder={t.newBoardName}
          className="min-w-0 flex-1 sm:max-w-xs sm:flex-none"
        />
        <Button type="submit">{t.createBoard}</Button>
      </form>

      {/* Importing is rare: collapsed so it does not compete with "Create board". */}
      <details className="group/import mt-3 text-sm">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-1 py-1 text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
          <svg
            className="size-3.5 transition-transform group-open/import:rotate-90"
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
          {t.importToggle}
        </summary>
        <div className="mt-2 rounded-xl border border-border bg-surface p-3">
          <ImportBoardForm />
        </div>
      </details>

      {boards.length === 0 ? (
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
          <p className="mt-5 font-display text-lg font-bold tracking-tight">
            {t.emptyTitle}
          </p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-muted">
            {t.emptyText}
          </p>
        </div>
      ) : (
        <ul className="mt-8 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {boards.map((board) => (
            <li key={board.id} className="group relative">
              <Link
                href={`/board/${board.id}`}
                style={{ background: boardBackgroundFor(board) }}
                className="relative flex h-36 flex-col justify-end overflow-hidden rounded-2xl p-4 text-white shadow-[0_4px_16px_-8px_oklch(0.27_0.022_52/0.3)] ring-1 ring-inset ring-black/10 transition-transform duration-150 ease-out hover:-translate-y-0.5"
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/5"
                />
                <span className="relative font-display text-lg font-bold leading-tight tracking-tight drop-shadow-sm">
                  {board.title}
                </span>
                <span className="relative mt-2 flex items-center justify-between gap-2 text-xs font-medium text-white/85">
                  <span>
                    {plural(intl, t.cardCount, board.cardCount)}
                  </span>
                  {/* Only when shared: on a personal board your own face is redundant. */}
                  {board.members.length > 1 && (
                    <span className="flex -space-x-1.5">
                      {/* aria-label does not work on a span without a role: the name goes as hidden text. */}
                      <span className="sr-only">
                        {plural(intl, t.sharedWith, board.members.length, {
                          names: new Intl.ListFormat(intl, {
                            type: "conjunction",
                          }).format(board.members.map((member) => member.name)),
                        })}
                      </span>
                      {board.members.slice(0, 4).map((member) => (
                        <span
                          key={member.id}
                          aria-hidden
                          className="grid size-6 place-items-center rounded-full bg-white/90 text-[10px] font-bold text-ink ring-2 ring-black/10"
                        >
                          {initials(member.name)}
                        </span>
                      ))}
                      {board.members.length > 4 && (
                        <span
                          aria-hidden
                          className="grid size-6 place-items-center rounded-full bg-black/30 text-[10px] font-bold text-white ring-2 ring-black/10"
                        >
                          +{board.members.length - 4}
                        </span>
                      )}
                    </span>
                  )}
                </span>
              </Link>
              <div className="absolute right-2 top-2 flex gap-1">
                <a
                  href={`/api/boards/${board.id}/export`}
                  className={CORNER_ACTION}
                  aria-label={fmt(t.exportBoard, { title: board.title })}
                  title={t.exportTitle}
                >
                  <svg
                    className="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                  </svg>
                </a>
                {/* Only the owner can delete it (deleteBoard requires it); members
                    are not shown a button that does nothing. */}
                {board.ownerId === user.id && (
                  <DeleteBoardButton
                    boardId={board.id}
                    title={board.title}
                    className={`${CORNER_ACTION} text-sm`}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
