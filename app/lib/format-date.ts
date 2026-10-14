import "server-only";

// Date formatting ON THE SERVER (Server Components). The Node process runs in the
// container's time zone (usually UTC), so without an explicit `timeZone` an event at 10:15
// in the Canary Islands showed as 9:15, and near midnight it changed day. The zone comes
// from ORGTABLE_TIMEZONE (IANA, e.g. "Europe/Madrid") because the app is self-hosted: each
// installation has its own. Defaults to Atlantic/Canary.
//
// Do NOT use for due dates (dueDate): they are calendar dates stored at midnight UTC and
// are formatted with timeZone "UTC".

const DEFAULT_TIME_ZONE = "Atlantic/Canary";

/** Time zone of the instance. Throws if ORGTABLE_TIMEZONE is not a valid IANA zone. */
export function instanceTimeZone(): string {
  const configured = process.env.ORGTABLE_TIMEZONE?.trim();
  const timeZone = configured || DEFAULT_TIME_ZONE;
  try {
    // Intl throws RangeError for an unknown zone: the most reliable validation.
    new Intl.DateTimeFormat("en", { timeZone });
  } catch (err) {
    // No silent default: a misspelt zone would show wrong times.
    throw new Error(
      `ORGTABLE_TIMEZONE is not a valid time zone: "${timeZone}". ` +
        `Use an IANA name, e.g. "Europe/Madrid" or "Atlantic/Canary".`,
      { cause: err },
    );
  }
  return timeZone;
}

/**
 * Date and time with seconds and the zone abbreviation (e.g. "15/07/2026, 10:15:00 WEST").
 * `intl` is the BCP 47 tag of the reader's language (getI18n().intl).
 */
export function formatDateTime(d: Date, intl: string): string {
  return new Intl.DateTimeFormat(intl, {
    // dateStyle/timeStyle do not allow timeZoneName, hence the fields are listed.
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

/** Date only, in the instance's time zone (e.g. "16 Jul 2026"). */
export function formatDate(d: Date, intl: string): string {
  return new Intl.DateTimeFormat(intl, {
    dateStyle: "medium",
    timeZone: instanceTimeZone(),
  }).format(d);
}
