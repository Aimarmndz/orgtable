"use client";

import { useActionState } from "react";
import {
  createTeamAction,
  setTeamBoardAction,
  updateTeamAction,
  type TeamFormState,
} from "@/app/lib/actions/teams";
import { BOARD_COLORS, BOARD_COLOR_KEYS } from "@/app/lib/colors";
import { Button } from "@/app/components/ui/button";
import { Input, Textarea } from "@/app/components/ui/input";
import { Feedback, Field, LABEL } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";
import type { BoardRole } from "@/app/lib/roles";

// Forms of an organization's teams (docs/teams.md). The server decides; these only offer
// what the person may do and show the answer inline.

const BOARD_ROLES: BoardRole[] = ["VIEWER", "EDITOR", "OWNER"];

const COMPACT_SELECT =
  "h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25";

/** Name, colour and description of a team; creates one without `teamId`. */
export function TeamForm({
  workspaceId,
  team,
}: {
  workspaceId: string;
  team?: { id: string; name: string; color: string; description: string | null };
}) {
  const { m } = useI18n();
  const t = m.workspaces.teams;
  const [state, action, pending] = useActionState<TeamFormState, FormData>(
    team ? updateTeamAction : createTeamAction,
    {},
  );
  return (
    <form action={action}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {team && <input type="hidden" name="teamId" value={team.id} />}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Field label={t.name}>
          <Input name="name" required maxLength={60} defaultValue={team?.name} className="mt-1.5" />
        </Field>
        <fieldset>
          <legend className={LABEL}>{m.workspaces.rolesPage.color}</legend>
          <div className="mt-1.5 flex h-10 items-center gap-1.5">
            {BOARD_COLOR_KEYS.map((key) => (
              <label key={key} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={key}
                  defaultChecked={(team?.color ?? "teal") === key}
                  className="peer sr-only"
                  aria-label={m.workspaces.rolesPage.colors[key]}
                />
                <span
                  aria-hidden
                  className="block size-7 rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                  style={{ background: BOARD_COLORS[key] }}
                />
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t.description} className="sm:col-span-2">
          <Textarea name="description" rows={2} maxLength={200} defaultValue={team?.description ?? ""} className="mt-1.5" />
        </Field>
      </div>
      <Feedback state={state} pending={pending} />
      <div className="mt-4 flex justify-end">
        <Button type="submit" disabled={pending}>
          {team ? t.save : t.create}
        </Button>
      </div>
    </form>
  );
}

/**
 * Gives the team a role on a board: with `boardId` it changes that board's role (a select
 * that saves on its own button); without it, it picks a board from `boards` to add.
 */
export function TeamBoardForm({
  workspaceId,
  teamId,
  boardId,
  role,
  boards,
  label,
}: {
  workspaceId: string;
  teamId: string;
  boardId?: string;
  role?: BoardRole;
  boards?: { id: string; title: string }[];
  label: string;
}) {
  const { m } = useI18n();
  const t = m.workspaces.teams;
  const [state, action, pending] = useActionState<TeamFormState, FormData>(setTeamBoardAction, {});
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="teamId" value={teamId} />
      {boardId && <input type="hidden" name="boardId" value={boardId} />}
      <div className="flex items-center gap-1.5">
        {!boardId && boards && (
          <select name="boardId" required aria-label={t.pickBoard} className={`${COMPACT_SELECT} min-w-0 flex-1`}>
            <option value="">{t.pickBoard}</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        )}
        <select
          name="role"
          defaultValue={role ?? "EDITOR"}
          aria-label={label}
          className={COMPACT_SELECT}
        >
          {BOARD_ROLES.map((r) => (
            <option key={r} value={r}>
              {t.boardRoles[r]}
            </option>
          ))}
        </select>
        <Button type="submit" variant={boardId ? "outline" : "primary"} disabled={pending} className="h-9 px-3">
          {boardId ? m.workspaces.members.save : t.addBoard}
        </Button>
      </div>
      {state.error && !pending && (
        <p role="alert" className="text-xs text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}
