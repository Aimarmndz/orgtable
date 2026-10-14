"use client";

import { useActionState } from "react";
import { resetPasswordWithToken, type PasswordFormState } from "@/app/lib/actions/password";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

export function ResetPasswordForm({
  token,
  title,
  subtitle,
}: {
  token: string;
  title: string;
  subtitle: string;
}) {
  const [state, action, pending] = useActionState<PasswordFormState, FormData>(
    resetPasswordWithToken,
    {},
  );
  const { m } = useI18n();
  const t = m.auth.reset;
  return (
    <form action={action} className="w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-ink-muted">{subtitle}</p>
      <input type="hidden" name="token" value={token} />
      {state.error && !pending && (
        <p
          role="alert"
          id="reset-error"
          className="mt-5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <div className="mt-7 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            {t.password}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            aria-describedby="reset-hint"
          />
          <p id="reset-hint" className="text-xs text-ink-muted">
            {t.hint}
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-sm font-medium">
            {t.confirm}
          </label>
          <Input id="confirm" name="confirm" type="password" required minLength={8} autoComplete="new-password" />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="mt-7 w-full">
        {pending ? t.submitting : t.submit}
      </Button>
    </form>
  );
}
