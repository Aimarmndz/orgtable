import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { isSetupComplete } from "@/app/lib/dal";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Configuración inicial" };

export default async function SetupPage() {
  // Si ya se completó el setup, el wizard queda bloqueado para siempre.
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SetupForm />
    </main>
  );
}
