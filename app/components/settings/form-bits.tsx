"use client";

import type { ComponentProps, ReactNode } from "react";

// Small pieces shared by the settings forms: the inline answer of an action, a labelled
// field and an on/off switch. The switch is a real checkbox (keyboard, forms and screen
// readers work as usual), only drawn as a switch.

export type FormState = { error?: string; message?: string };

export const LABEL = "block text-xs font-semibold uppercase tracking-wide text-ink-muted";
export const SELECT =
  "mt-1.5 h-10 w-full rounded-lg border border-border bg-surface px-2.5 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25";

/** Error (alert) and success (status) messages of a form. */
export function Feedback({ state, pending }: { state: FormState; pending: boolean }) {
  return (
    <>
      {state.error && !pending && (
        <p role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <div role="status">
        {state.message && !pending && (
          <p className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        )}
      </div>
    </>
  );
}

export function Field({
  label,
  children,
  hint,
  className = "",
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

/** A checkbox drawn as a switch, with its label and an optional hint. */
export function Switch({
  label,
  hint,
  className = "",
  ...props
}: Omit<ComponentProps<"input">, "type"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label
      className={`flex items-start gap-3 py-2.5 ${props.disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"} ${className}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-muted">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" {...props} />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-ink/20 transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-5 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
      />
    </label>
  );
}
