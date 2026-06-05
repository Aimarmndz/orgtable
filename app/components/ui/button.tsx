import type { ComponentProps } from "react";

// Botón con vocabulario de variantes consistente en toda la app (ver DESIGN.md).
// Sin "use client": es solo presentación, válido en componentes de servidor y cliente.

const VARIANTS = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  ghost: "text-ink-muted hover:bg-surface-2 hover:text-ink",
  danger: "text-danger hover:bg-danger/10",
  subtle: "bg-surface-2 text-ink hover:bg-border",
} as const;

type Props = ComponentProps<"button"> & {
  variant?: keyof typeof VARIANTS;
};

export function Button({ variant = "primary", className = "", ...props }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
