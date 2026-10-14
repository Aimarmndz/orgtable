import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { isRegistrationOpen } from "@/app/lib/services/instance";
import { PublicFooter } from "@/app/components/public-footer";
import { BrandPanel } from "../brand-panel";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ cuenta?: string }>;
}) {
  // Si aún no se ha configurado la instancia, el primer paso es el wizard.
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  const [registrationOpen, { cuenta }] = await Promise.all([
    isRegistrationOpen(),
    searchParams,
  ]);

  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          {/* Tras borrar la cuenta desde los ajustes (actions/account.ts). */}
          {cuenta === "borrada" && (
            <p
              role="status"
              className="mb-6 w-full max-w-sm rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success"
            >
              Tu cuenta y tus datos se han borrado.
            </p>
          )}
          <LoginForm />
          {registrationOpen && (
            <p className="mt-6 w-full max-w-sm text-sm text-ink-muted">
              ¿No tienes cuenta?{" "}
              <Link
                href="/register"
                className="font-semibold text-accent underline-offset-2 hover:underline"
              >
                Crea una gratis
              </Link>
            </p>
          )}
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
