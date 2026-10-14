import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { PublicFooter } from "@/app/components/public-footer";
import { getI18n } from "@/app/i18n/server";
import { rich } from "@/app/i18n/rich";
import { BrandPanel } from "../brand-panel";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.auth.login.metaTitle };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  // If the instance has not been set up yet, the wizard comes first.
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  const [registrationOpen, { account }, { m }] = await Promise.all([
    isRegistrationOpen(),
    searchParams,
    getI18n(),
  ]);

  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          {/* After deleting the account from the settings (actions/account.ts). */}
          {account === "deleted" && (
            <p
              role="status"
              className="mb-6 w-full max-w-sm rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success"
            >
              {m.auth.login.accountDeleted}
            </p>
          )}
          <LoginForm />
          {registrationOpen && (
            <p className="mt-6 w-full max-w-sm text-sm text-ink-muted">
              {rich(m.auth.login.noAccount, {
                link: (c) => (
                  <Link
                    href="/register"
                    className="font-semibold text-accent underline-offset-2 hover:underline"
                  >
                    {c}
                  </Link>
                ),
              })}
            </p>
          )}
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
