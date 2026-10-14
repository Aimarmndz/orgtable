import { setLocale } from "@/app/lib/actions/locale";
import { allLanguages } from "@/app/i18n/config";
import { getI18n } from "@/app/i18n/server";

// Language picker without JavaScript: a form with one submit button per language. The
// current one is marked with aria-current. New languages appear here automatically once
// they are registered in locales/index.ts.
export async function LanguagePicker({ variant = "inline" }: { variant?: "inline" | "cards" }) {
  const { locale, m } = await getI18n();
  const languages = allLanguages();

  if (variant === "cards") {
    return (
      <form action={setLocale} className="grid gap-3 sm:grid-cols-3">
        {languages.map((l) => {
          const current = l.code === locale;
          return (
            <button
              key={l.code}
              type="submit"
              name="locale"
              value={l.code}
              aria-current={current ? "true" : undefined}
              lang={l.code}
              className={`flex items-center justify-between rounded-xl border p-3.5 text-left text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                current
                  ? "border-accent bg-accent/5"
                  : "border-border bg-surface hover:bg-surface-2"
              }`}
            >
              {l.name}
              {current && (
                <svg className="size-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12l5 5L20 7" />
                </svg>
              )}
            </button>
          );
        })}
      </form>
    );
  }

  return (
    <form action={setLocale} aria-label={m.common.language.switchTo} className="inline-flex items-center gap-1">
      {languages.map((l, i) => (
        <span key={l.code} className="inline-flex items-center gap-1">
          {i > 0 && <span aria-hidden="true">·</span>}
          <button
            type="submit"
            name="locale"
            value={l.code}
            lang={l.code}
            aria-current={l.code === locale ? "true" : undefined}
            className="rounded-sm underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[current=true]:font-semibold aria-[current=true]:text-ink"
          >
            {l.name}
          </button>
        </span>
      ))}
    </form>
  );
}
