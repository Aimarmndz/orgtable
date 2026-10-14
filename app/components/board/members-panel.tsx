"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import {
  addBoardMember,
  updateBoardMemberRole,
  removeBoardMember,
  type MemberActionState,
} from "@/app/lib/actions/members";
import { ASSIGNABLE_BOARD_ROLES, type BoardRole } from "@/app/lib/roles";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

export type BoardMemberDTO = {
  id: string;
  name: string;
  email: string;
  role: BoardRole;
  isOwner: boolean;
};

// Board members panel. Everyone can open it; only the owner gets the controls. Inviting
// uses useActionState (inline feedback); changing a role and removing use plain forms
// (the server handles authorization). See docs/authorization.md.
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
  const { m } = useI18n();
  const t = m.boards.members;
  const [state, action, pending] = useActionState<MemberActionState, FormData>(
    addBoardMember,
    {},
  );

  // Role the select remounts with after an error. `values.role` is what was sent,
  // unvalidated: it is only reused if it is an assignable role; otherwise the default.
  const inviteRole =
    ASSIGNABLE_BOARD_ROLES.find((r) => r === state.values?.role) ?? "EDITOR";

  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  // Native <dialog> opened with showModal(): the browser moves focus inside, traps it
  // (the rest of the page becomes inert) and Escape fires `cancel`. On unmount it is
  // closed and focus is returned by hand to whoever had it, because the browser does not
  // restore it if the <dialog> is removed from the DOM instead of being closed.
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
        // The parent decides on closing (it unmounts the panel), so no closed <dialog>
        // stays mounted.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // The <dialog> has no padding: a click whose target is the <dialog> itself can
        // only come from the backdrop (::backdrop).
        if (e.target === e.currentTarget) onClose();
      }}
      className="mx-auto mt-8 max-h-[calc(100dvh-4rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface text-ink shadow-[0_32px_64px_-24px_oklch(0.27_0.022_52/0.45)] backdrop:bg-black/50 backdrop:motion-safe:animate-[overlay-in_150ms_ease-out] sm:mt-12"
      style={{ animation: "dialog-in 180ms ease-out" }}
    >
      <div className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="font-display text-xl font-bold leading-snug tracking-tight"
            >
              {t.title}
            </h2>
            <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
              {canManage ? t.descriptionManage : t.descriptionView}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={m.common.actions.close}
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        {/* Invite (owner only) */}
        {canManage && (
        <form action={action} className="mt-5">
          <input type="hidden" name="boardId" value={boardId} />
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t.email}
              </span>
              <Input
                name="email"
                type="email"
                required
                defaultValue={state.values?.email}
                placeholder={t.emailPlaceholder}
                className="mt-1.5"
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {t.role}
              </span>
              {/* React resets the form to its default values after the action, but does
                  not update the defaultValue of an already mounted <select>: the key
                  remounts it with the chosen role so an error does not turn "Viewer" back
                  into "Editor" and the next invite grants more access than intended. */}
              <select
                key={inviteRole}
                name="role"
                defaultValue={inviteRole}
                className="mt-1.5 h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
              >
                {ASSIGNABLE_BOARD_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {m.boards.roles[r]}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" disabled={pending}>
              {pending ? t.inviting : t.invite}
            </Button>
          </div>
          {/* role="alert" so the screen reader announces it. It is removed while
              submitting, so a second identical error is inserted and announced again. */}
          {state.error && !pending && (
            <p
              role="alert"
              className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {state.error}
            </p>
          )}
          {/* Live region always mounted: screen readers only announce changes inside a
              region that already existed. */}
          <div role="status">
            {state.message && (
              <p className="mt-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
                {state.message}
              </p>
            )}
          </div>
        </form>
        )}

        {/* Member list */}
        <ul className="mt-6 divide-y divide-border">
          {members.map((member) => (
            <li key={member.id} className="flex items-center gap-3 py-3">
              <div className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold uppercase">
                {member.name.charAt(0)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-ink-muted">{member.email}</p>
              </div>

              {member.isOwner || !canManage ? (
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-muted">
                  {m.boards.roles[member.role]}
                </span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <form action={updateBoardMemberRole}>
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="userId" value={member.id} />
                    <select
                      name="role"
                      defaultValue={member.role}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()}
                      className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-ink outline-none focus-visible:border-accent"
                      aria-label={fmt(t.roleOf, { name: member.name })}
                    >
                      {ASSIGNABLE_BOARD_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {m.boards.roles[r]}
                        </option>
                      ))}
                    </select>
                  </form>
                  <form action={removeBoardMember}>
                    <input type="hidden" name="boardId" value={boardId} />
                    <input type="hidden" name="userId" value={member.id} />
                    <button
                      className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
                      aria-label={fmt(t.remove, { name: member.name })}
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
