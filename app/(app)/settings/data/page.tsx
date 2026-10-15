import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { prisma } from "@/app/lib/prisma";
import {
  APP_VERSION,
  AUTHOR_NAME,
  AUTHOR_URL,
  LICENSE_NAME,
  LICENSE_URL,
  sourceCodeUrl,
} from "@/app/lib/site";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { getI18n } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";
import { DeleteAccountForm } from "../account-forms";

// /settings/data: the GDPR rights without writing to anyone (download, erase), and what
// this software is (version, source, licence).

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.nav.data };
}

const LINK = "text-accent underline-offset-2 hover:underline";

export default async function DataSettingsPage() {
  const user = await requireUser();
  const [{ intl, m }, ownedBoards] = await Promise.all([
    getI18n(),
    prisma.board.count({ where: { ownerId: user.id } }),
  ]);
  const t = m.settings;
  return (
    <SettingsPage>
      <PageHeader
        address="/settings/data"
        title={t.nav.data}
        description={rich(t.data.description, {
          link: (chunk) => (
            <Link href="/legal/privacy" className={LINK}>
              {chunk}
            </Link>
          ),
        })}
      />
      <SettingsCard
        title={t.data.export.title}
        description={t.data.export.description}
        aside={
          // A plain link (no fetch): the browser downloads the file with its name.
          <a
            href="/api/account/export"
            download
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-ink/20 bg-surface px-4 text-sm font-semibold shadow-sm transition hover:bg-surface-2 active:translate-y-px"
          >
            {t.data.export.button}
          </a>
        }
      />
      <SettingsCard
        tone="danger"
        title={t.data.delete.title}
        description={
          ownedBoards === 0
            ? t.data.delete.descriptionNoBoards
            : plural(intl, t.data.delete.descriptionWithBoards, ownedBoards)
        }
      >
        <DeleteAccountForm />
      </SettingsCard>
      <section aria-label={t.sections.about} className="space-y-1 px-1 text-sm text-ink-muted">
        <p>
          {rich(
            t.about.line,
            {
              version: (chunk) => <span className="font-mono">{chunk}</span>,
              source: (chunk) => (
                <a href={sourceCodeUrl()} className={LINK}>
                  {chunk}
                </a>
              ),
              license: (chunk) => (
                <a href={LICENSE_URL} className={LINK}>
                  {chunk}
                </a>
              ),
            },
            { version: APP_VERSION, license: LICENSE_NAME },
          )}
        </p>
        {/* Attribution required by LICENSE (section 7(b) terms): derivatives must keep it. */}
        <p>
          {rich(
            m.legal.footer.createdBy,
            {
              link: (chunk) => (
                <a href={AUTHOR_URL} className={LINK}>
                  {chunk}
                </a>
              ),
            },
            { author: AUTHOR_NAME },
          )}
        </p>
      </section>
    </SettingsPage>
  );
}
