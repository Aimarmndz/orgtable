"use client";

import { useActionState } from "react";
import { login, type AuthState } from "@/app/lib/actions/auth";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

export function LoginForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    {},
  );
  const { m } = useI18n();
  const t = m.auth.login;

  return (
    <form action={action} className="w-full max-w-sm">
      {/* Compact brand mark (mostly for mobile, where there is no side panel). */}
      <div className="flex items-center gap-2.5 lg:hidden">
        <span className="grid size-8 place-items-center rounded-lg bg-accent font-display text-lg font-extrabold text-accent-ink">
          o
        </span>
        <span className="font-display text-lg font-bold tracking-tight">
          orgtable
        </span>
      </div>

      <h1 className="mt-8 font-display text-3xl font-bold tracking-tight lg:mt-0">
        {t.title}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {t.subtitle}
      </p>

      {/* role="alert" so screen readers announce it. It is removed while submitting, so an
          identical second error is inserted again and announced again. */}
      {state.error && !pending && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="mt-7 space-y-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            {m.auth.fields.email}
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={m.auth.fields.emailPlaceholder}
            defaultValue={state.values?.email}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-medium">
            {m.auth.fields.password}
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </div>
      </div>

      <Button type="submit" disabled={pending} className="mt-7 w-full">
        {pending ? (
          t.submitting
        ) : (
          <>
            {t.submit}
            <svg
              className="size-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </>
        )}
      </Button>
    </form>
  );
}
