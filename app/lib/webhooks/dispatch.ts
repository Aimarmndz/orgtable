import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/app/lib/prisma";
import { decryptSecret } from "@/app/lib/crypto/secrets";
import { isLocale, messagesFor } from "@/app/i18n/config";
import { boardPath } from "@/app/lib/slugs";
import { postWebhook } from "@/app/lib/webhooks/http";
import { signatureHeader } from "@/app/lib/webhooks/sign";
import { publicOrigin, renderBody, type EventEnvelope } from "@/app/lib/webhooks/render";
import type { WebhookEvent } from "@/app/lib/webhooks/events";

// Delivery of outgoing webhooks (docs/webhooks.md). emitBoardEvent writes one
// WebhookDelivery per matching webhook (the body already rendered) and kicks off sending in
// the background; failures are retried with growing waits by the next emit or by
// POST /api/cron/webhooks. Nothing here may break the action that caused the event.

// Waits after attempts 1–5; the 6th failure is final.
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 6 * 3600_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
// Final failures in a row before a webhook is switched off.
export const DISABLE_AFTER = 15;
const CLAIM_MS = 60_000;

export const secretContext = (webhookId: string) => `webhook:${webhookId}`;

type BoardInfo = {
  id: string;
  title: string;
  slug: string;
  visibility: "WORKSPACE" | "PRIVATE";
  workspace: { id: string; slug: string; name: string };
};

/**
 * Records an event of a board for the webhooks that want it. Organization-wide webhooks see
 * the boards shared with the whole organization; a private board's events only go to webhooks
 * of that board (created by someone who can open it). See docs/webhooks.md, "Scope".
 */
export async function emitBoardEvent(input: {
  event: WebhookEvent;
  boardId: string;
  actorId: string | null;
  data: Record<string, unknown>;
  // For events after the board is gone (board.deleted): what it was.
  board?: BoardInfo;
}): Promise<void> {
  try {
    const board =
      input.board ??
      (await prisma.board.findUnique({
        where: { id: input.boardId },
        select: {
          id: true,
          title: true,
          slug: true,
          visibility: true,
          workspace: { select: { id: true, slug: true, name: true } },
        },
      }));
    if (!board) return;
    const hooks = await prisma.webhook.findMany({
      where: {
        workspaceId: board.workspace.id,
        active: true,
        disabledAt: null,
        events: { has: input.event },
        OR: [{ boardId: board.id }, ...(board.visibility === "WORKSPACE" ? [{ boardId: null }] : [])],
      },
      select: { id: true, format: true, createdById: true },
    });
    if (hooks.length === 0) return;
    const actor = input.actorId
      ? await prisma.user.findUnique({ where: { id: input.actorId }, select: { id: true, name: true } })
      : null;
    const origin = publicOrigin();
    const envelope: EventEnvelope = {
      id: randomUUID(),
      event: input.event,
      createdAt: new Date().toISOString(),
      workspace: board.workspace,
      board: {
        id: board.id,
        title: board.title,
        url: origin ? `${origin}${boardPath(board.workspace.slug, board.slug)}` : null,
      },
      actor,
      data: input.data,
    };
    const ids = await queue(hooks, envelope);
    void processDeliveries(ids);
  } catch (error) {
    console.error("[webhooks] could not queue an event", { event: input.event, error: String(error).slice(0, 300) });
  }
}

/** Renders the envelope for each webhook (in its creator's language) and queues it. */
async function queue(
  hooks: { id: string; format: "JSON" | "SLACK" | "DISCORD" | "TEAMS"; createdById: string | null }[],
  envelope: EventEnvelope,
): Promise<string[]> {
  const creators = await prisma.user.findMany({
    where: { id: { in: hooks.flatMap((h) => (h.createdById ? [h.createdById] : [])) } },
    select: { id: true, locale: true },
  });
  const localeOf = new Map(creators.map((c) => [c.id, c.locale]));
  const now = new Date();
  const rows = await prisma.webhookDelivery.createManyAndReturn({
    data: hooks.map((h) => {
      const locale = h.createdById ? localeOf.get(h.createdById) : null;
      return {
        webhookId: h.id,
        event: envelope.event,
        body: renderBody(h.format, messagesFor(isLocale(locale) ? locale : "en"), envelope),
        nextAttemptAt: now,
      };
    }),
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** A test event for one webhook, sent at once (the settings page shows the answer). */
export async function queuePing(webhookId: string): Promise<string | null> {
  const hook = await prisma.webhook.findUnique({
    where: { id: webhookId },
    select: { id: true, format: true, createdById: true, workspace: { select: { id: true, slug: true, name: true } } },
  });
  if (!hook) return null;
  const envelope: EventEnvelope = {
    id: randomUUID(),
    event: "ping",
    createdAt: new Date().toISOString(),
    workspace: hook.workspace,
    board: null,
    actor: null,
    data: {},
  };
  const [id] = await queue([hook], envelope);
  return id ?? null;
}

/**
 * Sends the due deliveries (or the given ones): claims them first (FOR UPDATE SKIP LOCKED
 * plus a short lease), so two processes never send the same one twice.
 */
export async function processDeliveries(onlyIds?: string[], limit = 50): Promise<number> {
  let claimed: { id: string }[];
  try {
    claimed = onlyIds
      ? await prisma.$queryRaw<{ id: string }[]>`
          UPDATE "WebhookDelivery" SET "lockedUntil" = now() + make_interval(secs => ${CLAIM_MS / 1000})
          WHERE "id" IN (
            SELECT "id" FROM "WebhookDelivery"
            WHERE "id" = ANY(${onlyIds}) AND "status" = 'PENDING'
              AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
            FOR UPDATE SKIP LOCKED)
          RETURNING "id"`
      : await prisma.$queryRaw<{ id: string }[]>`
          UPDATE "WebhookDelivery" SET "lockedUntil" = now() + make_interval(secs => ${CLAIM_MS / 1000})
          WHERE "id" IN (
            SELECT "id" FROM "WebhookDelivery"
            WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
              AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
            ORDER BY "nextAttemptAt" LIMIT ${limit}
            FOR UPDATE SKIP LOCKED)
          RETURNING "id"`;
  } catch (error) {
    console.error("[webhooks] could not claim deliveries", String(error).slice(0, 300));
    return 0;
  }
  await Promise.all(claimed.map((c) => attempt(c.id)));
  return claimed.length;
}

async function attempt(deliveryId: string): Promise<void> {
  try {
    const d = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        event: true,
        body: true,
        attempts: true,
        webhook: {
          select: {
            id: true,
            url: true,
            active: true,
            disabledAt: true,
            secretEnc: true,
            previousSecretEnc: true,
            previousSecretUntil: true,
          },
        },
      },
    });
    if (!d) return;
    const hook = d.webhook;
    if (!hook.active || hook.disabledAt) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { status: "FAILED", error: "The webhook is off", lockedUntil: null, nextAttemptAt: null },
      });
      return;
    }
    const secrets = [decryptSecret(hook.secretEnc, secretContext(hook.id))];
    if (hook.previousSecretEnc && hook.previousSecretUntil && hook.previousSecretUntil > new Date()) {
      secrets.push(decryptSecret(hook.previousSecretEnc, secretContext(hook.id)));
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const result = await postWebhook(hook.url, d.body, {
      "x-orgtable-event": d.event,
      "x-orgtable-delivery": d.id,
      "x-orgtable-signature": signatureHeader(secrets, timestamp, d.body),
    });
    const attempts = d.attempts + 1;
    const common = {
      attempts,
      lockedUntil: null,
      durationMs: result.durationMs,
      responseStatus: result.status,
      responseBody: "body" in result ? result.body.slice(0, 4096) : null,
      error: "error" in result ? result.error : result.ok ? null : `HTTP ${result.status}`,
    };
    if (result.ok) {
      await prisma.$transaction([
        prisma.webhookDelivery.update({
          where: { id: d.id },
          data: { ...common, status: "SUCCESS", deliveredAt: new Date(), nextAttemptAt: null },
        }),
        prisma.webhook.update({ where: { id: hook.id }, data: { consecutiveFailures: 0 } }),
      ]);
      return;
    }
    if (attempts < MAX_ATTEMPTS) {
      await prisma.webhookDelivery.update({
        where: { id: d.id },
        data: { ...common, nextAttemptAt: new Date(Date.now() + BACKOFF_MS[attempts - 1]) },
      });
      return;
    }
    await prisma.webhookDelivery.update({
      where: { id: d.id },
      data: { ...common, status: "FAILED", nextAttemptAt: null },
    });
    const updated = await prisma.webhook.update({
      where: { id: hook.id },
      data: { consecutiveFailures: { increment: 1 } },
      select: { consecutiveFailures: true },
    });
    if (updated.consecutiveFailures >= DISABLE_AFTER) {
      await prisma.webhook.updateMany({ where: { id: hook.id, disabledAt: null }, data: { disabledAt: new Date() } });
    }
  } catch (error) {
    console.error("[webhooks] delivery attempt failed", { deliveryId, error: String(error).slice(0, 300) });
    await prisma.webhookDelivery
      .update({ where: { id: deliveryId }, data: { lockedUntil: null } })
      .catch(() => undefined);
  }
}
