"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { verifyLoginCode, type VerifyState } from "@/app/lib/actions/auth";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

export function VerifyCodeForm() {
  const [state, action, pending] = useActionState<VerifyState, FormData>(verifyLoginCode, {});
  const [recovery, setRecovery] = useState(false);
  const { m } = useI18n();
  const t = m.auth.verify;
  return (
    <form action={action} className="w-full max-w-sm">
      <h1 className="font-display text-3xl font-bold tracking-tight">{t.title}</h1>
      <p className="mt-2 text-sm text-ink-muted">{recovery ? t.recoverySubtitle : t.subtitle}</p>
      {state.error && !pending && (
        <p
          role="alert"
          id="verify-error"
          className="mt-5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
      <div className="mt-7 flex flex-col gap-1.5">
        <label htmlFor="code" className="text-sm font-medium">
          {recovery ? t.recoveryLabel : t.codeLabel}
        </label>
        <Input
          key={recovery ? "recovery" : "totp"}
          id="code"
          name="code"
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={recovery ? "text" : "numeric"}
          pattern={recovery ? undefined : "[0-9 ]{6,7}"}
          maxLength={recovery ? 20 : 7}
          spellCheck={false}
          autoCapitalize="none"
          placeholder={recovery ? "abcde-fghij" : "123 456"}
          className="font-mono text-lg tracking-widest"
          aria-describedby={state.error ? "verify-error" : undefined}
        />
      </div>
      <Button type="submit" disabled={pending} className="mt-6 w-full">
        {pending ? t.submitting : t.submit}
      </Button>
      <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
        <button
          type="button"
          onClick={() => setRecovery((v) => !v)}
          className="font-semibold text-accent underline-offset-2 hover:underline"
        >
          {recovery ? t.useApp : t.useRecovery}
        </button>
        <Link href="/login" className="text-ink-muted underline-offset-2 hover:underline">
          {t.back}
        </Link>
      </div>
    </form>
  );
}
