import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Si aún no se ha configurado la instancia, el primer paso es el wizard.
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <LoginForm />
    </main>
  );
}
