import "server-only";
import type { Messages } from "@/app/i18n/config";
import { fmt } from "@/app/i18n/format";
import type { WebhookFormat } from "@/app/lib/webhooks/events";

// What a webhook sends, in its format (docs/webhooks.md, "Payload"). JSON is orgtable's own
// structured payload; Slack, Discord and Teams get a one-line message in the language of whoever
// created the webhook, with a link back. Text that came from users (card titles, comments) is
// escaped for each chat so it can neither ping everyone nor fake links.

export type EventEnvelope = {
  id: string;
  event: string;
  createdAt: string;
  workspace: { id: string; slug: string; name: string };
  board: { id: string; title: string; url: string | null } | null;
  actor: { id: string; name: string } | null;
  data: Record<string, unknown>;
};

/** The instance's public origin (ORGTABLE_PUBLIC_URL), or null when it is not configured. */
export function publicOrigin(): string | null {
  const raw = process.env.ORGTABLE_PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function str(value: unknown, max = 200): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** The human sentence for an event (chats), from the event's data. */
export function describeEvent(m: Messages, e: EventEnvelope): string {
  const t = m.webhooks.text;
  const d = e.data as Record<string, Record<string, unknown> | undefined>;
  const values = {
    actor: e.actor?.name ?? t.someone,
    card: str(d.card?.title),
    list: str(d.list?.title) || str(d.card?.list),
    from: str(d.from?.title),
    to: str(d.to?.title),
    board: e.board?.title ?? str(d.board?.title),
    member: str(d.member?.name),
    comment: str(d.comment?.text, 140),
  };
  if (e.event === "ping") return t.ping;
  const template = (t as Record<string, string>)[e.event];
  return template ? fmt(template, values) : e.event;
}

// Slack: &, < and > are control characters (links, @channel); they are escaped as Slack asks.
const slackEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderBody(format: WebhookFormat, m: Messages, e: EventEnvelope): string {
  if (format === "JSON") return JSON.stringify(e);
  const text = describeEvent(m, e);
  const where = e.board ? ` · ${e.board.title}` : "";
  const url = e.board?.url ?? null;
  switch (format) {
    case "SLACK":
      return JSON.stringify({
        text: `${slackEscape(text + where)}${url ? ` <${url}|${slackEscape(m.webhooks.text.open)}>` : ""}`,
        unfurl_links: false,
      });
    case "DISCORD":
      // allowed_mentions: nothing in the text can ping @everyone, roles or people.
      return JSON.stringify({
        content: `${text}${where}${url ? `\n<${url}>` : ""}`.slice(0, 2000),
        allowed_mentions: { parse: [] },
      });
    case "TEAMS":
      return JSON.stringify({
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        summary: text.slice(0, 200),
        text: `${text}${where}`.replace(/[<>]/g, ""),
        ...(url
          ? { potentialAction: [{ "@type": "OpenUri", name: m.webhooks.text.open, targets: [{ os: "default", uri: url }] }] }
          : {}),
      });
  }
}
