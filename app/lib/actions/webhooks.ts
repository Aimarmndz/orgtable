"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { publicOrigin } from "@/app/lib/webhooks/render";
import { requireUser } from "@/app/lib/dal";
import { recordAudit, type AuditAction } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import { isSecretKeyConfigured } from "@/app/lib/crypto/secrets";
import { WEBHOOK_FORMATS } from "@/app/lib/webhooks/events";
import {
  createWebhook,
  deleteWebhook,
  pingWebhook,
  redeliver,
  rotateWebhookSecret,
  setWebhookActive,
  updateWebhook,
  type WebhookError,
} from "@/app/lib/services/webhooks";
import {
  createIncomingHook,
  deleteIncomingHook,
  regenerateIncomingHook,
  type IncomingError,
} from "@/app/lib/services/incoming-hooks";
import { getI18n } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";

// Server Actions of webhooks, chat integrations and incoming webhooks (docs/webhooks.md).
// They resolve who is acting and audit; the services enforce the rules.

export type WebhookFormState = {
  error?: string;
  message?: string;
  // Shown once: the signing secret of a new or rotated webhook, or a new incoming URL.
  secret?: string;
  incomingUrl?: string;
  webhookId?: string;
};

function text(formData: FormData, key: string, max = 300): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

const webhookSchema = z.object({
  name: z.string().trim().min(1, "errors.webhooks.nameRequired").max(60, "errors.webhooks.nameTooLong"),
  url: z.string().trim().min(1, "errors.webhooks.urlInvalid").max(2000, "errors.webhooks.urlInvalid"),
  format: z.enum(WEBHOOK_FORMATS),
  boardId: z.string().max(100).transform((v) => v || null),
  events: z.array(z.string().max(40)).max(40),
});

function errorMessage(m: Messages, error: WebhookError | IncomingError): string {
  const t = m.errors.webhooks;
  switch (error) {
    case "invalid":
      return t.urlInvalid;
    case "not_https":
      return t.notHttps;
    case "wrong_service":
      return t.wrongService;
    case "no_events":
      return t.noEvents;
    case "too_many":
      return t.tooMany;
    case "not_found":
      return t.notFound;
    default:
      return m.errors.workspaces.forbidden;
  }
}

async function slugOf(workspaceId: string): Promise<string | null> {
  return (await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true } }))?.slug ?? null;
}

async function after(workspaceId: string, userId: string, action: AuditAction, detail: string) {
  await recordAudit({ action, userId, targetType: "workspace", targetId: workspaceId, detail });
  const slug = await slugOf(workspaceId);
  if (slug) revalidatePath(`/${slug}/settings`, "layout");
}

function parseWebhook(formData: FormData) {
  return webhookSchema.safeParse({
    name: text(formData, "name", 120),
    url: text(formData, "url", 2100),
    format: text(formData, "format", 10) || "JSON",
    boardId: text(formData, "boardId", 100),
    events: formData.getAll("events").filter((v) => typeof v === "string"),
  });
}

export async function createWebhookAction(_prev: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  if (!isSecretKeyConfigured()) return { error: m.errors.webhooks.noKey };
  const workspaceId = text(formData, "workspaceId");
  const parsed = parseWebhook(formData);
  if (!parsed.success) return { error: m.errors.webhooks.urlInvalid };
  const result = await createWebhook({ workspaceId, actorId: user.id, webhook: parsed.data });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await after(workspaceId, user.id, "workspace.webhook_created", `${result.id} ${parsed.data.name} (${parsed.data.format})`);
  return { secret: result.secret, webhookId: result.id };
}

export async function updateWebhookAction(_prev: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const webhookId = text(formData, "webhookId");
  const parsed = parseWebhook(formData);
  if (!parsed.success) return { error: m.errors.webhooks.urlInvalid };
  const result = await updateWebhook({ workspaceId, actorId: user.id, webhookId, webhook: parsed.data });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await after(workspaceId, user.id, "workspace.webhook_updated", `${webhookId} ${parsed.data.name}: ${parsed.data.events.join(" ")}`);
  return { message: m.webhooks.form.saved };
}

export async function rotateSecretAction(_prev: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const webhookId = text(formData, "webhookId");
  const result = await rotateWebhookSecret({ workspaceId, actorId: user.id, webhookId });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await after(workspaceId, user.id, "workspace.webhook_secret_rotated", webhookId);
  return { secret: result.secret };
}

export async function pingWebhookAction(_prev: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const webhookId = text(formData, "webhookId");
  const result = await pingWebhook({ workspaceId, actorId: user.id, webhookId });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  const d = await prisma.webhookDelivery.findUnique({
    where: { id: result.deliveryId },
    select: { status: true, responseStatus: true, error: true },
  });
  const slug = await slugOf(workspaceId);
  if (slug) revalidatePath(`/${slug}/settings`, "layout");
  return d?.status === "SUCCESS"
    ? { message: m.webhooks.form.pingOk.replace("{status}", String(d.responseStatus)) }
    : { error: m.webhooks.form.pingFailed.replace("{error}", d?.error ?? `HTTP ${d?.responseStatus ?? "?"}`) };
}

export async function redeliverAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const result = await redeliver({ workspaceId, actorId: user.id, deliveryId: text(formData, "deliveryId") });
  if (!result.ok) return;
  const slug = await slugOf(workspaceId);
  if (slug) revalidatePath(`/${slug}/settings`, "layout");
}

export async function setWebhookActiveAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const webhookId = text(formData, "webhookId");
  const active = text(formData, "active") === "true";
  const result = await setWebhookActive({ workspaceId, actorId: user.id, webhookId, active });
  if (!result.ok) return;
  await after(workspaceId, user.id, active ? "workspace.webhook_enabled" : "workspace.webhook_disabled", webhookId);
}

export async function deleteWebhookAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const webhookId = text(formData, "webhookId");
  const result = await deleteWebhook({ workspaceId, actorId: user.id, webhookId });
  if (!result.ok) return;
  await after(workspaceId, user.id, "workspace.webhook_deleted", webhookId);
  const slug = await slugOf(workspaceId);
  if (slug) redirect(`/${slug}/settings/webhooks`);
}

// --- Incoming -------------------------------------------------------------------------------

/** The address people outside reach this instance at: ORGTABLE_PUBLIC_URL, else this request's. */
async function origin(): Promise<string> {
  const configured = publicOrigin();
  if (configured) return configured;
  const h = await headers();
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  return `${proto}://${h.get("host") ?? "localhost"}`;
}

async function incomingUrl(token: string): Promise<string> {
  return `${await origin()}/api/hooks/in/${token}`;
}

export async function createIncomingAction(_prev: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const name = text(formData, "name", 60).trim();
  if (!name) return { error: m.errors.webhooks.nameRequired };
  const result = await createIncomingHook({ workspaceId, actorId: user.id, name, listId: text(formData, "listId") });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await after(workspaceId, user.id, "workspace.incoming_created", `${result.id} ${name}`);
  return { incomingUrl: await incomingUrl(result.token) };
}

export async function regenerateIncomingAction(_prev: WebhookFormState, formData: FormData): Promise<WebhookFormState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const workspaceId = text(formData, "workspaceId");
  const hookId = text(formData, "hookId");
  const result = await regenerateIncomingHook({ workspaceId, actorId: user.id, hookId });
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await after(workspaceId, user.id, "workspace.incoming_regenerated", hookId);
  return { incomingUrl: await incomingUrl(result.token) };
}

export async function deleteIncomingAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const workspaceId = text(formData, "workspaceId");
  const hookId = text(formData, "hookId");
  const result = await deleteIncomingHook({ workspaceId, actorId: user.id, hookId });
  if (result.ok) await after(workspaceId, user.id, "workspace.incoming_deleted", hookId);
}
