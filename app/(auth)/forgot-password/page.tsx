import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { PublicFooter } from "@/app/components/public-footer";
import { getI18n } from "@/app/i18n/server";
import { BrandPanel } from "../brand-panel";
import { ForgotPasswordForm } from "./forgot-password-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.auth.forgot.metaTitle };
}

// "Forgot your password?": asks for the email and sends a single-use link (docs/email.md).
export default async function ForgotPasswordPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />
      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          <ForgotPasswordForm />
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
