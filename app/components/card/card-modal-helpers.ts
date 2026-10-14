// Pure logic of the card modal, kept apart from the component so it can be tested with
// Vitest in a node environment (the component imports Server Actions and cannot load
// outside Next).
import { unstable_rethrow } from "next/navigation";

/**
 * Date and time of a comment, in the language `intl` (a BCP 47 tag). An undefined
 * `timeZone` means the browser's zone. The component only calls it after hydration: on
 * the server the zone would be the container's (usually UTC) and the text would not
 * match the client's.
 */
export function formatCommentTime(iso: string, intl: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(intl, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));
}

/**
 * Readable due date, in the language `intl`. `dueDate` is a calendar date stored at
 * midnight UTC: formatting it in another zone would move it to the previous day west of
 * Greenwich.
 */
export function formatDueDate(iso: string, intl: string): string {
  return new Intl.DateTimeFormat(intl, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/**
 * Runs a toggle-style action and returns the error message for the UI (or `null` if it
 * went well). Next's internal errors (redirect to /login when the session expires,
 * notFound) are rethrown so the router handles them.
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
    console.error(`${context} failed`, err);
    return failMessage;
  }
}
