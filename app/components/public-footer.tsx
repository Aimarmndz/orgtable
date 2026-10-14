import Link from "next/link";
import {
  AUTHOR_NAME,
  AUTHOR_URL,
  LICENSE_NAME,
  LICENSE_URL,
  sourceCodeUrl,
} from "@/app/lib/site";
import { getI18n } from "@/app/i18n/server";
import { rich } from "@/app/i18n/rich";
import { LanguagePicker } from "./language-picker";

// Footer of the public pages (sign-in, sign-up, setup wizard and legal pages). LICENSE
// (section 7(b) terms) requires showing "Created by Aimar" here: only the words "Created
// by" may be translated, so do not remove it in a derived version. The source code link
// fulfils section 13 of the AGPL.
export async function PublicFooter({ className = "" }: { className?: string }) {
  const { m } = await getI18n();
  const t = m.legal.footer;
  const linkClass =
    "rounded-sm underline-offset-2 transition-colors hover:text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <footer
      className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-ink-muted ${className}`}
    >
      <nav aria-label={t.navLabel} className="contents">
        <Link href="/legal/privacy" className={linkClass}>
          {t.privacy}
        </Link>
        <Link href="/legal/terms" className={linkClass}>
          {t.terms}
        </Link>
        <Link href="/legal/cookies" className={linkClass}>
          {t.cookies}
        </Link>
        <Link href="/legal/notice" className={linkClass}>
          {t.legalNotice}
        </Link>
      </nav>
      <a href={sourceCodeUrl()} className={linkClass}>
        {t.sourceCode}
      </a>
      <a href={LICENSE_URL} className={linkClass}>
        {LICENSE_NAME}
      </a>
      <span>
        {rich(
          t.createdBy,
          {
            link: (name) => (
              <a href={AUTHOR_URL} className={linkClass}>
                {name}
              </a>
            ),
          },
          { author: AUTHOR_NAME },
        )}
      </span>
      <LanguagePicker />
    </footer>
  );
}
