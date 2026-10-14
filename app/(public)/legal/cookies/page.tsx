import type { Metadata } from "next";
import { getLegalInfo } from "@/app/lib/services/instance";
import { SESSION_MAX_AGE_DAYS } from "@/app/lib/session";
import { LegalHeading } from "../legal-data";

export const metadata: Metadata = {
  title: "Política de cookies",
  description: "Qué guarda esta instancia de orgtable en tu navegador.",
};

// Solo hay almacenamiento técnico imprescindible (art. 22.2 LSSI): por eso no hay banner de
// consentimiento. Si algún día se añade analítica, hará falta uno ANTES de cargarla.
export default async function CookiesPage() {
  const info = await getLegalInfo();
  return (
    <>
      <LegalHeading title="Política de cookies" info={info} />

      <p>
        orgtable no usa cookies de publicidad, de analítica ni de terceros. Solo guarda en tu
        navegador lo imprescindible para funcionar, que no necesita tu consentimiento (art.
        22.2 de la LSSI). Por eso no verás un aviso de cookies.
      </p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Tipo</th>
              <th scope="col">Para qué</th>
              <th scope="col">Duración</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>session</code>
              </td>
              <td>Cookie propia, HttpOnly</td>
              <td>Mantener tu sesión iniciada</td>
              <td>
                {SESSION_MAX_AGE_DAYS} días, o hasta que cierres sesión
              </td>
            </tr>
            <tr>
              <td>
                <code>theme</code>
              </td>
              <td>Almacenamiento local del navegador</td>
              <td>Recordar si prefieres el tema claro u oscuro</td>
              <td>Hasta que lo borres desde tu navegador</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p>
        Puedes borrar las dos desde la configuración de tu navegador. Sin la cookie de sesión
        no podrás usar la aplicación con tu cuenta.
      </p>
    </>
  );
}
