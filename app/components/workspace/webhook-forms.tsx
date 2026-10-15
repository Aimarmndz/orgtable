"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  createIncomingAction,
  createWebhookAction,
  pingWebhookAction,
  regenerateIncomingAction,
  rotateSecretAction,
  updateWebhookAction,
  type WebhookFormState,
} from "@/app/lib/actions/webhooks";
import {
  WEBHOOK_EVENT_GROUPS,
  WEBHOOK_FORMATS,
  type WebhookEventGroup,
  type WebhookFormat,
} from "@/app/lib/webhooks/events";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Feedback, Field, LABEL, SELECT } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";

// Forms of webhooks and incoming webhooks (docs/webhooks.md). Secrets and incoming URLs come
// back from the action and are shown here once.

/** A value shown once, with a copy button. */
export function OnceBox({ label, value, note }: { label: string; value: string; note: string }) {
  const { m } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-xl border border-success/30 bg-success/5 p-4">
      <p className="text-sm font-semibold">{label}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-sm ring-1 ring-border">{value}</code>
        <Button
          type="button"
          variant="outline"
          className="h-9"
          onClick={() =>
            navigator.clipboard?.writeText(value).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }
        >
          {copied ? m.webhooks.form.copied : m.webhooks.form.copy}
        </Button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">{note}</p>
    </div>
  );
}

export function WebhookForm({
  workspaceId,
  slug,
  boards,
  webhook,
  defaultFormat = "JSON",
}: {
  workspaceId: string;
  slug: string;
  boards: { id: string; title: string }[];
  webhook?: { id: string; name: string; url: string; format: WebhookFormat; boardId: string | null; events: string[] };
  defaultFormat?: WebhookFormat;
}) {
  const { m } = useI18n();
  const t = m.webhooks.form;
  const [state, action, pending] = useActionState<WebhookFormState, FormData>(
    webhook ? updateWebhookAction : createWebhookAction,
    {},
  );
  const [events, setEvents] = useState<Set<string>>(
    () => new Set(webhook?.events ?? ["card.created", "card.moved", "comment.created"]),
  );
  const toggle = (e: string, on: boolean) =>
    setEvents((prev) => {
      const next = new Set(prev);
      if (on) next.add(e);
      else next.delete(e);
      return next;
    });

  if (!webhook && state.secret && state.webhookId) {
    return (
      <div className="flex flex-col gap-4">
        <OnceBox label={t.secretTitle} value={state.secret} note={t.secretOnce} />
        <div>
          <Link
            href={`/${slug}/settings/webhooks/${state.webhookId}`}
            className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-ink hover:bg-accent-hover"
          >
            {t.open}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {webhook && <input type="hidden" name="webhookId" value={webhook.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.name}>
          <Input name="name" required maxLength={60} defaultValue={webhook?.name} className="mt-1.5" />
        </Field>
        <Field label={t.scope}>
          <select name="boardId" defaultValue={webhook?.boardId ?? ""} className={SELECT}>
            <option value="">{t.scopeOrg}</option>
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.url} hint={t.urlHint} className="sm:col-span-2">
          <Input
            name="url"
            type="url"
            required
            maxLength={2000}
            defaultValue={webhook?.url}
            placeholder="https://"
            className="mt-1.5 font-mono"
          />
        </Field>
      </div>
      <fieldset>
        <legend className={LABEL}>{t.format}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {WEBHOOK_FORMATS.map((f) => (
            <label key={f} className="cursor-pointer">
              <input
                type="radio"
                name="format"
                value={f}
                defaultChecked={(webhook?.format ?? defaultFormat) === f}
                className="peer sr-only"
              />
              <span className="inline-flex h-9 items-center rounded-lg border border-ink/20 bg-surface px-3 text-sm font-semibold peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                {t.formats[f]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={LABEL}>{t.events}</legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2">
          {(Object.keys(WEBHOOK_EVENT_GROUPS) as WebhookEventGroup[]).map((group) => {
            const list = WEBHOOK_EVENT_GROUPS[group] as readonly string[];
            const all = list.every((e) => events.has(e));
            return (
              <div key={group} className="rounded-xl border border-border p-3">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={(e) => list.forEach((ev) => toggle(ev, e.target.checked))}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {t.groups[group]}
                </label>
                <div className="mt-2 flex flex-col gap-1.5 pl-6">
                  {list.map((e) => (
                    <label key={e} className="flex items-center gap-2 font-mono text-xs">
                      <input
                        type="checkbox"
                        name="events"
                        value={e}
                        checked={events.has(e)}
                        onChange={(ev) => toggle(e, ev.target.checked)}
                        className="size-4 accent-[var(--color-accent)]"
                      />
                      {e}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </fieldset>
      <Feedback state={state} pending={pending} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {webhook ? t.save : t.create}
        </Button>
      </div>
    </form>
  );
}

export function RotateSecretForm({ workspaceId, webhookId }: { workspaceId: string; webhookId: string }) {
  const { m } = useI18n();
  const t = m.webhooks.form;
  const [state, action, pending] = useActionState<WebhookFormState, FormData>(rotateSecretAction, {});
  if (state.secret) return <OnceBox label={t.secretTitle} value={state.secret} note={t.secretOnce} />;
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="webhookId" value={webhookId} />
      <p className="min-w-0 flex-[1_1_16rem] text-sm text-ink-muted">{t.secretHidden}</p>
      <Button type="submit" variant="outline" disabled={pending}>
        {t.rotate}
      </Button>
      <div className="basis-full">
        <Feedback state={state} pending={pending} />
      </div>
    </form>
  );
}

export function PingForm({ workspaceId, webhookId }: { workspaceId: string; webhookId: string }) {
  const { m } = useI18n();
  const [state, action, pending] = useActionState<WebhookFormState, FormData>(pingWebhookAction, {});
  return (
    <form action={action} className="flex flex-col items-start gap-1">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="webhookId" value={webhookId} />
      <Button type="submit" variant="outline" disabled={pending} className="h-10">
        {m.webhooks.form.ping}
      </Button>
      <Feedback state={state} pending={pending} />
    </form>
  );
}

export function IncomingForm({
  workspaceId,
  lists,
}: {
  workspaceId: string;
  lists: { id: string; label: string }[];
}) {
  const { m } = useI18n();
  const t = m.webhooks.integrations;
  const [state, action, pending] = useActionState<WebhookFormState, FormData>(createIncomingAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label={m.webhooks.form.name}>
          <Input name="name" required maxLength={60} className="mt-1.5" placeholder="Web form" />
        </Field>
        <Field label={t.list}>
          <select name="listId" required className={SELECT} defaultValue="">
            <option value="" disabled>
              {t.pickList}
            </option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={pending} className="h-10">
          {t.create}
        </Button>
      </div>
      {state.incomingUrl && !pending && <OnceBox label="URL" value={state.incomingUrl} note={t.urlOnce} />}
      <Feedback state={{ error: state.error }} pending={pending} />
    </form>
  );
}

export function RegenerateIncomingForm({ workspaceId, hookId }: { workspaceId: string; hookId: string }) {
  const { m } = useI18n();
  const t = m.webhooks.integrations;
  const [state, action, pending] = useActionState<WebhookFormState, FormData>(regenerateIncomingAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="hookId" value={hookId} />
      {state.incomingUrl ? (
        <OnceBox label="URL" value={state.incomingUrl} note={t.urlOnce} />
      ) : (
        <Button type="submit" variant="outline" disabled={pending} className="h-8 px-3">
          {t.regenerate}
        </Button>
      )}
    </form>
  );
}
