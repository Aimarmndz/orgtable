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
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Delete buttons only appear on hover, but they must also show when they receive
// keyboard focus, and always on touch screens (no hover).
const revealOnHover =
  "rounded opacity-0 transition hover:text-danger group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 pointer-coarse:opacity-100";

const noopSubscribe = () => () => {};

/** `false` on the server and during hydration; `true` afterwards. */
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
  const { m, intl } = useI18n();
  const t = m.boards.cardModal;
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

  // Native <dialog> with showModal(): the browser makes the rest of the page inert (Tab
  // does not escape to the board), focuses the first control and, on close, returns
  // focus to the card that opened it. A layout effect so close() runs before React
  // removes the node: if it is removed while open, focus is not restored.
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
    // The <dialog> fills the window and acts as the scroll container; the panel sits
    // inside. A click whose target is the <dialog> itself landed outside the panel.
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(e) => {
        // Escape: React closes it (unmounts), not the browser on its own.
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
            aria-label={m.common.actions.close}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Labels */}
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.labels}
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
                              t.labelToggleFailed,
                              "toggleCardLabel",
                            ),
                          );
                        })
                      }
                      style={{ background: labelBackground(l.color) }}
                      // No opacity-55 when unselected: it dropped the white text to
                      // ~2.2:1. The state shows through the ✓, the ring and aria-pressed.
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
                {t.noBoardLabels}
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
            <p className="mt-2 text-sm text-ink-muted">{t.noLabels}</p>
          )}
          {/* The warning sits next to what failed: the modal scrolls and one at the very
              top would go unseen. It clears as soon as another label change succeeds. */}
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

        {/* Assignees */}
        <AssigneesSection
          cardId={card.id}
          assignees={card.assignees}
          members={members}
          canEdit={canEdit}
        />

        {/* Description + due date */}
        {canEdit ? (
          <form action={detailsAction} className="mt-6 space-y-4">
            <input type="hidden" name="cardId" value={card.id} />
            <div>
              <label
                htmlFor={descId}
                className="block text-xs font-semibold uppercase tracking-wide text-ink-muted"
              >
                {t.description}
              </label>
              <Textarea
                id={descId}
                name="description"
                rows={4}
                maxLength={CARD_DESCRIPTION_MAX}
                // If it was not saved, it is refilled with what was sent: React resets
                // the form when the action ends and the text would otherwise be lost.
                defaultValue={details.description ?? card.description ?? ""}
                aria-describedby={details.error ? detailsErrorId : undefined}
                placeholder={t.descriptionPlaceholder}
                className="mt-2 resize-y"
              />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {t.dueDate}
                </span>
                <Input
                  type="date"
                  name="dueDate"
                  defaultValue={details.dueDate ?? dueValue}
                  className="mt-2 w-auto"
                />
              </label>
              <Button type="submit" variant="subtle" disabled={detailsPending}>
                {detailsPending ? m.common.actions.saving : t.saveChanges}
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
                {t.description}
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">
                {card.description || t.noDescription}
              </p>
            </div>
            {card.dueDate && (
              <p className="text-sm">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {t.dueDateInline}{" "}
                </span>
                <time dateTime={dueValue}>{formatDueDate(card.dueDate, intl)}</time>
              </p>
            )}
          </div>
        )}

        {/* Checklists */}
        <section className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.checklists}
            {total > 0 && (
              <span className="ml-1.5 font-normal normal-case tracking-normal">
                {fmt(t.checklistProgress, { done, total })}
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

        {/* Attachments */}
        <AttachmentsSection
          cardId={card.id}
          attachments={card.attachments}
          canEdit={canEdit}
        />

        {/* Comments */}
        <CommentsSection
          cardId={card.id}
          comments={card.comments}
          canEdit={canEdit}
          canManage={canManage}
          currentUserId={currentUserId}
        />

        {/* Delete (only for people who can edit) */}
        {canEdit && (
          <div className="mt-8 flex justify-end border-t border-border pt-4">
            <DeleteCardForm cardId={card.id} onDeleted={onClose} />
          </div>
        )}
      </div>
    </dialog>
  );
}

// Deleting is irreversible: the first click only asks for inline confirmation (no
// window.confirm, which blocks and does not follow the app's style).
function DeleteCardForm({
  cardId,
  onDeleted,
}: {
  cardId: string;
  onDeleted: () => void;
}) {
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const [confirming, setConfirming] = useState(false);
  const askRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // The pressed button disappears when the step changes: focus moves to the equivalent
  // control so the keyboard does not end up on <body>.
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
        {t.deleteCard}
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
      <span className="text-sm text-ink">{t.deleteCardPrompt}</span>
      <Button variant="danger" type="submit">
        {t.confirmDeleteCard}
      </Button>
      <Button
        ref={cancelRef}
        variant="subtle"
        type="button"
        onClick={() => setConfirming(false)}
      >
        {m.boards.confirm.no}
      </Button>
    </form>
  );
}

function NewLabelForm({ boardId }: { boardId: string }) {
  const { m } = useI18n();
  const t = m.boards.cardModal;
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
            aria-label={fmt(t.labelColor, { color: t.colors[k] })}
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
        placeholder={t.newLabel}
        aria-label={t.newLabelName}
        className={`${smallInput} min-w-32 flex-1`}
      />
      <Button type="submit" variant="subtle" className="px-3 py-1.5">
        {t.add}
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
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const itemRef = useRef<HTMLFormElement>(null);
  // Each checklist has its own error, so it shows next to the item that failed.
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
              {t.deleteChecklist}
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
                      t.itemToggleFailed,
                      "toggleChecklistItem",
                    ),
                  );
                })
              }
              disabled={!canEdit}
              aria-label={it.done ? t.markNotDone : t.markDone}
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
                  aria-label={t.deleteItem}
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
            placeholder={t.addItemPlaceholder}
            aria-label={fmt(t.newItemIn, { checklist: checklist.title })}
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
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const ref = useRef<HTMLFormElement>(null);
  const firstRender = useRef(true);
  const [state, action, pending] = useActionState<AttachmentState, FormData>(
    uploadAttachment,
    {},
  );

  // Clears the form after a successful upload (no error).
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
        {t.attachments}
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
                    aria-label={fmt(t.deleteAttachment, { filename: a.filename })}
                  >
                    ✕
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{t.noAttachments}</p>
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
            aria-label={t.attachFile}
            className="max-w-full text-sm text-ink-muted file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-border/40"
          />
          <Button type="submit" variant="subtle" disabled={pending}>
            {pending ? t.uploading : t.attach}
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
  const { m } = useI18n();
  const t = m.boards.cardModal;
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
        placeholder={t.newChecklist}
        aria-label={t.newChecklistTitle}
        className={`${smallInput} flex-1`}
      />
      <Button type="submit" variant="subtle">
        {t.addChecklist}
      </Button>
    </form>
  );
}

// Simple avatar: a circle with the name's initial. No images (we don't have any).
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
  const { m } = useI18n();
  const t = m.boards.cardModal;
  const assignedIds = new Set(assignees.map((a) => a.id));
  const unassigned = members.filter((m) => !assignedIds.has(m.id));

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t.assignees}
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
                    aria-label={fmt(t.unassign, { name: a.name })}
                  >
                    ✕
                  </button>
                </form>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">{t.nobodyAssigned}</p>
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
  const { m, intl } = useI18n();
  const t = m.boards.cardModal;
  const ref = useRef<HTMLFormElement>(null);
  // With ?card= the modal renders on the server, whose time zone is not the browser's:
  // the time is only painted after hydration to avoid a mismatch.
  const hydrated = useHydrated();

  return (
    <section className="mt-6">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        {t.comments}
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
                    {hydrated ? formatCommentTime(c.createdAt, intl) : ""}
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
                    aria-label={t.deleteComment}
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
          {t.noComments}
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
            placeholder={t.commentPlaceholder}
            aria-label={t.newComment}
            className="resize-y"
          />
          <div className="mt-2 flex justify-end">
            <Button type="submit" variant="subtle">
              {t.comment}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
