import type { Metadata } from "next";
import Link from "next/link";
import { getLegalInfo } from "@/app/lib/services/instance";
import {
  auditRetentionDays,
  ENDED_SESSION_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
} from "@/app/lib/services/maintenance";
import { SESSION_MAX_AGE_DAYS } from "@/app/lib/session";
import { parseTrustedProxyHops } from "@/app/lib/client-ip";
import {
  LegalHeading,
  MissingLegalInfoNotice,
  NotProvided,
  OperatorCard,
} from "../legal-data";

export const metadata: Metadata = {
  title: "Política de privacidad",
  description: "Qué datos guarda esta instancia de orgtable, para qué y cuánto tiempo.",
};

// Los plazos salen de las mismas constantes que usa la limpieza (services/maintenance.ts)
// y la duración de la sesión de session.ts: si cambian en el código, cambia el texto.
export default async function PrivacyPage() {
  const info = await getLegalInfo();
  const auditDays = auditRetentionDays();
  // Sin proxies de confianza la app no conoce la IP real y no la guarda (client-ip.ts).
  const storesIp = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS) > 0;

  return (
    <>
      <LegalHeading title="Política de privacidad" info={info} />
      <MissingLegalInfoNotice info={info} />

      <h2>En resumen</h2>
      <p>
        Esta instancia guarda lo necesario para que tengas una cuenta y tus tableros
        funcionen. No hay anuncios, ni analíticas, ni cookies de seguimiento: solo una cookie
        de sesión. Puedes descargar o borrar tus datos tú mismo desde{" "}
        <Link href="/settings#datos">Ajustes › Privacidad y datos</Link>.
      </p>

      <h2>Responsable del tratamiento</h2>
      <p>
        El responsable es quien opera esta instancia, no el autor del software. orgtable es
        código abierto y cualquiera puede alojar el suyo: cada instancia tiene su propio
        responsable.
      </p>
      <OperatorCard info={info} />

      <h2>Qué datos se guardan y para qué</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Dato</th>
              <th scope="col">Para qué</th>
              <th scope="col">Base legal</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Nombre, email y la contraseña cifrada con bcrypt (nunca en claro)</td>
              <td>Tu cuenta: entrar y que te reconozcan en los tableros compartidos</td>
              <td>Ejecución del servicio que pides (art. 6.1.b RGPD)</td>
            </tr>
            <tr>
              <td>Fecha en la que aceptaste esta política y las condiciones</td>
              <td>Poder demostrar que las aceptaste al registrarte</td>
              <td>Interés legítimo en poder acreditar que las aceptaste (art. 6.1.f)</td>
            </tr>
            <tr>
              <td>
                Tus tableros, listas, tarjetas, etiquetas, checklists, comentarios,
                asignaciones y adjuntos
              </td>
              <td>El servicio en sí</td>
              <td>Ejecución del servicio (art. 6.1.b)</td>
            </tr>
            <tr>
              <td>Notificaciones dentro de la app</td>
              <td>Avisarte de cambios en tus tableros y de vencimientos</td>
              <td>Ejecución del servicio (art. 6.1.b)</td>
            </tr>
            <tr>
              <td>Sesiones: navegador (user-agent), fecha de inicio y de caducidad</td>
              <td>Mantenerte con la sesión iniciada y que puedas cerrarlas a distancia</td>
              <td>Ejecución del servicio (art. 6.1.b)</td>
            </tr>
            <tr>
              <td>Tokens de API: nombre, prefijo visible y su hash (nunca el token)</td>
              <td>Que uses la API con tus propios scripts</td>
              <td>Ejecución del servicio (art. 6.1.b)</td>
            </tr>
            <tr>
              <td>
                Registro de seguridad: inicios y cierres de sesión, intentos fallidos y
                cambios de cuentas y permisos
                {storesIp ? ", con la dirección IP" : " (esta instancia no guarda la IP)"}
              </td>
              <td>Detectar accesos indebidos y abusos</td>
              <td>Interés legítimo en mantener el servicio seguro (art. 6.1.f)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        No se usan tus datos para publicidad, no se elaboran perfiles ni se toman decisiones
        automatizadas sobre ti, y no se venden ni se ceden a nadie.
      </p>

      <h2>Cuánto tiempo se guardan</h2>
      <ul>
        <li>Tu cuenta y tu contenido: hasta que los borres o borres tu cuenta.</li>
        <li>
          Una sesión dura {SESSION_MAX_AGE_DAYS} días. Las sesiones cerradas o caducadas se
          borran a los {ENDED_SESSION_RETENTION_DAYS} días.
        </li>
        <li>Las notificaciones se borran a los {NOTIFICATION_RETENTION_DAYS} días.</li>
        <li>El registro de seguridad se borra a los {auditDays} días.</li>
        <li>
          Copias de seguridad:{" "}
          {info?.backupRetentionDays != null ? (
            info.backupRetentionDays === 0 ? (
              "esta instancia no hace copias de seguridad."
            ) : (
              <>
                se guardan {info.backupRetentionDays} días. Lo que borres desaparece de
                las copias cuando caducan.
              </>
            )
          ) : (
            <NotProvided />
          )}
        </li>
      </ul>

      <h2>Quién más puede ver tus datos</h2>
      <ul>
        <li>
          <strong>Las personas con las que compartes un tablero</strong> ven tu nombre y tu
          email, y lo que escribes en ese tablero.
        </li>
        <li>
          <strong>Quien administra la instancia</strong> ve la lista de cuentas (nombre,
          email, rol) y el registro de seguridad. No ve tu contraseña.
        </li>
        <li>
          <strong>El proveedor de alojamiento</strong> guarda los datos por cuenta del
          responsable, como encargado del tratamiento:{" "}
          {info?.hostingDescription ?? <NotProvided />}.
        </li>
      </ul>
      <p>
        Si los datos se alojan fuera del Espacio Económico Europeo, el responsable tiene que
        indicarlo arriba y aplicar las garantías del capítulo V del RGPD.
      </p>

      <h2>Cookies y almacenamiento del navegador</h2>
      <p>
        Una sola cookie, <code>session</code>, imprescindible para mantener la sesión
        iniciada. Tu preferencia de tema (claro u oscuro) se guarda en el almacenamiento local
        de tu navegador y no sale de él. Detalle en la{" "}
        <Link href="/legal/cookies">política de cookies</Link>.
      </p>

      <h2>Tus derechos</h2>
      <p>Puedes ejercerlos tú mismo, sin pedir permiso a nadie:</p>
      <ul>
        <li>
          <strong>Acceso y portabilidad</strong>: descarga todos tus datos en JSON desde{" "}
          <Link href="/settings#datos">Ajustes › Privacidad y datos</Link>.
        </li>
        <li>
          <strong>Rectificación</strong>: cambia tu nombre y tu email en{" "}
          <Link href="/settings#perfil">Ajustes › Perfil</Link>.
        </li>
        <li>
          <strong>Supresión</strong>: borra tu cuenta desde{" "}
          <Link href="/settings#datos">Ajustes › Privacidad y datos</Link>. Se borran tu
          cuenta, los tableros que creaste (con sus tarjetas y adjuntos), tus comentarios y
          tus notificaciones. Los tableros de otras personas siguen, sin ti.
        </li>
        <li>
          <strong>Oposición y limitación</strong>: escribe al contacto del responsable.
        </li>
      </ul>
      <p>
        Si crees que no se han respetado tus derechos, puedes reclamar ante la autoridad de
        protección de datos. En España es la{" "}
        <a href="https://www.aepd.es">Agencia Española de Protección de Datos</a>.
      </p>

      <h2>Seguridad</h2>
      <p>
        Las contraseñas se guardan con bcrypt, las sesiones se pueden revocar al momento y
        los tokens de API se guardan como hash. Los intentos de inicio de sesión tienen un
        límite para frenar ataques de fuerza bruta.
      </p>

      <h2>Cambios en esta política</h2>
      <p>
        Si cambian los datos del responsable, la fecha de «última actualización» de arriba
        cambia con ellos. Los cambios en lo que guarda el software se publican en su{" "}
        <Link href="/settings#acerca">código fuente</Link>.
      </p>
    </>
  );
}
