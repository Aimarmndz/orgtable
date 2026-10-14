"use client";

import Link from "next/link";
import { useActionState, useId } from "react";
import {
  saveInstanceSettings,
  type InstanceSettingsState,
} from "@/app/lib/actions/instance";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

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

const LEGAL_FIELDS: {
  name: keyof Values;
  label: string;
  type?: string;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
  maxLength: number;
}[] = [
  {
    name: "operatorName",
    label: "Responsable (nombre o razón social)",
    autoComplete: "organization",
    maxLength: 120,
    hint: "Obligatorio para abrir el registro.",
  },
  {
    name: "operatorEmail",
    label: "Email de contacto para privacidad",
    type: "email",
    autoComplete: "email",
    maxLength: 254,
    hint: "Obligatorio para abrir el registro.",
  },
  { name: "operatorLegalId", label: "NIF", maxLength: 40, hint: "Opcional." },
  {
    name: "operatorAddress",
    label: "Dirección postal",
    autoComplete: "street-address",
    maxLength: 200,
    hint: "Opcional.",
  },
  {
    name: "hostingDescription",
    label: "Dónde se alojan los datos",
    placeholder: "p. ej. un VPS de <proveedor> en la Unión Europea",
    maxLength: 200,
    hint: "Proveedor y país o región.",
  },
  {
    name: "backupRetentionDays",
    label: "Días que guardas las copias de seguridad",
    type: "number",
    maxLength: 4,
    hint: "0 si no haces copias. Debe coincidir con tu rotación real.",
  },
];

export function InstanceSettingsForm({ initial }: { initial: Values }) {
  const [state, action, pending] = useActionState<InstanceSettingsState, FormData>(
    saveInstanceSettings,
    {},
  );
  const feedbackId = useId();
  const bad = (f: string) => (!pending && state.field === f) || undefined;

  return (
    <form action={action} className="mt-7 space-y-5">
      <section
        aria-labelledby="instance-general"
        className="rounded-2xl border border-border bg-surface p-5 sm:p-7"
      >
        <h2 id="instance-general" className="font-display text-xl font-bold tracking-tight">
          General
        </h2>
        <div className="mt-4 flex max-w-sm flex-col gap-1.5">
          <label htmlFor="instanceName" className="text-sm font-medium">
            Nombre de la instancia
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
          Registro
        </h2>
        <p className="mt-1 text-sm text-ink-muted">Quién puede crear una cuenta.</p>
        <fieldset
          className="mt-4 grid gap-2.5 sm:grid-cols-2"
          aria-invalid={bad("registrationOpen")}
          aria-describedby={bad("registrationOpen") ? feedbackId : undefined}
        >
          <legend className="sr-only">Registro</legend>
          {[
            {
              value: "closed",
              title: "Cerrado",
              text: "Solo un administrador da de alta las cuentas.",
            },
            {
              value: "open",
              title: "Abierto",
              text: "Cualquiera puede registrarse gratis en /register.",
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
          Datos legales
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Los de quien opera esta instancia. Salen en la{" "}
          <Link href="/legal/privacidad" className="text-accent underline-offset-2 hover:underline">
            política de privacidad
          </Link>
          , las condiciones y el aviso legal. Lo que dejes vacío aparece como «sin indicar».
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {LEGAL_FIELDS.map((f) => (
            <div key={f.name} className="flex flex-col gap-1.5">
              <label htmlFor={f.name} className="text-sm font-medium">
                {f.label}
              </label>
              <Input
                id={f.name}
                name={f.name}
                type={f.type ?? "text"}
                maxLength={f.type === "number" ? undefined : f.maxLength}
                min={f.type === "number" ? 0 : undefined}
                max={f.type === "number" ? 3650 : undefined}
                autoComplete={f.autoComplete ?? "off"}
                placeholder={f.placeholder}
                defaultValue={state.values?.[f.name] ?? String(initial[f.name])}
                aria-invalid={bad(f.name)}
                aria-describedby={[f.hint ? `${f.name}-hint` : "", bad(f.name) ? feedbackId : ""]
                  .filter(Boolean)
                  .join(" ") || undefined}
              />
              {f.hint && (
                <p id={`${f.name}-hint`} className="text-xs text-ink-muted">
                  {f.hint}
                </p>
              )}
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
          {pending ? "Guardando…" : "Guardar ajustes"}
        </Button>
      </div>
    </form>
  );
}
