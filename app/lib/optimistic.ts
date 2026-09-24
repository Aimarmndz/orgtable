// Persistencia de cambios optimistas del cliente (arrastre en tablero y calendario).
// Módulo sin React para poder testearlo directamente (test/optimistic.test.ts).
import { unstable_rethrow } from "next/navigation";

/**
 * Ejecuta la Server Action de un cambio que la UI ya ha aplicado y llama a `onFailure`
 * si el servidor lo rechaza (`{ ok: false }`) o la llamada falla (red, excepción), para
 * que la UI deshaga el cambio o avise. Antes se hacía `void accion(...)`: el resultado
 * se ignoraba y la UI se quedaba con un estado que no existía en la base de datos.
 *
 * Las redirecciones y `notFound()` de Next (p. ej. sesión caducada → /login) se
 * relanzan sin tocar: el router de Next las recoge como rechazo no gestionado y navega.
 */
export async function persistOptimistic(
  action: () => Promise<{ ok: boolean }>,
  onFailure: () => void,
  log: { message: string; context: Record<string, string> },
): Promise<void> {
  let result: { ok: boolean };
  try {
    result = await action();
  } catch (error: unknown) {
    unstable_rethrow(error);
    console.error(log.message, { ...log.context, error });
    onFailure();
    return;
  }
  if (!result.ok) onFailure();
}
