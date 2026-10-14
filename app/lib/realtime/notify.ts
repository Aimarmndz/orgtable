import "server-only";
import { revalidatePath } from "next/cache";
import { publishBoardEvent } from "./bus";

// Single helper every board mutation calls after writing to the database: (1) revalidates
// the board route cache for whoever reloads, and (2) publishes an event on the bus so tabs
// connected over SSE refresh at once. See app/lib/realtime/bus.ts and docs/realtime.md.
export function revalidateBoard(boardId: string): void {
  // Every board page (/<workspace>/<board>) and its workspace's index: the route pattern
  // covers any slug, so a renamed board or a board opened by id is refreshed too.
  revalidatePath("/[workspace]/[board]", "page");
  revalidatePath("/[workspace]", "page");
  void publishBoardEvent(boardId);
}
