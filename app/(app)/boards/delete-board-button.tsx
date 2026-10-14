"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteBoard } from "@/app/lib/actions/boards";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Deleting a board cascades to its lists, cards and attachments, so it asks for a
// second inline click ("Delete? Yes / No") instead of window.confirm, which cannot be
// styled; on touch screens a single tap on the corner was enough to lose everything.
// While confirming it stays visible (it does not depend on the card's hover).
// On cancel the form unmounts with focus inside; without moving focus back to the ✕ it
// would fall to <body> and keyboard or screen reader users would lose their place.
export function DeleteBoardButton({
  boardId,
  title,
  className,
}: {
  boardId: string;
  title: string;
  className: string;
}) {
  const { m } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Focus is only restored after cancelling: on the initial mount every board in the
  // grid has its own ✕ and none of them should steal focus.
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (!confirming && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

  function cancel() {
    restoreFocus.current = true;
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setConfirming(true)}
        className={className}
        aria-label={fmt(m.boards.index.deleteBoard, { title })}
      >
        ✕
      </button>
    );
  }

  return (
    <form
      action={deleteBoard}
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
      className="flex h-7 items-center gap-1 rounded-md bg-black/60 pl-2 pr-0.5 text-xs font-medium text-white"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <span>{m.boards.confirm.deletePrompt}</span>
      <ConfirmButton title={title} />
      <button
        type="button"
        // Focus goes to "No": pressing Enter out of habit deletes nothing.
        autoFocus
        onClick={cancel}
        className="rounded px-1.5 py-1 hover:bg-white/20"
      >
        {m.boards.confirm.no}
      </button>
    </form>
  );
}

function ConfirmButton({ title }: { title: string }) {
  const { m } = useI18n();
  // Prevents a double submit while the action deletes and redirects.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={fmt(m.boards.index.confirmDeleteBoard, { title })}
      className="rounded px-1.5 py-1 hover:bg-white/20 disabled:opacity-60"
    >
      {m.boards.confirm.yes}
    </button>
  );
}
