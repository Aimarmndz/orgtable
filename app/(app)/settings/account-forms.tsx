"use client";

import { useActionState, useId } from "react";
import {
  changePassword,
  deleteAccount,
  updateProfile,
  type AccountFormState,
} from "@/app/lib/actions/account";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

// Forms for your own account in /settings. Each uses useActionState: the action returns
// an error (with the field it refers to) or a success message.

/** Form error (role="alert") or confirmation (role="status"). */
function FormFeedback({
  state,
  pending,
  id,
}: {
  state: AccountFormState;
  pending: boolean;
  id: string;
}) {
  // Removed while submitting, so a second identical error is announced again.
  if (pending) return <div role="status" id={id} />;
  if (state.error) {
    return (
      <p
        role="alert"
        id={id}
        className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
      >
        {state.error}
      </p>
    );
  }
  return (
    <div role="status" id={id}>
      {state.message && (
        <p className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: (ids: { inputId: string; hintId?: string }) => React.ReactNode;
}) {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      {children({ inputId, hintId: hint ? hintId : undefined })}
      {hint && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function describedBy(...ids: (string | undefined | false)[]): string | undefined {
  const list = ids.filter(Boolean).join(" ");
  return list || undefined;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    updateProfile,
    {},
  );
  const { m } = useI18n();
  const t = m.settings.profile;
  const feedbackId = useId();
  const bad = (f: string) => (!pending && state.field === f) || undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.name}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="name"
              required
              maxLength={60}
              autoComplete="name"
              defaultValue={state.values?.name ?? name}
              aria-invalid={bad("name")}
              aria-describedby={describedBy(bad("name") && feedbackId)}
            />
          )}
        </Field>
        <Field label={t.email}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              defaultValue={state.values?.email ?? email}
              aria-invalid={bad("email")}
              aria-describedby={describedBy(bad("email") && feedbackId)}
            />
          )}
        </Field>
      </div>
      <Field label={t.currentPassword} hint={t.currentPasswordHint}>
        {({ inputId, hintId }) => (
          <Input
            id={inputId}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            className="sm:max-w-xs"
            aria-invalid={bad("currentPassword")}
            aria-describedby={describedBy(hintId, bad("currentPassword") && feedbackId)}
          />
        )}
      </Field>
      <FormFeedback state={state} pending={pending} id={feedbackId} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? m.common.actions.saving : t.save}
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    changePassword,
    {},
  );
  const t = useI18n().m.settings.security;
  const feedbackId = useId();
  const bad = (f: string) => (!pending && state.field === f) || undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t.currentPassword}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={bad("currentPassword")}
              aria-describedby={describedBy(bad("currentPassword") && feedbackId)}
            />
          )}
        </Field>
        <Field label={t.newPassword} hint={t.newPasswordHint}>
          {({ inputId, hintId }) => (
            <Input
              id={inputId}
              name="newPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              aria-invalid={bad("newPassword")}
              aria-describedby={describedBy(hintId, bad("newPassword") && feedbackId)}
            />
          )}
        </Field>
        <Field label={t.confirmPassword}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              aria-invalid={bad("confirmPassword")}
              aria-describedby={describedBy(bad("confirmPassword") && feedbackId)}
            />
          )}
        </Field>
      </div>
      <FormFeedback state={state} pending={pending} id={feedbackId} />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    deleteAccount,
    {},
  );
  const t = useI18n().m.settings.data.delete;
  const feedbackId = useId();
  const bad = !pending && state.field === "password";

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label={t.confirmPassword}>
            {({ inputId }) => (
              <Input
                id={inputId}
                name="password"
                type="password"
                required
                autoComplete="current-password"
                aria-invalid={bad || undefined}
                aria-describedby={bad ? feedbackId : undefined}
              />
            )}
          </Field>
        </div>
        <Button
          type="submit"
          disabled={pending}
          className="bg-danger text-accent-ink hover:bg-danger/90"
        >
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
      <FormFeedback state={state} pending={pending} id={feedbackId} />
    </form>
  );
}
