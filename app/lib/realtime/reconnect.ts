// Resincronización al reconectar un EventSource (tablero y campana de notificaciones).
//
// El servidor no reenvía los eventos perdidos (no hay Last-Event-ID ni historial): lo
// que cambió mientras la conexión estaba caída (suspensión del portátil, reinicio del
// servidor, corte de red) no llega nunca. Por eso, cada vez que el EventSource vuelve a
// abrirse DESPUÉS de la primera vez, se pide un refresh para traer el estado actual.
// En la primera apertura no hace falta: la página acaba de renderizarse con datos frescos.

/** Devuelve el manejador de "open": ignora la primera apertura y avisa en las siguientes. */
export function createReconnectRefresher(onReconnect: () => void): () => void {
  let opened = false;
  return () => {
    if (opened) onReconnect();
    opened = true;
  };
}
