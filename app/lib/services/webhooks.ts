import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { effectiveBoardRole, workspaceAccessOf } from "@/app/lib/access";
import { encryptSecret } from "@/app/lib/crypto/secrets";
import { isWebhookEvent, webhookUrlProblem, type UrlProblem, type WebhookFormat } from "@/app/lib/webhooks/events";
import { privateTargetsAllowed } from "@/app/lib/webhooks/ssrf";
import { processDeliveries, queuePing, secretContext } from "@/app/lib/webhooks/dispatch";

// Outgoing webhooks of an organization (docs/webhooks.md). Business rules only: the actions
// resolve who is acting and audit.
//
// - "integrations.manage" is needed for everything; a suspended organization is frozen.
// - A webhook of one board can only be made by someone who can open that board (its events
//   reveal the board's content). Organization-wide webhooks only carry the boards shared with
//   the whole organization (dispatch.ts).
// - Every lookup is by { workspaceId, id }: an id of another organization is "not found".
// - The signing secret is shown once (on creation and on rotation) and stored encrypted.

export const MAX_WEBHOOKS = 25;
// How long the previous secret keeps signing after a rotation.
export const ROTATION_GRACE_MS = 24 * 3600_000;

export type WebhookError = "forbidden" | "not_found" | "too_many" | "no_events" | UrlProblem;

export type WebhookInput = {
  name: string;
  url: string;
  format: WebhookFormat;
  boardId: string | null;
  events: readonly string[];
};

function newSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

async function mayManage(workspaceId: string, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { kind: true, suspendedAt: true },
  });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return false;
  const actor = await workspaceAccessOf(workspaceId, actorId);
  return Boolean(actor?.permissions.has("integrations.manage"));
}

/** Validates the parts every create/update shares. */
async function check(
  workspaceId: string,
  actorId: string,
  input: WebhookInput,
): Promise<{ ok: true; events: string[] } | { ok: false; error: WebhookError }> {
  const problem = webhookUrlProblem(input.url, input.format, privateTargetsAllowed());
  if (problem) return { ok: false, error: problem };
  const events = [...new Set(input.events.filter(isWebhookEvent))];
  if (events.length === 0) return { ok: false, error: "no_events" };
  if (input.boardId) {
    const board = await prisma.board.findUnique({
      where: { workspaceId_id: { workspaceId, id: input.boardId } },
      select: { id: true },
    });
    if (!board || !(await effectiveBoardRole(input.boardId, actorId))) return { ok: false, error: "not_found" };
  }
  return { ok: true, events };
}

export async function createWebhook(input: {
  workspaceId: string;
  actorId: string;
  webhook: WebhookInput;
}): Promise<{ ok: true; id: string; secret: string } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  if ((await prisma.webhook.count({ where: { workspaceId: input.workspaceId } })) >= MAX_WEBHOOKS) {
    return { ok: false, error: "too_many" };
  }
  const checked = await check(input.workspaceId, input.actorId, input.webhook);
  if (!checked.ok) return checked;
  // The id is chosen here: the secret is encrypted bound to it.
  const id = randomUUID();
  const secret = newSecret();
  await prisma.webhook.create({
    data: {
      id,
      workspaceId: input.workspaceId,
      boardId: input.webhook.boardId,
      name: input.webhook.name,
      url: input.webhook.url,
      format: input.webhook.format,
      events: checked.events,
      secretEnc: encryptSecret(secret, secretContext(id)),
      createdById: input.actorId,
    },
  });
  return { ok: true, id, secret };
}

export async function updateWebhook(input: {
  workspaceId: string;
  actorId: string;
  webhookId: string;
  webhook: WebhookInput;
}): Promise<{ ok: true } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const checked = await check(input.workspaceId, input.actorId, input.webhook);
  if (!checked.ok) return checked;
  const { count } = await prisma.webhook.updateMany({
    where: { id: input.webhookId, workspaceId: input.workspaceId },
    data: {
      name: input.webhook.name,
      url: input.webhook.url,
      format: input.webhook.format,
      boardId: input.webhook.boardId,
      events: checked.events,
    },
  });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** Turns a webhook on or off; turning it on also clears an automatic switch-off. */
export async function setWebhookActive(input: {
  workspaceId: string;
  actorId: string;
  webhookId: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.webhook.updateMany({
    where: { id: input.webhookId, workspaceId: input.workspaceId },
    data: input.active ? { active: true, disabledAt: null, consecutiveFailures: 0 } : { active: false },
  });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** A new secret, shown once; the previous one keeps signing for ROTATION_GRACE_MS. */
export async function rotateWebhookSecret(input: {
  workspaceId: string;
  actorId: string;
  webhookId: string;
}): Promise<{ ok: true; secret: string } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const hook = await prisma.webhook.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.webhookId } },
    select: { id: true, secretEnc: true },
  });
  if (!hook) return { ok: false, error: "not_found" };
  const secret = newSecret();
  await prisma.webhook.update({
    where: { id: hook.id },
    data: {
      secretEnc: encryptSecret(secret, secretContext(hook.id)),
      previousSecretEnc: hook.secretEnc,
      previousSecretUntil: new Date(Date.now() + ROTATION_GRACE_MS),
    },
  });
  return { ok: true, secret };
}

export async function deleteWebhook(input: {
  workspaceId: string;
  actorId: string;
  webhookId: string;
}): Promise<{ ok: true } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const { count } = await prisma.webhook.deleteMany({ where: { id: input.webhookId, workspaceId: input.workspaceId } });
  return count === 0 ? { ok: false, error: "not_found" } : { ok: true };
}

/** Sends a test event now and returns the delivery's id (its outcome is in the log). */
export async function pingWebhook(input: {
  workspaceId: string;
  actorId: string;
  webhookId: string;
}): Promise<{ ok: true; deliveryId: string } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const hook = await prisma.webhook.findUnique({
    where: { workspaceId_id: { workspaceId: input.workspaceId, id: input.webhookId } },
    select: { id: true },
  });
  if (!hook) return { ok: false, error: "not_found" };
  const deliveryId = await queuePing(hook.id);
  if (!deliveryId) return { ok: false, error: "not_found" };
  await processDeliveries([deliveryId]);
  return { ok: true, deliveryId };
}

/** Sends a past delivery again, as a new delivery with the same body. */
export async function redeliver(input: {
  workspaceId: string;
  actorId: string;
  deliveryId: string;
}): Promise<{ ok: true; deliveryId: string } | { ok: false; error: WebhookError }> {
  if (!(await mayManage(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const old = await prisma.webhookDelivery.findFirst({
    where: { id: input.deliveryId, webhook: { workspaceId: input.workspaceId } },
    select: { webhookId: true, event: true, body: true },
  });
  if (!old) return { ok: false, error: "not_found" };
  const copy = await prisma.webhookDelivery.create({
    data: { webhookId: old.webhookId, event: old.event, body: old.body, nextAttemptAt: new Date() },
    select: { id: true },
  });
  await processDeliveries([copy.id]);
  return { ok: true, deliveryId: copy.id };
}

/** The organization's webhooks for the settings page, with their latest delivery. */
export async function listWebhooks(workspaceId: string) {
  return prisma.webhook.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      url: true,
      format: true,
      events: true,
      active: true,
      disabledAt: true,
      consecutiveFailures: true,
      board: { select: { id: true, title: true } },
      deliveries: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, createdAt: true, responseStatus: true },
      },
    },
  });
}

export async function recentDeliveries(workspaceId: string, webhookId?: string, take = 20) {
  return prisma.webhookDelivery.findMany({
    where: { webhook: { workspaceId }, ...(webhookId ? { webhookId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    select: {
      id: true,
      event: true,
      status: true,
      attempts: true,
      responseStatus: true,
      responseBody: true,
      error: true,
      durationMs: true,
      createdAt: true,
      nextAttemptAt: true,
      body: true,
      webhook: { select: { id: true, name: true } },
    },
  });
}
