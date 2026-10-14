import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete } from "@/app/lib/dal";
import { PublicFooter } from "@/app/components/public-footer";
import { getI18n } from "@/app/i18n/server";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.auth.setup.metaTitle };
}

export default async function SetupPage() {
  // Once setup is complete, the wizard is locked for good.
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="flex min-h-[100dvh] flex-1 flex-col p-6">
      <div className="flex flex-1 items-center justify-center">
        <SetupForm />
      </div>
      <PublicFooter className="mt-10" />
    </main>
  );
}
