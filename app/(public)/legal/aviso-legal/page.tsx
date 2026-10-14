import type { Metadata } from "next";
import Link from "next/link";
import { getLegalInfo } from "@/app/lib/services/instance";
import { LegalHeading, MissingLegalInfoNotice, OperatorCard } from "../legal-data";

export const metadata: Metadata = {
  title: "Aviso legal",
  description: "Datos de quien opera esta instancia de orgtable.",
};

// Información del titular del sitio (art. 10 LSSI). Los datos son los mismos que los del
// responsable de la política de privacidad: se editan en /admin/instance.
export default async function LegalNoticePage() {
  const info = await getLegalInfo();
  return (
    <>
      <LegalHeading title="Aviso legal" info={info} />
      <MissingLegalInfoNotice info={info} />

      <h2>Titular</h2>
      <OperatorCard info={info} />

      <h2>Objeto</h2>
      <p>
        Este sitio ofrece una instancia de orgtable, una aplicación de tableros Kanban. Las
        condiciones para usarla están en las{" "}
        <Link href="/legal/condiciones">condiciones de uso</Link> y el tratamiento de datos,
        en la <Link href="/legal/privacidad">política de privacidad</Link>.
      </p>

      <h2>Propiedad intelectual</h2>
      <p>
        El software orgtable es de código abierto y se distribuye con su propia licencia,
        enlazada en el pie de esta página. El contenido de los tableros pertenece a quien lo
        crea.
      </p>
    </>
  );
}
