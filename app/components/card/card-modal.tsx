"use client";

import {
  useActionState,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type TransitionStartFunction,
} from "react";
import type {
  AssigneeDTO,
  AttachmentDTO,
  CardDTO,
  ChecklistDTO,
  CommentDTO,
  LabelDTO,
} from "@/app/lib/types";
import {
  labelBackground,
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  type LabelColor,
} from "@/app/lib/colors";
import {
  updateCard,
  deleteCard,
  type CardDetailsState,
} from "@/app/lib/actions/cards";
import { CARD_DESCRIPTION_MAX } from "@/app/lib/limits";
import { toggleCardLabel, createLabel } from "@/app/lib/actions/labels";
import {
  createChecklist,
  deleteChecklist,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/app/lib/actions/checklists";
import {
  uploadAttachment,
  deleteAttachment,
  type AttachmentState,
} from "@/app/lib/actions/attachments";
import { assignMember, unassignMember } from "@/app/lib/actions/assignees";
import { addComment, deleteComment } from "@/app/lib/actions/comments";
import { Button } from "../ui/button";
import { Input, Textarea } from "../ui/input";
import { useBoardPerms } from "../board/board-perms";
import type { BoardMemberDTO } from "../board/members-panel";
import {
  formatCommentTime,
  formatDueDate,
  runToggle,
} from "./card-modal-helpers";

// Los botones de borrar solo aparecen al pasar el ratón, pero deben verse también al
// recibir el foco con teclado y siempre en pantallas táctiles (sin hover).
const revealOnHover =
  "rounded opacity-0 transition hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:opacity-100";

// Nombres en español para el lector de pantalla; el Record obliga a cubrir cada color.
const LABEL_COLOR_NAMES: Record<LabelColor, string> = {
  green: "verde",
  lime: "lima",
  amber: "ámbar",
  red: "rojo",
  purple: "morado",
  blue: "azul",
  teal: "turquesa",
  pink: "rosa",
};

const noopSubscribe = () => () => {};

/** `false` en el servidor y durante la hidratación; `true` después. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

const smallInput =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function CardModal({
  card,
  boardId,
  boardLabels,
  members,
  currentUserId,
  onClose,
}: {
  card: CardDTO;
  boardId: string;
  boardLabels: LabelDTO[];
  members: BoardMemberDTO[];
  currentUserId: string;
  onClose: () => void;
}) {
  const { canEdit, canManage } = useBoardPerms();
  const [, startTransition] = useTransition();
  const [labelError, setLabelError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();
  const detailsErrorId = useId();
  const [details, detailsAction, detailsPending] = useActionState<
    CardDetailsState,
    FormData
  >(updateCard, {});

  // <dialog> nativo con showModal(): el navegador vuelve inerte el resto de la página
  // (el Tab no sale al tablero), enfoca el primer control y, al cerrar, devuelve el
  // foco a la tarjeta que lo abrió. Layout effect para que close() ocurra antes de
  // que React quite el nodo: si se retira abierto, el foco no se restaura.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  const assigned = new Set(card.labels.map((l) => l.id));
  const dueValue = card.dueDate ? card.dueDate.slice(0, 10) : "";
  const total = card.checklists.reduce((n, c) => n + c.items.length, 0);
  const done = card.checklists.reduce(
    (n, c) => n + c.items.filter((i) => i.done).length,
    0,
  );

  return (
    // El <dialog> ocupa toda la ventana y hace de contenedor con scroll; el panel va
    // dentro. Un clic cuyo destino es el propio <dialog> cae fuera del panel.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: cierra React (desmonta), no el navegador por su cuenta.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-0 size-full max-h-none max-w-none overflow-y-auto overscroll-contain bg-transparent p-4 text-ink backdrop:bg-black/50 backdrop:motion-safe:animate-[overlay-in_150ms_ease-out] sm:p-8"
    >
      <div
        className="mx-auto my-4 w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-[0_32px_64px_-24px_oklch(0.27_0.022_52/0.45)]"
        style={{ animation: "dialog-in 180ms ease-out" }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id={titleId}
            className="font-display text-xl font-bold leading-snug tracking-tight text-balance"
          >
            {card.title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Etiquetas */}
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Etiquetas
          </h3>
          {canEdit ? (
            boardLabels.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {boardLabels.map((l) => {
                  const on = assigned.has(l.id);
                  return (
                    <button
                      key={l.id}
                      aria-pressed={on}
                      onClick={() =>
                        startTransition(async () => {
                          setLabelError(
                            await runToggle(
                              () =>
                                toggleCardLabel({
                                  cardId: card.id,
                                  labelId: l.id,
                                }),
                              "No se pudo cambiar la etiqueta.",
                              "toggleCardLabel",
                            ),
                          );
                        })
                      }
                      style={{ background: labelBackground(l.color) }}
                      // Sin opacity-55 en el no seleccionado: bajaba el texto blanco a
                      // ~2,2:1. El estado se distingue por el ✓, el anillo y aria-pressed.
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white transition ${
                        on
                          ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                          : ""
                      }`}
                    >
                      {l.name}
                      {on && " ✓"}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">
                Aún no hay etiquetas en este tablero.
              </p>
            )
          ) : card.labels.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {card.labels.map((l) => (
                <span
                  key={l.id}
                  style={{ background: labelBackground(l.color) }}
                  className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium text-white"
                >
                  {l.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Sin etiquetas.</p>
          )}
          {/* El aviso va junto a lo que falló: el modal tiene scroll y uno arriba del
              todo no se vería. Se borra en cuanto otro cambio de etiqueta sale bien. */}
          {labelError && (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {labelError}
            </p>
          )}
          {canManage && <NewLabelForm boardId={boardId} />}
        </section>

        {/* Asignados */}
        <AssigneesSection
          cardId={card.id}
          assignees={card.assignees}
          members={members}
          canEdit={canEdit}
        />

        {/* Descripción + fecha */}
        {canEdit ? (
          <form action={detailsAction} className="mt-6 space-y-4">
            <input type="hidden" name="cardId" value={card.id} />
            <div>
              <label
                htmlFor={descId}
                className="block text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                Descripción
              </label>
              <Textarea
                id={descId}
                name="description"
                rows={4}
                maxLength={CARD_DESCRIPTION_MAX}
                // Si no se guardó, se rehidrata con lo enviado: React resetea el
                // formulario al acabar la acción y, si no, se perdería lo escrito.
                defaultValue={details.description ?? card.description ?? ""}
                aria-describedby={details.error ? detailsErrorId : undefined}
                placeholder="Añade más detalle…"
                className="mt-2 resize-y"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Vencimiento
                </span>
                <Input
                  type="date"
                  name="dueDate"
                  defaultValue={details.dueDate ?? dueValue}
                  className="mt-2 w-auto"
                />
              </label>
              <Button type="submit" variant="subtle" disabled={detailsPending}>
                {detailsPending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </div>
            {details.error && (
              <p
                id={detailsErrorId}
                role="alert"
                className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
              >
                {details.error}
              </p>
            )}
          </form>
        ) : (
          <div className="mt-6 space-y-4">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Descripción
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                {card.description || "Sin descripción."}
              </p>
            </div>
            {card.dueDate && (
              <p className="text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Vencimiento:{" "}
                </span>
                <time dateTime={dueValue}>{formatDueDate(card.dueDate)}</time>
              </p>
            )}
          </div>
        )}

        {/* Checklists */}
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Checklists
            {total > 0 && (
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                · {done} de {total} completadas
              </span>
            )}
          </h3>
          <div className="mt-3 space-y-5">
            {card.checklists.map((cl) => (
              <ChecklistBlock
                key={cl.id}
                checklist={cl}
                canEdit={canEdit}
                startTransition={startTransition}
              />
            ))}
          </div>
          {canEdit && <NewChecklistForm cardId={card.id} />}
        </section>

        {/* Adjuntos */}
        <AttachmentsSection
          cardId={card.id}
          attachments={card.attachments}
          canEdit={canEdit}
        />

        {/* Comentarios */}
        <CommentsSection
          cardId={card.id}
          comments={card.comments}
          canEdit={canEdit}
          canManage={canManage}
          currentUserId={currentUserId}
        />

        {/* Borrar (solo quien puede editar) */}
        {canEdit && (
          <div className="mt-8 flex justify-end border-t border-border pt-4">
            <DeleteCardForm cardId={card.id} onDeleted={onClose} />
          </div>
        )}
      </div>
    </dialog>
  );
}

// Borrar es irreversible: el primer clic solo pide confirmación en línea (sin
// window.confirm, que bloquea y no sigue el estilo de la app).
function DeleteCardForm({
  cardId,
  onDeleted,
}: {
  cardId: string;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // El botón pulsado desaparece al cambiar de paso: se mueve el foco al control
  // equivalente para que el teclado no se quede en <body>.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) askRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  if (!confirming) {
    return (
      <Button
        ref={askRef}
        variant="danger"
        type="button"
        onClick={() => setConfirming(true)}
      >
        Borrar tarjeta
      </Button>
    );
  }

  return (
    <form
      action={async (formData) => {
        await deleteCard(formData);
        onDeleted();
      }}
      className="flex flex-wrap items-center justify-end gap-2"
    >
      <input type="hidden" name="cardId" value={cardId} />
      <span className="text-sm text-ink">¿Borrar la tarjeta?</span>
      <Button variant="danger" type="submit">
        Sí, borrar
      </Button>
      <Button
        ref={cancelRef}
        variant="subtle"
        type="button"
        onClick={() => setConfirming(false)}
      >
        No
      </Button>
    </form>
  );
}

function NewLabelForm({ boardId }: { boardId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [color, setColor] = useState<LabelColor>(LABEL_COLOR_KEYS[0]);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createLabel(formData);
        ref.current?.reset();
      }}
      className="mt-3 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="boardId" value={boardId} />
      <input type="hidden" name="color" value={color} />
      <div className="flex gap-1">
        {LABEL_COLOR_KEYS.map((k) => (
          <button
            type="button"
            key={k}
            onClick={() => setColor(k)}
            aria-label={`Color ${LABEL_COLOR_NAMES[k]}`}
            aria-pressed={color === k}
            style={{ background: LABEL_COLORS[k] }}
            className={`size-5 rounded-full transition ${
              color === k
                ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                : ""
            }`}
          />
        ))}
      </div>
      <input
        name="name"
        required
        maxLength={40}
        placeholder="Nueva etiqueta"
        aria-label="Nombre de la nueva etiqueta"
        className={`${smallInput} min-w-32 flex-1`}
      />
      <Button type="submit" variant="subtle" className="px-3 py-1.5">
        Añadir
      </Button>
    </form>
  );
}

function ChecklistBlock({
  checklist,
  canEdit,
  startTransition,
}: {
  checklist: ChecklistDTO;
  canEdit: boolean;
  startTransition: TransitionStartFunction;
}) {
  const itemRef = useRef<HTMLFormElement>(null);
  // Error propio de cada checklist, para que salga junto al ítem que falló.
  const [itemError, setItemError] = useState<string | null>(null);
  const total = checklist.items.length;
  const done = checklist.items.filter((i) => i.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">{checklist.title}</h4>
        {canEdit && (
          <form action={deleteChecklist}>
            <input type="hidden" name="checklistId" value={checklist.id} />
            <button className="text-xs text-ink-muted transition-colors hover:text-danger">
              Eliminar
            </button>
          </form>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-success transition-all duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs tabular-nums text-ink-muted">{pct}%</span>
      </div>

      <ul className="mt-2 space-y-1">
        {checklist.items.map((it) => (
          <li key={it.id} className="group flex items-center gap-2">
            <button
              onClick={() =>
                canEdit &&
                startTransition(async () => {
                  setItemError(
                    await runToggle(
                      () =>
                        toggleChecklistItem({ itemId: it.id, done: !it.done }),
                      "No se pudo actualizar el ítem.",
                      "toggleChecklistItem",
                    ),
                  );
                })
              }
              disabled={!canEdit}
              aria-label={it.done ? "Marcar como pendiente" : "Marcar como hecho"}
              className={`grid size-4 shrink-0 place-items-center rounded border text-[10px] text-white transition-colors ${
                it.done
                  ? "border-success bg-success"
                  : `border-border ${canEdit ? "hover:border-accent" : ""}`
              }`}
            >
              {it.done && "✓"}
            </button>
            <span
              className={`flex-1 text-sm ${
                it.done ? "text-ink-muted line-through" : ""
              }`}
            >
              {it.text}
            </span>
            {canEdit && (
              <form action={deleteChecklistItem}>
                <input type="hidden" name="itemId" value={it.id} />
                <button
                  className={`text-xs text-ink-muted ${revealOnHover}`}
                  aria-label="Borrar ítem"
                >
                  ✕
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

      {itemError && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {itemError}
        </p>
      )}

      {canEdit && (
        <form
          ref={itemRef}
          action={async (formData) => {
            await addChecklistItem(formData);
            itemRef.current?.reset();
          }}
          className="mt-2"
        >
          <input type="hidden" name="checklistId" value={checklist.id} />
          <input
            name="text"
            required
            maxLength={200}
            placeholder="+ Añadir ítem"
            aria-label={`Nuevo ítem en ${checklist.title}`}
            className={smallInput}
          />
        </form>
      )}
    </div>
  );
}

function AttachmentsSection({
  cardId,
  attachments,
  canEdit,
}: {
  cardId: string;
  attachments: AttachmentDTO[];
  canEdit: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const firstRender = useRef(true);
  const [state, action, pending] = useActionState<AttachmentState, FormData>(
    uploadAttachment,
    {},
  );

  // Limpia el formulario tras una subida correcta (sin error).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!state.error) ref.current?.reset();
  }, [state]);

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Adjuntos
        {attachments.length > 0 && (
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            · {attachments.length}
          </span>
        )}
      </h3>

      {attachments.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="group flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <svg
                className="size-4 shrink-0 text-ink-muted"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
              <a
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-sm hover:underline"
              >
                {a.filename}
              </a>
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                {formatBytes(a.size)}
              </span>
              {canEdit && (
                <form action={deleteAttachment}>
                  <input type="hidden" name="attachmentId" value={a.id} />
                  <button
                    className={`text-xs text-ink-muted ${revealOnHover}`}
                    aria-label={`Borrar adjunto ${a.filename}`}
                  >
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">No hay adjuntos.</p>
      )}

      {canEdit && (
        <form
          ref={ref}
          action={action}
          className="mt-3 flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="cardId" value={cardId} />
          <input
            type="file"
            name="file"
            required
            aria-label="Archivo para adjuntar a la tarjeta"
            className="max-w-full text-sm text-ink-muted file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-border/40"
          />
          <Button type="submit" variant="subtle" disabled={pending}>
            {pending ? "Subiendo…" : "Adjuntar"}
          </Button>
        </form>
      )}

      {state.error && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
    </section>
  );
}

function NewChecklistForm({ cardId }: { cardId: string }) {
  const ref = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={ref}
      action={async (formData) => {
        await createChecklist(formData);
        ref.current?.reset();
      }}
      className="mt-4 flex gap-2"
    >
      <input type="hidden" name="cardId" value={cardId} />
      <input
        name="title"
        maxLength={80}
        placeholder="Nueva checklist"
        aria-label="Título de la nueva checklist"
        className={`${smallInput} flex-1`}
      />
      <Button type="submit" variant="subtle">
        Añadir checklist
      </Button>
    </form>
  );
}

// Avatar simple: círculo con la inicial del nombre. Sin imágenes (no las tenemos).
function Avatar({ name, size = 7 }: { name: string; size?: 6 | 7 | 8 }) {
  const cls = { 6: "size-6 text-[11px]", 7: "size-7 text-xs", 8: "size-8 text-sm" };
  return (
    <span
      className={`grid ${cls[size]} shrink-0 place-items-center rounded-full bg-surface-2 font-semibold uppercase text-ink-muted`}
      aria-hidden
    >
      {name.charAt(0)}
    </span>
  );
}

function AssigneesSection({
  cardId,
  assignees,
  members,
  canEdit,
}: {
  cardId: string;
  assignees: AssigneeDTO[];
  members: BoardMemberDTO[];
  canEdit: boolean;
}) {
  const assignedIds = new Set(assignees.map((a) => a.id));
  const unassigned = members.filter((m) => !assignedIds.has(m.id));

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Asignados
      </h3>

      {assignees.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {assignees.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pl-0.5 pr-2.5 text-sm"
            >
              <Avatar name={a.name} size={6} />
              {a.name}
              {canEdit && (
                <form action={unassignMember} className="contents">
                  <input type="hidden" name="cardId" value={cardId} />
                  <input type="hidden" name="userId" value={a.id} />
                  <button
                    className="text-ink-muted transition-colors hover:text-danger"
                    aria-label={`Quitar a ${a.name}`}
                  >
                    ✕
                  </button>
                </form>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">Nadie asignado.</p>
      )}

      {canEdit && unassigned.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {unassigned.map((m) => (
            <form key={m.id} action={assignMember}>
              <input type="hidden" name="cardId" value={cardId} />
              <input type="hidden" name="userId" value={m.id} />
              <button className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border py-0.5 pl-0.5 pr-2.5 text-sm text-ink-muted transition-colors hover:border-accent hover:text-ink">
                <Avatar name={m.name} size={6} />+ {m.name}
              </button>
            </form>
          ))}
        </div>
      )}
    </section>
  );
}

function CommentsSection({
  cardId,
  comments,
  canEdit,
  canManage,
  currentUserId,
}: {
  cardId: string;
  comments: CommentDTO[];
  canEdit: boolean;
  canManage: boolean;
  currentUserId: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  // Con ?card= el modal se renderiza en el servidor, cuya zona horaria no es la del
  // navegador: la hora se pinta solo tras hidratar para no provocar un desajuste.
  const hydrated = useHydrated();

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Comentarios
        {comments.length > 0 && (
          <span className="ml-1.5 font-normal normal-case tracking-normal">
            · {comments.length}
          </span>
        )}
      </h3>

      {comments.length > 0 ? (
        <ul className="mt-3 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="group flex gap-2.5">
              <Avatar name={c.authorName} />
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{c.authorName}</span>
                  <time
                    dateTime={c.createdAt}
                    className="text-[11px] text-ink-muted"
                  >
                    {hydrated ? formatCommentTime(c.createdAt) : ""}
                  </time>
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm">
                  {c.text}
                </p>
              </div>
              {(c.authorId === currentUserId || canManage) && (
                <form action={deleteComment}>
                  <input type="hidden" name="commentId" value={c.id} />
                  <button
                    className={`text-xs text-ink-muted ${revealOnHover}`}
                    aria-label="Borrar comentario"
                  >
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">
          Sé el primero en comentar.
        </p>
      )}

      {canEdit && (
        <form
          ref={ref}
          action={async (formData) => {
            await addComment(formData);
            ref.current?.reset();
          }}
          className="mt-3"
        >
          <input type="hidden" name="cardId" value={cardId} />
          <Textarea
            name="text"
            rows={2}
            required
            maxLength={2000}
            placeholder="Escribe un comentario…"
            aria-label="Nuevo comentario"
            className="resize-y"
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" variant="subtle">
              Comentar
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
