"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  type TwoFactorState,
} from "@/app/lib/actions/two-factor";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Feedback, Field } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";

// Forms of one's own two-step verification (docs/authentication.md). Recovery codes come
// back from the action and are shown here once; nothing keeps them afterwards.

function RecoveryCodes({ codes, done }: { codes: string[]; done?: boolean }) {
  const { m } = useI18n();
  const t = m.settings.twoFactor;
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-xl border border-success/30 bg-success/5 p-4">
      <p className="font-semibold">{t.codesTitle}</p>
      <p className="mt-1 text-sm text-ink-muted">{t.codesText}</p>
      <ol className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() =>
            navigator.clipboard?.writeText(codes.join("\n")).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? t.copied : t.copy}
        </Button>
        {done && (
          <Link
            href="/settings/security"
            className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
          >
            {t.done}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Step 2 of the setup: the first code from the app turns it on and returns the codes. */
export function ConfirmTwoFactorForm() {
  const { m } = useI18n();
  const t = m.settings.twoFactor;
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(confirmTwoFactorAction, {});
  if (state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} done />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Field label={t.step2}>
        <Input
          name="code"
          required
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          maxLength={7}
          placeholder="123 456"
          className="mt-1.5 max-w-48 font-mono text-lg tracking-widest"
        />
      </Field>
      <Feedback state={state} pending={pending} />
      <div>
        <Button type="submit" disabled={pending}>
          {t.confirm}
        </Button>
      </div>
    </form>
  );
}

export function RegenerateCodesForm() {
  const { m } = useI18n();
  const t = m.settings.twoFactor;
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(regenerateRecoveryCodesAction, {});
  if (state.recoveryCodes) return <RecoveryCodes codes={state.recoveryCodes} />;
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{t.regenerateText}</p>
      <Field label={t.password}>
        <Input name="password" type="password" required autoComplete="current-password" className="mt-1.5" />
      </Field>
      <Feedback state={state} pending={pending} />
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {t.regenerate}
        </Button>
      </div>
    </form>
  );
}

export function DisableTwoFactorForm() {
  const { m } = useI18n();
  const t = m.settings.twoFactor;
  const [state, action, pending] = useActionState<TwoFactorState, FormData>(disableTwoFactorAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{t.disableText}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t.password}>
          <Input name="password" type="password" required autoComplete="current-password" className="mt-1.5" />
        </Field>
        <Field label={t.code}>
          <Input name="code" required autoComplete="one-time-code" maxLength={20} className="mt-1.5 font-mono" />
        </Field>
      </div>
      <Feedback state={state} pending={pending} />
      <div>
        <Button type="submit" variant="dangerOutline" disabled={pending}>
          {t.disable}
        </Button>
      </div>
    </form>
  );
}
