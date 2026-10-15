"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import {
  createEmployeeAction,
  createOrganizationAction,
  deleteOrganizationAction,
  resetEmployeePasswordAction,
  updateWorkspaceAction,
  updateHandleAction,
  type WorkspaceFormState,
} from "@/app/lib/actions/workspaces";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt, plural } from "@/app/i18n/format";

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
  invite,
  heading = true,
}: {
  workspaceId: string;
  // The role picker: base roles, plus "custom:<id>" entries for custom roles.
  roles: { value: string; label: string }[];
  // Email is on: the person chooses their own password from an invitation (docs/email.md).
  invite: boolean;
  // false when the page's own header already names the form.
  heading?: boolean;
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
      className="rounded-2xl border border-ink/15 bg-surface p-6 shadow-[0_12px_32px_-18px_oklch(0.27_0.022_52/0.35)]"
    >
      <div className={heading ? "flex items-start gap-3.5" : "sr-only"}>
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent/12 text-accent"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-5">
            <circle cx="10" cy="8" r="4" />
            <path d="M3 21c.7-4 3.5-6 7-6 1.3 0 2.5.3 3.5.8M18 14v6M15 17h6" />
          </svg>
        </span>
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">{t.createTitle}</h2>
          <p className="mt-1 text-sm text-ink-muted">{invite ? t.createTextInvite : t.createText}</p>
        </div>
      </div>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Feedback state={state} pending={pending} />
      <div className={`mt-5 grid gap-4 ${invite ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <Field label={t.name}>
          <Input name="name" required maxLength={60} defaultValue={state.values?.name} className="mt-1.5" />
        </Field>
        <Field label={t.email}>
          <Input name="email" type="email" required defaultValue={state.values?.email} className="mt-1.5" />
        </Field>
        {!invite && (
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
        )}
        <Field label={t.role}>
          <select
            key={state.values?.role ?? "MEMBER"}
            name="role"
            defaultValue={state.values?.role ?? "MEMBER"}
            className={SELECT}
          >
            {roles.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {invite ? t.createInvite : t.create}
        </Button>
      </div>
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
    <form ref={ref} action={action}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="userId" value={userId} />
      <Field label={fmt(t.resetTitle, { name })}>
        <Input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1.5"
        />
      </Field>
      <Button type="submit" variant="outline" disabled={pending} className="mt-3 w-full">
        {t.resetSubmit}
      </Button>
      <Feedback state={state} pending={pending} />
    </form>
  );
}

/** Name and address of the organization (owners). */
export function OrganizationSettingsForm({
  workspaceId,
  name,
  slug,
  host,
}: {
  workspaceId: string;
  name: string;
  slug: string;
  // The address in front of the slug, so the person sees the whole URL they are editing.
  host: string;
}) {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    updateWorkspaceAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.settings;
  const g = m.workspaces.general;
  return (
    <form action={action} className="rounded-2xl border border-border bg-surface p-6">
      <h2 className="font-display text-lg font-bold tracking-tight">{g.identity}</h2>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Feedback state={state} pending={pending} />
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label={t.name}>
          <Input
            name="name"
            required
            maxLength={60}
            defaultValue={state.values?.name ?? name}
            className="mt-1.5"
          />
        </Field>
        <label className="text-sm">
          <span className={LABEL}>{t.slug}</span>
          <span className="mt-1.5 flex h-[38px] overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
            <span className="flex items-center border-r border-border bg-surface-2 px-2.5 font-mono text-xs text-ink-muted">
              {host}/
            </span>
            <input
              name="slug"
              required
              minLength={3}
              maxLength={39}
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={state.values?.slug ?? slug}
              className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm text-ink outline-none"
            />
          </span>
        </label>
      </div>
      <p className="mt-3 text-sm text-ink-muted">{g.addressHint}</p>
      <div className="mt-5 flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}

/** Deletes the organization after typing its address (owners). */
export function DeleteOrganizationForm({
  workspaceId,
  slug,
  boards,
}: {
  workspaceId: string;
  slug: string;
  boards: number;
}) {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    deleteOrganizationAction,
    {},
  );
  const { m, intl } = useI18n();
  const t = m.workspaces.settings;
  return (
    <form action={action} className="flex flex-wrap items-end gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="min-w-0 flex-[1_1_18rem]">
        <p className="font-semibold">{t.deleteTitle}</p>
        <p className="mt-1 text-sm text-ink-muted">
          {plural(intl, m.workspaces.general.deleteBoards, boards)}
        </p>
        <Feedback state={state} pending={pending} />
        <label className="mt-3 block text-sm">
          <span className="font-semibold">{fmt(t.deleteConfirm, { slug })}</span>
          <Input
            name="confirm"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder={slug}
            className="mt-1.5 max-w-80 font-mono"
          />
        </label>
      </div>
      <Button type="submit" variant="dangerSolid" disabled={pending} className="min-h-10">
        {t.deleteSubmit}
      </Button>
    </form>
  );
}

/** The person's handle: the address of their personal boards. */
export function HandleForm({ slug, host }: { slug: string; host: string }) {
  const [state, action, pending] = useActionState<WorkspaceFormState, FormData>(
    updateHandleAction,
    {},
  );
  const { m } = useI18n();
  const t = m.workspaces.handle;
  return (
    <form action={action} className="space-y-3 border-t border-border pt-5">
      <label className="block text-sm">
        <span className="font-medium">{t.label}</span>
        <span className="mt-1.5 flex h-[38px] max-w-md overflow-hidden rounded-lg border border-border bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
          <span className="flex items-center border-r border-border bg-surface-2 px-2.5 font-mono text-xs text-ink-muted">
            {host}/
          </span>
          <input
            name="slug"
            required
            minLength={3}
            maxLength={39}
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={state.values?.slug ?? slug}
            className="min-w-0 flex-1 bg-transparent px-2.5 font-mono text-sm text-ink outline-none"
          />
        </span>
        <span className="mt-1.5 block text-xs text-ink-muted">{t.hint}</span>
      </label>
      <Feedback state={state} pending={pending} />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}
