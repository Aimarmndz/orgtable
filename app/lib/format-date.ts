import "server-only";

// Formateo de fechas EN EL SERVIDOR (Server Components). El proceso de Node corre en la
// zona del contenedor (normalmente UTC), así que sin `timeZone` explícita un evento de
// las 10:15 en Canarias se mostraba como 9:15, y cerca de medianoche cambiaba de día.
// La zona sale de ORGTABLE_TIMEZONE (IANA, p. ej. "Europe/Madrid") porque es una app
// self-hosted: cada instalación tiene la suya. Por defecto, Atlantic/Canary.
//
// NO usar para vencimientos (dueDate): son fechas de calendario guardadas a medianoche
// UTC y se formatean con timeZone "UTC".

const DEFAULT_TIME_ZONE = "Atlantic/Canary";

/** Zona horaria de la instancia. Lanza si ORGTABLE_TIMEZONE no es una zona IANA válida. */
export function instanceTimeZone(): string {
  const configured = process.env.ORGTABLE_TIMEZONE?.trim();
  const timeZone = configured || DEFAULT_TIME_ZONE;
  try {
    // Intl lanza RangeError con una zona desconocida: es la validación más fiable.
    new Intl.DateTimeFormat("en", { timeZone });
  } catch (err) {
    // Sin valor por defecto silencioso: una zona mal escrita mostraría horas falsas.
    throw new Error(
      `ORGTABLE_TIMEZONE no es una zona horaria válida: "${timeZone}". ` +
        `Usa un nombre IANA, p. ej. "Europe/Madrid" o "Atlantic/Canary".`,
      { cause: err },
    );
  }
  return timeZone;
}

/** Fecha y hora con segundos y la abreviatura de la zona (p. ej. «15/07/2026, 10:15:00 WEST»). */
/** `intl` is the BCP 47 tag of the reader's language (getI18n().intl). */
export function formatDateTime(d: Date, intl: string): string {
  return new Intl.DateTimeFormat(intl, {
    // dateStyle/timeStyle no admiten timeZoneName, por eso se listan los campos.
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
    timeZone: instanceTimeZone(),
  }).format(d);
}

/** Solo la fecha, en la zona de la instancia (p. ej. «16 jul 2026»). */
export function formatDate(d: Date, intl: string): string {
  return new Intl.DateTimeFormat(intl, {
    dateStyle: "medium",
    timeZone: instanceTimeZone(),
  }).format(d);
}
