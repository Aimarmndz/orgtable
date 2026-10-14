import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { searchForUser, type SearchResults } from "@/app/lib/queries";
import { boardBackgroundFor } from "@/app/lib/colors";
import { SearchBox } from "@/app/components/search-box";
import { firstParam } from "@/app/lib/search-params";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";

export const dynamic = "force-dynamic";

const MIN_QUERY_LENGTH = 2;

// The query is NOT part of the title: it would end up in the history and in tabs.
export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.search.meta.title };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const user = await requireUser();
  const { m } = await getI18n();
  const t = m.search;
  const query = (firstParam((await searchParams).q) ?? "").trim();

  const results: SearchResults =
    query.length >= MIN_QUERY_LENGTH
      ? await searchForUser(user.id, query)
      : { boards: [], cards: [] };
  const total = results.boards.length + results.cards.length;

  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl overflow-y-auto p-6 sm:p-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">{t.title}</h1>

      {/* On mobile the top bar's box is hidden; there is always a big one here. */}
      <div className="mt-5">
        <SearchBox defaultValue={query} autoFocus size="lg" />
      </div>

      {query.length < MIN_QUERY_LENGTH ? (
        <p className="mt-8 text-sm text-ink-muted">
          {fmt(t.tooShort, { min: MIN_QUERY_LENGTH })}
        </p>
      ) : total === 0 ? (
        <div className="mt-16 flex flex-col items-center text-center">
          <div className="grid size-14 place-items-center rounded-2xl border border-border bg-surface text-ink-muted">
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
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          </div>
          <p className="mt-5 font-display text-lg font-bold tracking-tight">
            {fmt(t.noResults, { query })}
          </p>
          <p className="mt-1.5 max-w-xs text-sm text-ink-muted">{t.noResultsHint}</p>
        </div>
      ) : (
        <div className="mt-8 space-y-10">
          {results.boards.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {fmt(t.boards, { count: results.boards.length })}
              </h2>
              <ul className="mt-3 space-y-1.5">
                {results.boards.map((b) => (
                  <li key={b.id}>
                    <Link
                      href={`/board/${b.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 transition-colors hover:border-accent/40"
                    >
                      <span
                        aria-hidden
                        className="size-8 shrink-0 rounded-lg ring-1 ring-inset ring-black/10"
                        style={{ background: boardBackgroundFor(b) }}
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {b.title}
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        {t.boardBadge}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.cards.length > 0 && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {fmt(t.cards, { count: results.cards.length })}
              </h2>
              <ul className="mt-3 space-y-1.5">
                {results.cards.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/board/${c.boardId}?card=${c.id}`}
                      className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3.5 py-3 transition-colors hover:border-accent/40"
                    >
                      <span
                        aria-hidden
                        className="h-8 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: boardBackgroundFor({
                            id: c.boardId,
                            background: c.boardBackground,
                          }),
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {c.title}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">
                          {c.boardTitle} · {c.listTitle}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
