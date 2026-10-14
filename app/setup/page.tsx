import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete } from "@/app/lib/dal";
import { PublicFooter } from "@/app/components/public-footer";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Configuración inicial" };

export default async function SetupPage() {
  // Si ya se completó el setup, el wizard queda bloqueado para siempre.
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
