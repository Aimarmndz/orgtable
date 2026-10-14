"use client";

import { useActionState, useRef, useState } from "react";
import { createApiToken, type CreateTokenState } from "@/app/lib/actions/tokens";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt, plural } from "@/app/i18n/format";

// Creates an API token. useActionState returns the token IN CLEAR exactly once; it is
// shown with a copy button and a warning that it won't be shown again.
export function CreateTokenForm() {
  const [state, action, pending] = useActionState<CreateTokenState, FormData>(
    createApiToken,
    {},
  );
  const { m, intl } = useI18n();
  const t = m.settings.tokens;
  // The copy result is tied to the token it refers to: creating another token resets it
  // to "idle" without an effect.
  const [copy, setCopy] = useState<{
    token: string;
    status: "copied" | "error";
  } | null>(null);
  const copyStatus =
    copy && copy.token === state.token ? copy.status : "idle";
  const codeRef = useRef<HTMLElement>(null);

  const copyToken = async () => {
    const token = state.token;
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopy({ token, status: "copied" });
      setTimeout(() => setCopy(null), 2000);
    } catch {
      // Over http (insecure context) the clipboard is missing or refused. The token is
      // only shown once, so warn and leave it selected to copy by hand. The token is
      // never logged.
      setCopy({ token, status: "error" });
      if (codeRef.current) {
        window.getSelection()?.selectAllChildren(codeRef.current);
      }
    }
  };

  return (
    <div>
      {/* The box always exists (unstyled until there is a token) so the role="status"
          region is mounted before the message. That region only holds the short text:
          if it wrapped the token and the button, screen readers would read the whole
          token every time it changed (e.g. when switching to "Copied"). */}
      <div
        className={
          state.token
            ? "mb-4 rounded-xl border border-success/30 bg-success/10 p-4"
            : undefined
        }
      >
        <div role="status">
          {state.token && (
            <>
              <p className="text-sm font-medium">
                {fmt(t.form.created, { name: state.name ?? "" })}
              </p>
              <p className="mt-1 text-xs text-ink-muted">{t.form.copyNow}</p>
            </>
          )}
        </div>
        {state.token && (
          <div className="mt-2 flex items-stretch gap-2">
            <code
              ref={codeRef}
              className="min-w-0 flex-1 select-all overflow-x-auto rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs"
            >
              {state.token}
            </code>
            <Button
              type="button"
              variant="subtle"
              onClick={copyToken}
              className="shrink-0"
            >
              {copyStatus === "copied" ? t.form.copied : t.form.copy}
            </Button>
          </div>
        )}
        {/* Sibling of the role="status" region, not a child: two nested live regions
            may announce the message twice. */}
        {state.token && copyStatus === "error" && (
          <p role="alert" className="mt-2 text-xs text-danger">
            {t.form.copyFailed}
          </p>
        )}
      </div>

      <form action={action} className="flex flex-wrap items-end gap-2">
        <label className="min-w-48 flex-1 text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.form.name}
          </span>
          <Input
            name="name"
            required
            maxLength={60}
            placeholder={t.form.namePlaceholder}
            defaultValue={state.values?.name}
            className="mt-1.5"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.form.scope}
          </span>
          {/* After an error the choice is kept. The key remounts the <select>: React does
              not update the defaultValue of a mounted one, and the form's automatic
              reset would bring it back to the initial value. */}
          <select
            key={state.values?.scope ?? "full"}
            name="scope"
            defaultValue={state.values?.scope ?? "full"}
            className="mt-1.5 h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            <option value="full">{t.scopeFull}</option>
            <option value="read">{t.scopeRead}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.form.expiry}
          </span>
          <select
            key={state.values?.expiry ?? "0"}
            name="expiry"
            defaultValue={state.values?.expiry ?? "0"}
            className="mt-1.5 h-9 rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
          >
            <option value="0">{t.form.expiryNever}</option>
            <option value="30">{plural(intl, t.form.expiryDays, 30)}</option>
            <option value="90">{plural(intl, t.form.expiryDays, 90)}</option>
            <option value="365">{t.form.expiryYear}</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? t.form.submitting : t.form.submit}
        </Button>
      </form>

      {/* role="alert" so screen readers announce it. Removed while submitting, so a
          second identical error is inserted and announced again. */}
      {state.error && !pending && (
        <p
          role="alert"
          className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
