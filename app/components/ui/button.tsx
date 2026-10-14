import type { ComponentProps } from "react";

// Button with a consistent set of variants across the app (see DESIGN.md).
// No "use client": it is presentation only, valid in both Server and Client Components.

const VARIANTS = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "text-danger hover:bg-danger/10",
  subtle: "bg-surface-2 text-ink hover:bg-border",
  // Settings and administration: actions that must be seen at a glance, with an outline
  // so they read as buttons and not as text (DESIGN.md, "Settings and administration").
  outline: "border border-ink/20 bg-surface text-ink shadow-sm hover:border-ink/35 hover:bg-surface-2",
  dangerOutline:
    "border border-danger/40 bg-surface text-danger shadow-sm hover:border-danger/70 hover:bg-danger/5",
  dangerSolid: "bg-danger text-white shadow-sm hover:bg-danger/90 dark:text-bg",
} as const;

type Props = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
};

export function Button({ variant = "primary", className = "", ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
