"use client";

import { useRef } from "react";
import { createCard } from "@/app/lib/actions/cards";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

export function AddCardForm({
  listId,
  listTitle,
}: {
  listId: string;
  listTitle: string;
}) {
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
          await createCard(formData);
          ref.current?.reset();
        } finally {
          pending.current = false;
        }
      }}
      // "Add card" in the list's menu focuses this field.
      data-add-card={listId}
      className="p-2"
    >
      <input type="hidden" name="listId" value={listId} />
      <input
        name="title"
        required
        maxLength={500}
        placeholder={m.boards.card.addPlaceholder}
        // The placeholder disappears when typing and is not an accessible label.
        aria-label={fmt(m.boards.card.newIn, { list: listTitle })}
        className="w-full rounded-lg bg-transparent px-2 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-muted hover:bg-black/5 focus:bg-surface focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/25 dark:hover:bg-white/5"
      />
    </form>
  );
}
