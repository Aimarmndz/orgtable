// Límites de longitud compartidos por la UI y el servidor. Módulo sin dependencias a
// propósito: los componentes de cliente importan de aquí y no de validators.ts, que
// arrastraría zod al bundle del navegador (y usa Buffer, que allí no existe).

// Límite de la descripción de una tarjeta, el mismo en la UI, la API y el import.
export const CARD_DESCRIPTION_MAX = 5000;
