import { redirect } from "next/navigation";
import { isSetupComplete, verifySession } from "@/app/lib/dal";

// Depende del estado de la base de datos y de la sesión: nunca debe prerenderizarse
// en build (además, en el build de Docker la DB no existe).
export const dynamic = "force-dynamic";

// Punto de entrada: decide a dónde mandar al visitante según el estado de la
// instancia y la sesión.
export default async function Home() {
  if (!(await isSetupComplete())) redirect("/setup");
  if (!(await verifySession())) redirect("/login");
  redirect("/boards");
}
