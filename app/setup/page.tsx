import { redirect } from "next/navigation";
import { isSetupComplete } from "@/app/lib/dal";
import { SetupForm } from "./setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  // Si ya se completó el setup, el wizard queda bloqueado para siempre.
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SetupForm />
    </main>
  );
}
