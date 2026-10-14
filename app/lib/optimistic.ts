// Persists optimistic client changes (dragging on the board and the calendar).
// React-free so it can be tested directly (test/optimistic.test.ts).
import { unstable_rethrow } from "next/navigation";

/**
 * Runs the Server Action for a change the UI has already applied and calls `onFailure`
 * if the server rejects it (`{ ok: false }`) or the call fails (network, exception), so
 * the UI can undo the change or warn. It used to be `void action(...)`: the result was
 * ignored and the UI kept a state that did not exist in the database.
 *
 * Next's redirects and `notFound()` (e.g. expired session → /login) are rethrown
 * untouched: Next's router picks them up as an unhandled rejection and navigates.
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
