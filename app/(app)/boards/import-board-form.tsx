"use client";

import { useActionState } from "react";
import { importBoard, type ImportState } from "@/app/lib/actions/boards";
import { Button } from "@/app/components/ui/button";
import { useI18n } from "@/app/i18n/client";

// Imports a board from an exported JSON file. useActionState gives inline feedback; on
// success the action redirects to the new board. See docs/operations.md.
export function ImportBoardForm() {
  const { m } = useI18n();
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
        aria-label={m.boards.import.fileLabel}
        className="max-w-full text-sm text-ink-muted file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-border/40"
      />
      <Button type="submit" variant="subtle" disabled={pending}>
        {pending ? m.boards.import.pending : m.boards.import.submit}
      </Button>
      {/* role="alert" so the screen reader announces it. It is removed while submitting,
          so a second identical error is inserted again and announced again. */}
      {state.error && !pending && (
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
