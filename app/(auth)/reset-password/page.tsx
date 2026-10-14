import type { Metadata } from "next";
import Link from "next/link";
import { peekAccountToken } from "@/app/lib/services/account-tokens";
import { PublicFooter } from "@/app/components/public-footer";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import { BrandPanel } from "../brand-panel";
import { ResetPasswordForm } from "./reset-password-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  // The token is in the URL: never in an index, never sent to other sites.
  return { title: m.auth.reset.metaTitle, robots: { index: false, follow: false } };
}

// Sets a new password from an emailed link: "forgot your password" or the invitation of an
// employee's account. An invalid or used link says so and offers a new one (docs/email.md).
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = ((await searchParams).token ?? "").slice(0, 200);
  const [link, { m }] = await Promise.all([peekAccountToken(token), getI18n()]);
  const t = m.auth.reset;
  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          {link ? (
            <ResetPasswordForm
              token={token}
              title={link.purpose === "INVITE" ? t.titleInvite : t.title}
              subtitle={fmt(t.for, { email: link.email })}
            />
          ) : (
            <div className="w-full max-w-sm">
              <h1 className="font-display text-3xl font-bold tracking-tight">{t.title}</h1>
              <p role="alert" className="mt-4 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
                {t.invalid}
              </p>
              <Link
                href="/forgot-password"
                className="mt-6 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-ink transition hover:bg-accent-hover"
              >
                {t.requestNew}
              </Link>
            </div>
          )}
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
