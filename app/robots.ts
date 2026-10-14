import type { MetadataRoute } from "next";
import { isRegistrationOpen } from "@/app/lib/services/instance";

// Una instancia privada (registro cerrado) no tiene nada que indexar: se pide a los
// buscadores que no entren. Con el registro abierto se permiten solo las páginas públicas
// (login, registro y legales); los tableros exigen sesión de todas formas.
export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  if (!(await isRegistrationOpen())) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: {
      userAgent: "*",
      allow: ["/login", "/register", "/legal/"],
      disallow: "/",
    },
  };
}
