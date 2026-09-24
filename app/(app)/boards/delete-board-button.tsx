"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { deleteBoard } from "@/app/lib/actions/boards";

// Borrar un tablero elimina en cascada listas, tarjetas y adjuntos, así que pide un
// segundo clic en línea («¿Borrar? Sí / No») en vez de window.confirm, que no se puede
// estilar y en táctil bastaba un toque en la esquina para perderlo todo.
// Mientras confirma queda siempre visible (no depende del hover de la tarjeta).
export function DeleteBoardButton({
  boardId,
  title,
  className,
}: {
  boardId: string;
  title: string;
  className: string;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className={className}
        aria-label={`Borrar tablero ${title}`}
      >
        ✕
      </button>
    );
  }

  return (
    <form
      action={deleteBoard}
      onKeyDown={(e) => {
        if (e.key === "Escape") setConfirming(false);
      }}
      className="flex h-7 items-center gap-1 rounded-md bg-black/60 pl-2 pr-0.5 text-xs font-medium text-white"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <span>¿Borrar?</span>
      <ConfirmButton title={title} />
      <button
        type="button"
        // El foco va a «No»: si se pulsa Intro por inercia, no se borra nada.
        autoFocus
        onClick={() => setConfirming(false)}
        className="rounded px-1.5 py-1 hover:bg-white/20"
      >
        No
      </button>
    </form>
  );
}

function ConfirmButton({ title }: { title: string }) {
  // Evita el doble envío mientras la acción borra y redirige.
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={`Sí, borrar el tablero ${title}`}
      className="rounded px-1.5 py-1 hover:bg-white/20 disabled:opacity-60"
    >
      Sí
    </button>
  );
}
