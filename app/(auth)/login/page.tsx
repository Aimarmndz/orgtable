import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { isMailEnabled } from "@/app/lib/mail/config";
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
  searchParams: Promise<{ account?: string; password?: string }>;
}) {
  // If the instance has not been set up yet, the wizard comes first.
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  const [registrationOpen, { account, password }, { m }] = await Promise.all([
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
          {/* After choosing a password from an emailed link (actions/password.ts). */}
          {(password === "reset" || password === "set") && (
            <p
              role="status"
              className="mb-6 w-full max-w-sm rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success"
            >
              {password === "reset"
                ? m.auth.login.passwordReset
                : m.auth.login.passwordSet}
            </p>
          )}
          <LoginForm />
          {isMailEnabled() && (
            <p className="mt-4 w-full max-w-sm text-sm">
              <Link
                href="/forgot-password"
                className="font-semibold text-accent underline-offset-2 hover:underline"
              >
                {m.auth.login.forgot}
              </Link>
            </p>
          )}
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
