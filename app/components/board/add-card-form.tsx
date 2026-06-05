"use client";

import { useRef } from "react";
import { createCard } from "@/app/lib/actions/cards";

export function AddCardForm({ listId }: { listId: string }) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createCard(formData);
        ref.current?.reset();
      }}
      className="p-2"
    >
      <input type="hidden" name="listId" value={listId} />
      <input
        name="title"
        required
        maxLength={500}
        placeholder="+ Añadir tarjeta"
        className="w-full rounded-lg bg-transparent px-2 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-muted hover:bg-black/5 focus:bg-surface focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/25 dark:hover:bg-white/5"
      />
    </form>
  );
}
