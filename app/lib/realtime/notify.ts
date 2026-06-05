import "server-only";
import { revalidatePath } from "next/cache";
import { publishBoardEvent } from "./bus";

// Helper único que toda mutación de tablero llama tras escribir en la base de datos:
// (1) revalida la caché de la ruta del tablero para quien recargue, y (2) publica un
// evento en el bus para que las pestañas conectadas por SSE se refresquen al instante.
// Ver app/lib/realtime/bus.ts y docs/realtime.md.
export function revalidateBoard(boardId: string): void {
  revalidatePath(`/board/${boardId}`);
  void publishBoardEvent(boardId);
}
