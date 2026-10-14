"use client";

import { useActionState } from "react";
import { completeSetup, type SetupState } from "@/app/lib/actions/setup";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(
    completeSetup,
    {},
  );
  const { m } = useI18n();
  const t = m.auth.setup;

  return (
    <form
      action={action}
      className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 shadow-[0_24px_48px_-24px_oklch(0.27_0.022_52/0.25)]"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-accent font-display text-lg font-extrabold text-accent-ink">
          o
        </span>
        <span className="font-display text-lg font-bold tracking-tight">
          orgtable
        </span>
      </div>

      <h1 className="mt-7 font-display text-2xl font-bold tracking-tight">
        {t.title}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t.subtitle}
      </p>

      {/* role="alert" so screen readers announce it. It is removed while submitting, so an
          identical second error is inserted again and announced again. */}
      {state.error && !pending && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t.instanceLegend}
        </legend>
        <label className="mt-3 block text-sm font-medium">
          {t.instanceName}
          <Input
            name="instanceName"
            type="text"
            required
            maxLength={60}
            placeholder={t.instanceNamePlaceholder}
            defaultValue={state.values?.instanceName}
            className="mt-1.5"
          />
        </label>
      </fieldset>

      <fieldset className="mt-6">
        <legend className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {t.adminLegend}
        </legend>
        <div className="mt-3 space-y-4">
          <label className="block text-sm font-medium">
            {t.yourName}
            <Input
              name="name"
              type="text"
              required
              maxLength={60}
              autoComplete="name"
              defaultValue={state.values?.name}
              className="mt-1.5"
            />
          </label>
          <label className="block text-sm font-medium">
            {m.auth.fields.email}
            <Input
              name="email"
              type="email"
              required
              autoComplete="email"
              defaultValue={state.values?.email}
              className="mt-1.5"
            />
          </label>
          <label className="block text-sm font-medium">
            {m.auth.fields.password}
            <Input
              name="password"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1.5"
            />
            <span className="mt-1 block text-xs text-ink-muted">
              {t.passwordHint}
            </span>
          </label>
        </div>
      </fieldset>

      <Button type="submit" disabled={pending} className="mt-6 w-full">
        {pending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
