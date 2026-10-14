"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import {
  saveInstanceSettings,
  type InstanceSettingsState,
} from "@/app/lib/actions/instance";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { rich } from "@/app/i18n/rich";
import type { Messages } from "@/app/i18n/config";

type Values = {
  instanceName: string;
  registrationOpen: boolean;
  operatorName: string;
  operatorEmail: string;
  operatorLegalId: string;
  operatorAddress: string;
  hostingDescription: string;
  backupRetentionDays: string;
};

type LegalText = Messages["admin"]["instance"]["legal"];

// Labels come from m.admin.instance.legal.fields[name]; hint and placeholder pick their
// message from the legal texts.
const LEGAL_FIELDS: {
  name: keyof LegalText["fields"];
  type?: string;
  autoComplete?: string;
  placeholder?: (t: LegalText) => string;
  hint: (t: LegalText) => string;
  maxLength: number;
}[] = [
  {
    name: "operatorName",
    autoComplete: "organization",
    maxLength: 120,
    hint: (t) => t.requiredToOpen,
  },
  {
    name: "operatorEmail",
    type: "email",
    autoComplete: "email",
    maxLength: 254,
    hint: (t) => t.requiredToOpen,
  },
  { name: "operatorLegalId", maxLength: 40, hint: (t) => t.optional },
  {
    name: "operatorAddress",
    autoComplete: "street-address",
    maxLength: 200,
    hint: (t) => t.optional,
  },
  {
    name: "hostingDescription",
    placeholder: (t) => t.hostingPlaceholder,
    maxLength: 200,
    hint: (t) => t.hostingHint,
  },
  {
    name: "backupRetentionDays",
    type: "number",
    maxLength: 4,
    hint: (t) => t.backupHint,
  },
];

export function InstanceSettingsForm({ initial }: { initial: Values }) {
  const [state, action, pending] = useActionState<InstanceSettingsState, FormData>(
    saveInstanceSettings,
    {},
  );
  const feedbackId = useId();
  const bad = (f: string) => (!pending && state.field === f) || undefined;
  const { m } = useI18n();
  const t = m.admin.instance;

  return (
    <form action={action} className="mt-7 space-y-5">
      <section
        aria-labelledby="instance-general"
        className="rounded-2xl border border-border bg-surface p-5 sm:p-7"
      >
        <h2 id="instance-general" className="font-display text-xl font-bold tracking-tight">
          {t.general}
        </h2>
        <div className="mt-4 flex max-w-sm flex-col gap-1.5">
          <label htmlFor="instanceName" className="text-sm font-medium">
            {t.instanceName}
          </label>
          <Input
            id="instanceName"
            name="instanceName"
            required
            maxLength={60}
            defaultValue={state.values?.instanceName ?? initial.instanceName}
            aria-invalid={bad("instanceName")}
            aria-describedby={bad("instanceName") ? feedbackId : undefined}
          />
        </div>
      </section>

      <section
        aria-labelledby="instance-registration"
        className="rounded-2xl border border-border bg-surface p-5 sm:p-7"
      >
        <h2 id="instance-registration" className="font-display text-xl font-bold tracking-tight">
          {t.registration.title}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{t.registration.description}</p>
        <fieldset
          className="mt-4 grid gap-2.5 sm:grid-cols-2"
          aria-invalid={bad("registrationOpen")}
          aria-describedby={bad("registrationOpen") ? feedbackId : undefined}
        >
          <legend className="sr-only">{t.registration.title}</legend>
          {[
            {
              value: "closed",
              title: t.registration.closedTitle,
              text: t.registration.closedText,
            },
            {
              value: "open",
              title: t.registration.openTitle,
              text: t.registration.openText,
            },
          ].map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3.5 transition-colors hover:bg-surface-2 has-[:checked]:border-accent has-[:checked]:bg-accent/5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="registrationOpen"
                value={o.value}
                defaultChecked={
                  state.values?.registrationOpen
                    ? state.values.registrationOpen === o.value
                    : (o.value === "open") === initial.registrationOpen
                }
                className="mt-1 accent-accent"
              />
              <span>
                <span className="block text-sm font-semibold">{o.title}</span>
                <span className="block text-sm text-ink-muted">{o.text}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      <section
        aria-labelledby="instance-legal"
        className="rounded-2xl border border-border bg-surface p-5 sm:p-7"
      >
        <h2 id="instance-legal" className="font-display text-xl font-bold tracking-tight">
          {t.legal.title}
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          {rich(t.legal.description, {
            link: (chunk) => (
              <Link
                href="/legal/privacy"
                className="text-accent underline-offset-2 hover:underline"
              >
                {chunk}
              </Link>
            ),
          })}
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {LEGAL_FIELDS.map((f) => (
            <div key={f.name} className="flex flex-col gap-1.5">
              <label htmlFor={f.name} className="text-sm font-medium">
                {t.legal.fields[f.name]}
              </label>
              <Input
                id={f.name}
                name={f.name}
                type={f.type ?? "text"}
                maxLength={f.type === "number" ? undefined : f.maxLength}
                min={f.type === "number" ? 0 : undefined}
                max={f.type === "number" ? 3650 : undefined}
                autoComplete={f.autoComplete ?? "off"}
                placeholder={f.placeholder?.(t.legal)}
                defaultValue={state.values?.[f.name] ?? String(initial[f.name])}
                aria-invalid={bad(f.name)}
                aria-describedby={[`${f.name}-hint`, bad(f.name) ? feedbackId : ""]
                  .filter(Boolean)
                  .join(" ")}
              />
              <p id={`${f.name}-hint`} className="text-xs text-ink-muted">
                {f.hint(t.legal)}
              </p>
            </div>
          ))}
        </div>
      </section>

      {pending ? (
        <div role="status" id={feedbackId} />
      ) : state.error ? (
        <p
          role="alert"
          id={feedbackId}
          className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {state.error}
        </p>
      ) : (
        <div role="status" id={feedbackId}>
          {state.message && (
            <p className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
              {state.message}
            </p>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? t.saving : t.save}
        </Button>
      </div>
    </form>
  );
}
