import type { ReactNode } from "react";

// Header and cards shared by every settings and administration page (DESIGN.md, "Settings
// and administration"): the address in mono, a large title, one sentence of what the page
// is for, and the page's main action on the right. No "use client": presentation only.

export function PageHeader({
  address,
  title,
  description,
  action,
}: {
  address?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="min-w-0 flex-[1_1_20rem]">
        {address && <p className="font-mono text-xs text-ink-muted">{address}</p>}
        <h1 className="mt-1.5 font-display text-3xl font-extrabold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-prose text-[15px] text-ink-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** A titled card: the building block of every settings page. */
export function SettingsCard({
  id,
  title,
  description,
  aside,
  children,
  tone = "default",
}: {
  id?: string;
  title?: string;
  description?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  tone?: "default" | "danger";
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title ? titleId : undefined}
      className={
        tone === "danger"
          ? "rounded-2xl border-[1.5px] border-danger/40 bg-danger/[0.04] p-5 sm:p-6"
          : "rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_oklch(0.27_0.022_52/0.04)] sm:p-6"
      }
    >
      {(title || aside) && (
        <div className={`flex flex-wrap items-start gap-3 ${children ? "mb-4" : ""}`}>
          <div className="min-w-0 flex-[1_1_16rem]">
            {title && (
              <h2
                id={titleId}
                className={`font-display text-lg font-bold tracking-tight ${tone === "danger" ? "text-danger" : ""}`}
              >
                {title}
              </h2>
            )}
            {description && <p className="mt-1 max-w-prose text-sm text-ink-muted">{description}</p>}
          </div>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

/** The column every settings page sits in. */
export function SettingsPage({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className={`mx-auto flex w-full flex-col gap-5 p-5 sm:p-8 lg:p-10 ${wide ? "max-w-5xl" : "max-w-3xl"}`}
    >
      {children}
    </div>
  );
}
