import type { Metadata } from "next";
import Link from "next/link";
import { getLegalInfo } from "@/app/lib/services/instance";
import { LICENSE_NAME, sourceCodeUrl } from "@/app/lib/site";
import { LegalHeading, MissingLegalInfoNotice, NotProvided } from "../legal-data";

export const metadata: Metadata = {
  title: "Condiciones de uso",
  description: "Condiciones para usar esta instancia de orgtable.",
};

export default async function TermsPage() {
  const info = await getLegalInfo();
  const operator = info?.operatorName ?? <NotProvided />;

  return (
    <>
      <LegalHeading title="Condiciones de uso" info={info} />
      <MissingLegalInfoNotice info={info} />

      <h2>Quién presta el servicio</h2>
      <p>
        Esta instancia de orgtable la opera {operator}. orgtable es un software de código
        abierto ({LICENSE_NAME}); su autor no presta este servicio ni responde de él, salvo
        que sea también quien opera la instancia.
      </p>

      <h2>El servicio</h2>
      <p>
        Tableros Kanban para organizar trabajo, solo o en equipo. Crear una cuenta y usarla es
        gratis. Al registrarte aceptas estas condiciones y declaras haber leído la{" "}
        <Link href="/legal/privacidad">política de privacidad</Link>.
      </p>

      <h2>Tu cuenta</h2>
      <ul>
        <li>Para registrarte necesitas tener al menos 14 años.</li>
        <li>
          Eres responsable de lo que se haga con tu cuenta. Usa una contraseña que no uses en
          otro sitio y cierra las sesiones que no reconozcas desde los ajustes.
        </li>
        <li>Puedes borrar tu cuenta cuando quieras desde los ajustes.</li>
      </ul>

      <h2>Tu contenido</h2>
      <p>
        Lo que escribes y subes sigue siendo tuyo. Solo lo guardamos y lo mostramos a las
        personas con las que compartes cada tablero, para que el servicio funcione.
      </p>
      <p>No está permitido usar el servicio para:</p>
      <ul>
        <li>Publicar contenido ilegal o que vulnere derechos de terceros.</li>
        <li>Subir malware o archivos para distribuirlos fuera del servicio.</li>
        <li>Enviar spam o acosar a otras personas.</li>
        <li>
          Intentar acceder a cuentas o tableros ajenos, o sobrecargar el servicio a propósito.
        </li>
      </ul>
      <p>
        Si se incumplen estas normas, el responsable puede retirar el contenido o suspender la
        cuenta. Cuando sea posible, te avisará antes y te explicará el motivo.
      </p>

      <h2>Disponibilidad y garantías</h2>
      <p>
        El servicio se ofrece gratis y «tal cual», sin garantía de disponibilidad continua ni
        de que no haya errores. Haz copias de lo importante: puedes exportar cada tablero y
        todos tus datos desde la aplicación. Nada de lo anterior limita los derechos que te
        reconoce la ley como persona usuaria.
      </p>

      <h2>Cambios y fin del servicio</h2>
      <p>
        Si las condiciones cambian de forma importante, o si el servicio va a cerrar, se
        avisará con antelación razonable para que puedas exportar tus datos.
      </p>

      <h2>El software</h2>
      <p>
        orgtable se distribuye bajo la licencia {LICENSE_NAME}. Puedes consultar, descargar y
        modificar el código de esta instancia en su{" "}
        <a href={sourceCodeUrl()}>repositorio</a>, y alojar tu propia instancia.
      </p>

      <h2>Contacto</h2>
      <p>
        Para cualquier duda sobre estas condiciones:{" "}
        {info?.operatorEmail ? (
          <a href={`mailto:${info.operatorEmail}`}>{info.operatorEmail}</a>
        ) : (
          <NotProvided />
        )}
        .
      </p>
    </>
  );
}
