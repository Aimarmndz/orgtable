"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { createUser, type CreateUserState } from "@/app/lib/actions/admin";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

// Account creation by an administrator. useActionState gives inline feedback; the form
// is cleared after a successful creation. See app/lib/actions/admin.ts.
export function CreateUserForm() {
  const ref = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const [state, action, pending] = useActionState<CreateUserState, FormData>(
    createUser,
    {},
  );
  const { m } = useI18n();
  const t = m.admin.users.create;

  // Clear the form when the creation succeeds (a message arrives).
  useEffect(() => {
    if (state.message) ref.current?.reset();
  }, [state.message]);

  return (
    <form
      ref={ref}
      action={action}
      className="rounded-xl border border-border bg-surface p-5"
    >
      <h2 className="text-sm font-semibold">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-muted">{t.intro}</p>

      {/* role="alert" so screen readers announce it. Removed while submitting, so a
          second identical error is inserted and announced again. */}
      {state.error && !pending && (
        <p
          id={errorId}
          role="alert"
          className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      {/* Always-mounted region: screen readers only announce changes inside a
          role="status" that existed before the message. */}
      <div role="status">
        {state.message && (
          <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.name}
          </span>
          <Input
            name="name"
            required
            maxLength={60}
            defaultValue={state.values?.name}
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.email}
          </span>
          <Input
            name="email"
            type="email"
            required
            defaultValue={state.values?.email}
            aria-invalid={state.field === "email" || undefined}
            aria-describedby={state.field === "email" && !pending ? errorId : undefined}
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.password}
          </span>
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.role}
          </span>
          {/* React resets the form to its defaults after the action but does not update
              the defaultValue of a mounted <select>: the key remounts it with the chosen
              value so it is not lost (e.g. Administrator). */}
          <select
            key={state.values?.role ?? "MEMBER"}
            name="role"
            defaultValue={state.values?.role ?? "MEMBER"}
            className="mt-1.5 h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            <option value="MEMBER">{m.admin.roles.MEMBER}</option>
            <option value="ADMIN">{m.admin.roles.ADMIN}</option>
          </select>
        </label>
      </div>

      <Button type="submit" disabled={pending} className="mt-4">
        {pending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
