"use client";

import {
  useActionState,
  useEffect,
  useRef,
  useState,
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
} from "@/app/lib/colors";
import { updateCard, deleteCard } from "@/app/lib/actions/cards";
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const assigned = new Set(card.labels.map((l) => l.id));
  const dueValue = card.dueDate ? card.dueDate.slice(0, 10) : "";
  const total = card.checklists.reduce((n, c) => n + c.items.length, 0);
  const done = card.checklists.reduce(
    (n, c) => n + c.items.filter((i) => i.done).length,
    0,
  );

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:p-8"
      style={{ animation: "overlay-in 150ms ease-out" }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="my-4 w-full max-w-2xl rounded-2xl border border-border bg-surface p-6 shadow-[0_32px_64px_-24px_oklch(0.27_0.022_52/0.45)]"
        style={{ animation: "dialog-in 180ms ease-out" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-xl font-bold leading-snug tracking-tight text-balance">
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
                      onClick={() =>
                        startTransition(() => {
                          toggleCardLabel({ cardId: card.id, labelId: l.id });
                        })
                      }
                      style={{ background: labelBackground(l.color) }}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white transition ${
                        on
                          ? "ring-2 ring-ink/40 ring-offset-1 ring-offset-surface"
                          : "opacity-55 hover:opacity-100"
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
          <form action={updateCard} className="mt-6 space-y-4">
            <input type="hidden" name="cardId" value={card.id} />
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Descripción
              </h3>
              <Textarea
                name="description"
                rows={4}
                defaultValue={card.description ?? ""}
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
                  defaultValue={dueValue}
                  className="mt-2 w-auto"
                />
              </label>
              <Button type="submit" variant="subtle">
                Guardar cambios
              </Button>
            </div>
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
            {dueValue && (
              <p className="text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Vencimiento:{" "}
                </span>
                {dueValue}
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
                · {done}/{total} completado
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
            <form
              action={async (formData) => {
                await deleteCard(formData);
                onClose();
              }}
            >
              <input type="hidden" name="cardId" value={card.id} />
              <Button variant="danger" type="submit">
                Borrar tarjeta
              </Button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

function NewLabelForm({ boardId }: { boardId: string }) {
  const ref = useRef<HTMLFormElement>(null);
  const [color, setColor] = useState<string>(LABEL_COLOR_KEYS[0]);

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
            aria-label={`Color ${k}`}
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
                startTransition(() => {
                  toggleChecklistItem({ itemId: it.id, done: !it.done });
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
                  className="text-xs text-ink-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
                  aria-label="Borrar ítem"
                >
                  ✕
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>

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
                    className="text-xs text-ink-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
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
            className="max-w-full text-sm text-ink-muted file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-border/40"
          />
          <Button type="submit" variant="subtle" disabled={pending}>
            {pending ? "Subiendo…" : "Adjuntar"}
          </Button>
        </form>
      )}

      {state.error && (
        <p className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
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

function formatCommentTime(iso: string): string {
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
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
                  <time className="text-[11px] text-ink-muted">
                    {formatCommentTime(c.createdAt)}
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
                    className="text-xs text-ink-muted opacity-0 transition hover:text-danger group-hover:opacity-100"
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
