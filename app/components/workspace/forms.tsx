"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import {
  createEmployeeAction,
  createOrganizationAction,
  deleteOrganizationAction,
  resetEmployeePasswordAction,
  updateWorkspaceAction,
  type WorkspaceFormState,
} from "@/app/lib/actions/workspaces";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";
import type { WorkspaceRole } from "@/app/lib/roles";

// Forms of organizations and their members. Each one shows the action's answer inline
// (useActionState); the rules live on the server (app/lib/services/workspaces.ts), these
// only offer what the person may do.

const LABEL =
  "block text-xs font-semibold uppercase tracking-wide text-ink-muted";
const SELECT =
  "mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25";

/** Error (alert) and success (status) messages of a form. */
function Feedback({
  state,
  pending,
}: {
  state: WorkspaceFormState;
  pending: boolean;
}) {
  return (
    <>
      {state.error && !pending && (
        <p
          role="alert"
          className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <div role="status">
        {state.message && (
          <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        )}
      </div>
    </>
  );
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="text-sm">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && (
        <span className="mt-1 block text-xs text-ink-muted">{hint}</span>
      )}
    </label>
  );
}

/** Creates an organization (anyone with an account, free). */
export function CreateOrganizationForm() {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    createOrganizationAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.createOrg;
  return (
    <form action={action}>
      <p className="text-sm text-ink-muted">{t.intro}</p>
      <Feedback state={state} pending={pending} />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label={t.name}>
          <Input
            name="name"
            required
            maxLength={60}
            defaultValue={state.values?.name}
            className="mt-1.5"
          />
        </Field>
        <Field
          label={t.slug}
          hint={fmt(t.slugHint, { slug: state.values?.slug || "acme" })}
        >
          <Input
            name="slug"
            required
            minLength={3}
            maxLength={39}
            pattern="[a-z0-9](?:[a-z0-9\-]*[a-z0-9])?"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values?.slug}
            className="mt-1.5 font-mono"
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="mt-4">
        {t.submit}
      </Button>
    </form>
  );
}

/** An owner or admin creates an employee account with a role they may grant. */
export function CreateEmployeeForm({
  workspaceId,
  roles,
}: {
  workspaceId: string;
  roles: WorkspaceRole[];
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    createEmployeeAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.members;
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state.message]);
  return (
    <form
      ref={ref}
      action={action}
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 className="text-sm font-semibold">{t.createTitle}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.createText}</p>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Feedback state={state} pending={pending} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={t.name}>
          <Input
            name="name"
            required
            maxLength={60}
            defaultValue={state.values?.name}
            className="mt-1.5"
          />
        </Field>
        <Field label={t.email}>
          <Input
            name="email"
            type="email"
            required
            defaultValue={state.values?.email}
            className="mt-1.5"
          />
        </Field>
        <Field label={t.password}>
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1.5"
          />
        </Field>
        <Field label={t.role}>
          <select
            key={state.values?.role ?? "MEMBER"}
            name="role"
            defaultValue={state.values?.role ?? "MEMBER"}
            className={SELECT}
          >
            {roles.map((r) => (
              <option key={r} value={r}>
                {m.workspaces.roles[r]}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="mt-4">
        {t.create}
      </Button>
    </form>
  );
}

/** New password for an employee account the organization created. */
export function ResetEmployeePasswordForm({
  workspaceId,
  userId,
  name,
}: {
  workspaceId: string;
  userId: string;
  name: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    resetEmployeePasswordAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.members;
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state.message]);
  return (
    <form ref={ref} action={action} className="mt-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="userId" value={userId} />
      <div className="flex flex-wrap items-end gap-2">
        <Field label={fmt(t.resetTitle, { name })}>
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1.5 w-56"
          />
        </Field>
        <Button type="submit" variant="subtle" disabled={pending}>
          {t.resetSubmit}
        </Button>
      </div>
      <Feedback state={state} pending={pending} />
    </form>
  );
}

/** Name and address of the organization (owners). */
export function OrganizationSettingsForm({
  workspaceId,
  name,
  slug,
}: {
  workspaceId: string;
  name: string;
  slug: string;
}) {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    updateWorkspaceAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.settings;
  return (
    <form
      action={action}
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 className="text-sm font-semibold">{t.title}</h2>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Feedback state={state} pending={pending} />
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={t.name}>
          <Input
            name="name"
            required
            maxLength={60}
            defaultValue={state.values?.name ?? name}
            className="mt-1.5"
          />
        </Field>
        <Field
          label={t.slug}
          hint={fmt(m.workspaces.createOrg.slugHint, {
            slug: state.values?.slug || slug,
          })}
        >
          <Input
            name="slug"
            required
            minLength={3}
            maxLength={39}
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values?.slug ?? slug}
            className="mt-1.5 font-mono"
          />
        </Field>
      </div>
      <Button type="submit" disabled={pending} className="mt-4">
        {t.save}
      </Button>
    </form>
  );
}

/** Deletes the organization after typing its address (owners). */
export function DeleteOrganizationForm({
  workspaceId,
  slug,
}: {
  workspaceId: string;
  slug: string;
}) {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    deleteOrganizationAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.settings;
  return (
    <form
      action={action}
      className="rounded-xl border border-danger/30 bg-surface p-5"
    >
      <h2 className="text-sm font-semibold text-danger">{t.deleteTitle}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.deleteText}</p>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Feedback state={state} pending={pending} />
      <div className="mt-4 flex flex-wrap items-end gap-2">
        <Field label={fmt(t.deleteConfirm, { slug })}>
          <Input
            name="confirm"
            required
            autoComplete="off"
            spellCheck={false}
            className="mt-1.5 w-64 font-mono"
          />
        </Field>
        <Button type="submit" variant="danger" disabled={pending}>
          {t.deleteSubmit}
        </Button>
      </div>
    </form>
  );
}
