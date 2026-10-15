import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { readPendingTwoFactor } from "@/app/lib/session";
import { PublicFooter } from "@/app/components/public-footer";
import { getI18n } from "@/app/i18n/server";
import { BrandPanel } from "../../brand-panel";
import { VerifyCodeForm } from "./verify-code-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.auth.verify.metaTitle };
}

// Second step of the sign-in for accounts with two-step verification (docs/authentication.md).
// Only reachable with the short-lived cookie the password step leaves; otherwise, back to
// the password.
export default async function VerifyPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  if (!(await readPendingTwoFactor())) redirect("/login");
  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          <VerifyCodeForm />
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
