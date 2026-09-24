// Lógica pura del modal de tarjeta, separada del componente para poder probarla con
// Vitest en entorno node (el componente importa Server Actions y no se carga fuera de
// Next).
import { unstable_rethrow } from "next/navigation";

/**
 * Fecha y hora de un comentario. `timeZone` sin definir = zona del navegador. El
 * componente solo la llama tras hidratar: en el servidor la zona sería la del
 * contenedor (normalmente UTC) y el texto no coincidiría con el del cliente.
 */
export function formatCommentTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/**
 * Vencimiento legible. `dueDate` es una fecha de calendario guardada a medianoche
 * UTC: formatearla en otra zona la movería al día anterior al oeste de Greenwich.
 */
export function formatDueDate(iso: string): string {
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/**
 * Ejecuta una acción de tipo toggle y devuelve el mensaje de error para la interfaz
 * (o `null` si fue bien). Los errores internos de Next (redirect a /login cuando la
 * sesión caduca, notFound) se relanzan para que el router los gestione.
 */
export async function runToggle(
  action: () => Promise<{ ok: boolean }>,
  failMessage: string,
  context: string,
): Promise<string | null> {
  try {
    const result = await action();
    return result.ok ? null : failMessage;
  } catch (err) {
    unstable_rethrow(err);
    console.error(`${context} falló`, err);
    return failMessage;
  }
}
