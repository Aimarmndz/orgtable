"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword, type PasswordFormState } from "@/app/lib/actions/password";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState<PasswordFormState, FormData>(forgotPassword, {});
  const { m } = useI18n();
  const t = m.auth.forgot;

  if (state.sent) {
    return (
      <div className="w-full max-w-sm" role="status">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t.sentTitle}</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">
          {fmt(t.sent, { email: state.email ?? "" })}
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex rounded-lg border border-border bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:bg-surface-2"
        >
          {t.back}
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold tracking-tight">{t.title}</h1>
      <p className="mt-2 text-sm text-ink-muted">{t.subtitle}</p>
      {state.error && !pending && (
        <p
          role="alert"
          id="forgot-error"
          className="mt-5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <div className="mt-7 flex flex-col gap-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          {m.auth.fields.email}
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder={m.auth.fields.emailPlaceholder}
          defaultValue={state.email}
          aria-describedby={state.error ? "forgot-error" : undefined}
        />
      </div>
      <Button type="submit" disabled={pending} className="mt-6 w-full">
        {pending ? t.submitting : t.submit}
      </Button>
      <p className="mt-6 text-sm">
        <Link href="/login" className="font-semibold text-accent underline-offset-2 hover:underline">
          {t.back}
        </Link>
      </p>
    </form>
  );
}
