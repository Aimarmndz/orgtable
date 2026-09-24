"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import {
  addBoardMember,
  updateBoardMemberRole,
  removeBoardMember,
  type MemberActionState,
} from "@/app/lib/actions/members";
import {
  BOARD_ROLE_LABELS,
  ASSIGNABLE_BOARD_ROLES,
  type BoardRole,
} from "@/app/lib/roles";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export type BoardMemberDTO = {
  id: string;
  name: string;
  email: string;
  role: BoardRole;
  isOwner: boolean;
};

// Panel de gestión de miembros de un tablero (Hito 3). Solo lo abre el propietario.
// Invitar usa useActionState (feedback inline); cambiar rol y quitar usan formularios
// simples (la autorización la resuelve el servidor). Ver docs/authorization.md.
export function MembersPanel({
  boardId,
  members,
  canManage,
  onClose,
}: {
  boardId: string;
  members: BoardMemberDTO[];
  canManage: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState<MemberActionState, FormData>(
    addBoardMember,
    {},
  );

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // <dialog> nativo abierto con showModal(): el navegador pone el foco dentro, lo atrapa
  // (el resto de la página queda inerte) y Escape dispara `cancel`. Al desmontar se cierra
  // y se devuelve el foco a mano a quien lo tenía, porque el navegador no lo restaura si
  // el <dialog> se quita del DOM en vez de cerrarse.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(e) => {
        // El cierre lo decide el padre (desmonta el panel); así no queda un <dialog>
        // cerrado pero montado.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // El <dialog> no tiene relleno: un clic cuyo destino es el propio <dialog> solo
        // puede venir del fondo (::backdrop).
        if (e.target === e.currentTarget) onClose();
      }}
      className="mx-auto mt-8 max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface text-ink shadow-[0_32px_64px_-24px_oklch(0.27_0.022_52/0.45)] backdrop:bg-black/50 backdrop:animate-[overlay-in_150ms_ease-out] sm:mt-12"
      style={{ animation: "dialog-in 180ms ease-out" }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="font-display text-xl font-bold leading-snug tracking-tight"
            >
              Miembros
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
              {canManage
                ? "Invita a personas y elige qué pueden hacer en este tablero."
                : "Personas con acceso a este tablero."}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Invitar (solo el propietario) */}
        {canManage && (
        <form action={action} className="mt-5">
          <input type="hidden" name="boardId" value={boardId} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Email
              </span>
              <Input
                name="email"
                type="email"
                required
                defaultValue={state.values?.email}
                placeholder="persona@ejemplo.com"
                className="mt-1.5"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Rol
              </span>
              <select
                name="role"
                defaultValue={state.values?.role ?? "EDITOR"}
                className="mt-1.5 h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
              >
                {ASSIGNABLE_BOARD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {BOARD_ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={pending}>
              {pending ? "Añadiendo…" : "Invitar"}
            </Button>
          </div>
          {state.error && (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {state.error}
            </p>
          )}
          {/* Región viva siempre montada: los lectores de pantalla solo anuncian los
              cambios dentro de una región que ya existía. */}
          <div role="status">
            {state.message && (
              <p className="mt-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                {state.message}
              </p>
            )}
          </div>
        </form>
        )}

        {/* Lista de miembros */}
        <ul className="mt-6 divide-y divide-border">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold uppercase">
                {m.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-ink-muted">{m.email}</p>
              </div>

              {m.isOwner || !canManage ? (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">
                  {BOARD_ROLE_LABELS[m.role]}
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <form action={updateBoardMemberRole}>
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="userId" value={m.id} />
                    <select
                      name="role"
                      defaultValue={m.role}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-ink outline-none focus-visible:border-accent"
                      aria-label={`Rol de ${m.name}`}
                    >
                      {ASSIGNABLE_BOARD_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {BOARD_ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </form>
                  <form action={removeBoardMember}>
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="userId" value={m.id} />
                    <button
                      className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
                      aria-label={`Quitar a ${m.name}`}
                    >
                      ✕
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
