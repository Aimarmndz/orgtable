"use client";

import { useRef } from "react";
import { createList } from "@/app/lib/actions/lists";

export function AddListForm({ boardId }: { boardId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  // Guarda contra el doble envío (Enter repetido o doble clic): mientras la acción
  // anterior no termina, los envíos nuevos se descartan. Es una ref y no estado para
  // que el bloqueo sea inmediato, sin esperar a un nuevo render.
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
        placeholder="+ Añadir lista"
        // El placeholder desaparece al escribir y no sirve de etiqueta accesible.
        aria-label="Nombre de la nueva lista"
        className="w-full rounded-xl bg-white/25 px-3 py-2.5 text-sm text-white transition-colors placeholder:text-white/80 hover:bg-white/35 focus:bg-surface focus:text-ink focus:outline-none focus:ring-2 focus:ring-white/60 focus:placeholder:text-ink-muted"
      />
    </form>
  );
}
