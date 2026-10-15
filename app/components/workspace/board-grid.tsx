import Link from "next/link";
import { initials } from "@/app/lib/initials";
import { boardBackgroundFor } from "@/app/lib/colors";
import { boardPath } from "@/app/lib/slugs";
import type { BoardSummary } from "@/app/lib/queries";
import { DeleteBoardButton } from "@/app/(app)/boards/delete-board-button";
import { getI18n } from "@/app/i18n/server";
import { fmt, plural } from "@/app/i18n/format";

// Grid of board tiles, shared by /boards and each workspace's page. Each tile links to
// /<workspace>/<board>; export and delete appear in a corner (delete only for whoever may
// manage the board).

// Corner actions of each board. On desktop they appear on hover or when reached with
// the keyboard; on screens without hover (touch) they are always visible, otherwise
// there would be no way to discover them.
const CORNER_ACTION =
  "grid size-7 place-items-center rounded-md bg-black/20 text-white/90 opacity-0 transition hover:bg-black/40 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100";

export async function BoardGrid({ boards }: { boards: BoardSummary[] }) {
  const { m, intl } = await getI18n();
  const t = m.boards.index;
  return (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
          {boards.map((board) => (
            <li key={board.id} className="group relative">
              <Link
                href={boardPath(board.workspaceSlug, board.slug)}
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
                {/* Only who may manage it (deleteBoard checks it again). */}
{board.canDelete && (
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
  );
}
