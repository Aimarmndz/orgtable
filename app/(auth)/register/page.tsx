import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";
import { getLegalInfo, isRegistrationOpen } from "@/app/lib/services/instance";
import { PublicFooter } from "@/app/components/public-footer";
import { BrandPanel } from "../brand-panel";
import { RegisterForm } from "./register-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea gratis tu cuenta de orgtable.",
};

export default async function RegisterPage() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (await verifySession()) redirect("/boards");
  const [open, info] = await Promise.all([isRegistrationOpen(), getLegalInfo()]);

  return (
    <main className="grid min-h-[100dvh] flex-1 lg:grid-cols-[1.1fr_1fr]">
      <BrandPanel />

      <div className="flex flex-col p-6 sm:p-10">
        <div className="flex flex-1 flex-col items-center justify-center">
          {open && info?.operatorName ? (
            <RegisterForm operatorName={info.operatorName} />
          ) : (
            <div className="w-full max-w-sm">
              <h1 className="font-display text-3xl font-bold tracking-tight">
                El registro está cerrado
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                En esta instancia las cuentas las crea quien la administra. Si necesitas
                una, pídesela a esa persona.
              </p>
              <Link
                href="/login"
                className="mt-6 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition hover:bg-accent-hover"
              >
                Ir a iniciar sesión
              </Link>
            </div>
          )}
        </div>
        <PublicFooter className="mt-10" />
      </div>
    </main>
  );
}
