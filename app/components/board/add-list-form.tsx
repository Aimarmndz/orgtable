"use client";

import { useRef } from "react";
import { createList } from "@/app/lib/actions/lists";
import { useI18n } from "@/app/i18n/client";

export function AddListForm({ boardId }: { boardId: string }) {
  const { m } = useI18n();
  const ref = useRef<HTMLFormElement>(null);
  // Guard against double submits (repeated Enter or double click): while the previous
  // action has not finished, new submits are dropped. A ref rather than state so the
  // lock is immediate, without waiting for a re-render.
  const pending = useRef(false);

  return (
    <form
      ref={ref}
      onSubmit={(e) => {
        if (pending.current) e.preventDefault();
      }}
      action={async (formData) => {
        pending.current = true;
        try {
          await createList(formData);
          ref.current?.reset();
        } finally {
          pending.current = false;
        }
      }}
      className="w-72 shrink-0"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input
        name="title"
        required
        maxLength={120}
        placeholder={m.boards.list.addPlaceholder}
        // The placeholder disappears when typing and is not an accessible label.
        aria-label={m.boards.list.newName}
        className="w-full rounded-xl bg-white/25 px-3 py-2.5 text-sm text-white transition-colors placeholder:text-white/80 hover:bg-white/35 focus:bg-surface focus:text-ink focus:outline-none focus:ring-2 focus:ring-white/60 focus:placeholder:text-ink-muted"
      />
    </form>
  );
}
