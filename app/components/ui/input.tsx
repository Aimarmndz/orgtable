import type { ComponentProps } from "react";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return (
    <input
      className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 ${className}`}
      {...props}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: ComponentProps<"textarea">) {
  return (
    <textarea
      className={`w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 ${className}`}
      {...props}
    />
  );
}
