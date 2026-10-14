import "server-only";
import { revalidatePath } from "next/cache";
import { publishBoardEvent } from "./bus";

// Single helper every board mutation calls after writing to the database: (1) revalidates
// the board route cache for whoever reloads, and (2) publishes an event on the bus so tabs
// connected over SSE refresh at once. See app/lib/realtime/bus.ts and docs/realtime.md.
export function revalidateBoard(boardId: string): void {
  revalidatePath(`/board/${boardId}`);
  void publishBoardEvent(boardId);
}
