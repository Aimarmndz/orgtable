"use client";

import { useRef } from "react";
import { createList } from "@/app/lib/actions/lists";

export function AddListForm({ boardId }: { boardId: string }) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createList(formData);
        ref.current?.reset();
      }}
      className="w-72 shrink-0"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input
        name="title"
        required
        maxLength={120}
        placeholder="+ Añadir lista"
        className="w-full rounded-xl bg-white/25 px-3 py-2.5 text-sm text-white transition-colors placeholder:text-white/80 hover:bg-white/35 focus:bg-surface focus:text-ink focus:outline-none focus:ring-2 focus:ring-white/60 focus:placeholder:text-ink-muted"
      />
    </form>
  );
}
