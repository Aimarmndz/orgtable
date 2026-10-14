import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { getLegalInfo, isRegistrationOpen } from "@/app/lib/services/instance";
import { PublicFooter } from "@/app/components/public-footer";
import { getI18n } from "@/app/i18n/server";
import { BrandPanel } from "../brand-panel";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.auth.register.metaTitle, description: m.auth.register.metaDescription };
}

export default async function RegisterPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  const [open, info, { m }] = await Promise.all([
    isRegistrationOpen(),
    getLegalInfo(),
    getI18n(),
  ]);
  const t = m.auth.register;

  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          {open && info?.operatorName ? (
            <RegisterForm operatorName={info.operatorName} />
          ) : (
            <div className="w-full max-w-sm">
              <h1 className="font-display text-3xl font-bold tracking-tight">
                {t.closedTitle}
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                {t.closedBody}
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover"
              >
                {t.closedCta}
              </Link>
            </div>
          )}
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
