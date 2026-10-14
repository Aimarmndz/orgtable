"use client";

import Link from "next/link";
import { useActionState } from "react";
import { register, type RegisterState } from "@/app/lib/actions/register";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";

export function RegisterForm({
  operatorName,
  defaultType,
}: {
  operatorName: string;
  defaultType: "personal" | "organization";
}) {
  const [state, action, pending] = useActionState<RegisterState, FormData>(register, {});
  const invalid = (f: RegisterState["field"]) => (state.field === f && !pending) || undefined;
  const { m } = useI18n();
  const t = m.auth.register;
  const legalLink = (href: string, text: string) => (
    <Link href={href} className="font-medium text-accent underline underline-offset-2">
      {text}
    </Link>
  );

  return (
    // `group`: the organization fields show while its option is checked (CSS only, so it
    // works before hydration and without JavaScript).
    <form action={action} className="group w-full max-w-sm">
      <div className="flex items-center gap-2.5 lg:hidden">
        <span className="grid size-8 place-items-center rounded-lg bg-accent font-display text-lg font-extrabold text-accent-ink">
          o
        </span>
        <span className="font-display text-lg font-bold tracking-tight">orgtable</span>
      </div>

      <h1 className="mt-8 font-display text-3xl font-bold tracking-tight lg:mt-0">
        {t.title}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {rich(t.subtitle, {
          link: (c) => (
            <Link href="/login" className="font-semibold text-accent underline-offset-2 hover:underline">
              {c}
            </Link>
          ),
        })}
      </p>

      {/* Removed while submitting, so an identical second error is announced again. */}
      {state.error && !pending && (
        <p
          role="alert"
          id="register-error"
          className="mt-5 rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      )}

      <div className="mt-7 space-y-4">
        <fieldset>
          <legend className="text-sm font-medium">{t.typeLegend}</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {(["personal", "organization"] as const).map((type) => (
              <label
                key={type}
                className="flex cursor-pointer flex-col rounded-lg border border-border bg-surface p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40"
              >
                <span className="flex items-center gap-2 font-semibold">
                  <input
                    type="radio"
                    name="accountType"
                    value={type}
                    id={`type-${type}`}
                    defaultChecked={(state.values?.accountType ?? defaultType) === type}
                    className="accent-accent"
                  />
                  {t.types[type].title}
                </span>
                <span className="mt-1 text-xs text-ink-muted">{t.types[type].text}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="hidden space-y-4 rounded-lg border border-border p-3 group-has-[#type-organization:checked]:block">
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {t.organizationLegend}
          </legend>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="organizationName" className="text-sm font-medium">
              {m.workspaces.createOrg.name}
            </label>
            <Input
              id="organizationName"
              name="organizationName"
              maxLength={60}
              autoComplete="organization"
              defaultValue={state.values?.organizationName}
              aria-invalid={invalid("organizationName")}
              aria-describedby={invalid("organizationName") ? "register-error" : undefined}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="organizationSlug" className="text-sm font-medium">
              {m.workspaces.createOrg.slug}
            </label>
            <Input
              id="organizationSlug"
              name="organizationSlug"
              maxLength={39}
              autoCapitalize="none"
              spellCheck={false}
              className="font-mono"
              defaultValue={state.values?.organizationSlug}
              aria-invalid={invalid("organizationSlug")}
              aria-describedby={
                invalid("organizationSlug") ? "register-error org-slug-hint" : "org-slug-hint"
              }
            />
            <p id="org-slug-hint" className="text-xs text-ink-muted">
              {fmt(m.workspaces.createOrg.slugHint, {
                slug: state.values?.organizationSlug || "acme",
              })}
            </p>
          </div>
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            {m.auth.fields.name}
          </label>
          <Input
            id="name"
            name="name"
            required
            maxLength={60}
            autoComplete="name"
            defaultValue={state.values?.name}
            aria-invalid={invalid("name")}
            aria-describedby={invalid("name") ? "register-error" : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
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
            defaultValue={state.values?.email}
            aria-invalid={invalid("email")}
            aria-describedby={invalid("email") ? "register-error" : undefined}
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
            minLength={8}
            autoComplete="new-password"
            aria-invalid={invalid("password")}
            aria-describedby={invalid("password") ? "register-error password-hint" : "password-hint"}
          />
          <p id="password-hint" className="text-xs text-ink-muted">
            {t.passwordHint}
          </p>
        </div>

        {/* Honeypot for bots: off screen and out of the tab order. People neither see nor
            fill it; if it arrives with text, the sign-up is rejected. */}
        <div aria-hidden="true" className="absolute -left-[10000px] size-px overflow-hidden">
          <label htmlFor="website">{t.honeypot}</label>
          <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
        </div>

        <label className="flex items-start gap-2.5 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="acceptTerms"
            required
            className="mt-1 size-4 shrink-0 accent-accent"
            aria-invalid={invalid("acceptTerms")}
          />
          <span>
            {rich(t.acceptTerms, {
              privacy: (c) => legalLink("/legal/privacy", c),
              terms: (c) => legalLink("/legal/terms", c),
            })}
          </span>
        </label>
      </div>

      <Button type="submit" disabled={pending} className="mt-7 w-full">
        {pending ? t.submitting : t.submit}
      </Button>

      {/* First layer of information (art. 13 GDPR): the essentials next to the form, the
          rest in the policy linked above. */}
      <p className="mt-5 text-xs leading-relaxed text-ink-muted">
        {fmt(t.firstLayer, { operator: operatorName })}
      </p>
    </form>
  );
}
