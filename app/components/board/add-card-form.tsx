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
      className="mt-1 px-1"
    >
      <input type="hidden" name="listId" value={listId} />
      <input
        name="title"
        required
        maxLength={500}
        placeholder="+ Añadir tarjeta"
        className="w-full rounded-md bg-transparent px-2 py-1.5 text-sm placeholder:text-zinc-400 hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      />
    </form>
  );
}
