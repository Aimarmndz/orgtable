"use client";

import { useActionState } from "react";
import { importBoard, type ImportState } from "@/app/lib/actions/boards";
import { Button } from "@/app/components/ui/button";

// Importa un tablero desde un fichero JSON exportado. useActionState da feedback inline;
// al importar con éxito, la acción redirige al tablero nuevo. Ver docs/operations.md.
export function ImportBoardForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(
    importBoard,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        name="file"
        accept="application/json,.json"
        required
        aria-label="Fichero JSON del tablero a importar"
        className="max-w-full text-sm text-ink-muted file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-border/40"
      />
      <Button type="submit" variant="subtle" disabled={pending}>
        {pending ? "Importando…" : "Importar tablero"}
      </Button>
      {state.error && (
        <p
          role="alert"
          className="w-full rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
    </form>
  );
}
