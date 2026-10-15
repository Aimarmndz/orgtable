"use client";

import { useActionState, useState } from "react";
import {
  restoreBackupAction,
  runBackupAction,
  saveDestinationAction,
  saveScheduleAction,
  type BackupFormState,
} from "@/app/lib/actions/backups";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Feedback, Field, LABEL, SELECT, Switch } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Forms of backups (docs/backups.md), for an organization (scope = its id) or the instance
// (scope = "instance"). The server checks who may use each one.

export function RunBackupButton({ scope }: { scope: string }) {
  const { m } = useI18n();
  const [state, action, pending] = useActionState<BackupFormState, FormData>(runBackupAction, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="scope" value={scope} />
      <Button type="submit" disabled={pending} className="min-h-10">
        {m.backups.now}
      </Button>
      <Feedback state={state} pending={pending} />
    </form>
  );
}

export function ScheduleForm({
  scope,
  config,
}: {
  scope: string;
  config: { frequency: string; hour: number; retention: number; includeAttachments: boolean };
}) {
  const { m } = useI18n();
  const t = m.backups.schedule;
  const [state, action, pending] = useActionState<BackupFormState, FormData>(saveScheduleAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="scope" value={scope} />
      <fieldset>
        <legend className={LABEL}>{t.frequency}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(["DAILY", "WEEKLY", "MONTHLY", "OFF"] as const).map((f) => (
            <label key={f} className="cursor-pointer">
              <input type="radio" name="frequency" value={f} defaultChecked={config.frequency === f} className="peer sr-only" />
              <span className="inline-flex h-9 items-center rounded-lg border border-ink/20 bg-surface px-3 text-sm font-semibold peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                {t[f]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.hour}>
          <select name="hour" defaultValue={String(config.hour)} className={SELECT}>
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.retention} hint={t.retentionHint}>
          <Input name="retention" type="number" min={1} max={90} defaultValue={config.retention} className="mt-1.5" />
        </Field>
      </div>
      <Switch name="includeAttachments" label={t.attachments} hint={t.attachmentsHint} defaultChecked={config.includeAttachments} />
      <Feedback state={state} pending={pending} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}

export function DestinationForm({
  scope,
  config,
}: {
  scope: string;
  config: {
    destination: "LOCAL" | "S3";
    s3Endpoint: string | null;
    s3Region: string | null;
    s3Bucket: string | null;
    s3Prefix: string | null;
    hasKeys: boolean;
    encrypt: boolean;
  };
}) {
  const { m } = useI18n();
  const t = m.backups.destination;
  const [state, action, pending] = useActionState<BackupFormState, FormData>(saveDestinationAction, {});
  const [dest, setDest] = useState(config.destination);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="scope" value={scope} />
      <div className="grid gap-3 sm:grid-cols-2">
        {(["LOCAL", "S3"] as const).map((d) => (
          <label key={d} className="cursor-pointer">
            <input
              type="radio"
              name="destination"
              value={d}
              checked={dest === d}
              onChange={() => setDest(d)}
              className="peer sr-only"
            />
            <span className="block h-full rounded-xl border border-ink/20 p-3 peer-checked:border-accent peer-checked:bg-accent/5 peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              <span className="block text-sm font-semibold">{t[d]}</span>
              <span className="mt-0.5 block text-xs text-ink-muted">{d === "LOCAL" ? t.LOCALHint : t.S3Hint}</span>
            </span>
          </label>
        ))}
      </div>
      {dest === "S3" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t.endpoint} className="sm:col-span-2">
            <Input name="endpoint" type="url" defaultValue={config.s3Endpoint ?? ""} placeholder="https://s3.eu-west-3.amazonaws.com" className="mt-1.5 font-mono" />
          </Field>
          <Field label={t.bucket}>
            <Input name="bucket" defaultValue={config.s3Bucket ?? ""} className="mt-1.5 font-mono" />
          </Field>
          <Field label={t.region}>
            <Input name="region" defaultValue={config.s3Region ?? ""} placeholder="us-east-1 / auto" className="mt-1.5 font-mono" />
          </Field>
          <Field label={t.prefix} className="sm:col-span-2">
            <Input name="prefix" defaultValue={config.s3Prefix ?? ""} placeholder="orgtable/" className="mt-1.5 font-mono" />
          </Field>
          <Field label={t.accessKey} hint={config.hasKeys ? t.keepKey : undefined}>
            <Input name="accessKey" autoComplete="off" className="mt-1.5 font-mono" />
          </Field>
          <Field label={t.secretKey} hint={config.hasKeys ? t.keepKey : undefined}>
            <Input name="secretKey" type="password" autoComplete="new-password" className="mt-1.5 font-mono" />
          </Field>
        </div>
      )}
      <Switch name="encrypt" label={t.encrypt} hint={t.encryptHint} defaultChecked={config.encrypt} />
      <Feedback state={state} pending={pending} />
      <div className="flex flex-wrap justify-end gap-2">
        {dest === "S3" && (
          <Button type="submit" name="test" value="1" variant="outline" disabled={pending}>
            {t.test}
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}

export function RestoreForm({ scope, backupId, confirm, instance }: { scope: string; backupId: string; confirm: string; instance: boolean }) {
  const { m } = useI18n();
  const t = m.backups.history;
  const [state, action, pending] = useActionState<BackupFormState, FormData>(restoreBackupAction, {});
  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center rounded-lg border border-ink/20 bg-surface px-3 text-xs font-semibold shadow-sm hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        {t.restore}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-border bg-surface p-4 text-left shadow-[0_16px_40px_-16px_oklch(0.27_0.022_52/0.45)]">
        <p className="text-sm text-ink-muted">{fmt(instance ? t.restoreInstanceText : t.restoreText, { confirm })}</p>
        <form action={action} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="scope" value={scope} />
          <input type="hidden" name="backupId" value={backupId} />
          <Input name="confirm" required autoComplete="off" placeholder={confirm} className="font-mono" />
          <Button type="submit" variant="dangerSolid" disabled={pending}>
            {t.restoreSubmit}
          </Button>
          <Feedback state={state} pending={pending} />
        </form>
      </div>
    </details>
  );
}

/** Uploads an export to the import route (a route, not an action: files can be large). */
export function ImportForm({ slug }: { slug: string }) {
  const { m } = useI18n();
  const t = m.backups.import;
  const [state, setState] = useState<BackupFormState>({});
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setState({});
        try {
          const res = await fetch(`/api/workspaces/${slug}/import`, { method: "POST", body: new FormData(e.currentTarget) });
          const body = (await res.json().catch(() => ({}))) as {
            summary?: { boards: number; cards: number; attachments: number };
            error?: string;
            detail?: string;
          };
          if (res.ok && body.summary) {
            setState({ message: fmt(t.done, { ...body.summary }) });
          } else {
            const reason =
              res.status === 413 ? t.tooLarge : body.error === "invalid_archive" ? m.errors.backups.invalidArchive : m.errors.backups.safetyFailed;
            setState({ error: body.detail ? `${reason} (${body.detail})` : reason });
          }
        } catch {
          setState({ error: m.common.genericError });
        } finally {
          setPending(false);
        }
      }}
    >
      <Field label={t.choose}>
        <input
          type="file"
          name="file"
          required
          accept=".zip,application/zip"
          className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-ink/20 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold"
        />
      </Field>
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? t.working : t.submit}
        </Button>
      </div>
      <Feedback state={state} pending={pending} />
    </form>
  );
}
