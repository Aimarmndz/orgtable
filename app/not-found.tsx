import Link from "next/link";
import { getI18n } from "@/app/i18n/server";

// Shared 404: a missing page, and also a board or workspace the visitor cannot open (the
// same answer on purpose, so URLs do not reveal what exists). In the visitor's language.
export default async function NotFound() {
  const { m } = await getI18n();
  const t = m.common.notFound;
  return (
    <main className="relative z-10 flex min-h-[60dvh] flex-1 flex-col items-center justify-center p-6 text-center">
      <p className="font-mono text-sm text-ink-muted">404</p>
      <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">{t.title}</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-muted">{t.body}</p>
      <Link
        href="/boards"
        className="mt-6 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover"
      >
        {t.cta}
      </Link>
    </main>
  );
}
