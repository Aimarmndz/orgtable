"use client";

import { useRef } from "react";
import { createCard } from "@/app/lib/actions/cards";

export function AddCardForm({
  listId,
  listTitle,
}: {
  listId: string;
  listTitle: string;
}) {
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
          await createCard(formData);
          ref.current?.reset();
        } finally {
          pending.current = false;
        }
      }}
      className="p-2"
    >
      <input type="hidden" name="listId" value={listId} />
      <input
        name="title"
        required
        maxLength={500}
        placeholder="+ Añadir tarjeta"
        // El placeholder desaparece al escribir y no sirve de etiqueta accesible.
        aria-label={`Nueva tarjeta en ${listTitle}`}
        className="w-full rounded-lg bg-transparent px-2 py-1.5 text-sm text-ink transition-colors placeholder:text-ink-muted hover:bg-black/5 focus:bg-surface focus:shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/25 dark:hover:bg-white/5"
      />
    </form>
  );
}
