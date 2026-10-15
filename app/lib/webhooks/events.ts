// The events an outgoing webhook can send (docs/webhooks.md), grouped as in the settings
// form. Shared by server and client.

export const WEBHOOK_EVENT_GROUPS = {
  cards: ["card.created", "card.updated", "card.moved", "card.deleted", "comment.created"],
  lists: ["list.created", "list.deleted"],
  boards: ["board.created", "board.deleted"],
  members: ["member.added", "member.removed", "member.role_changed"],
} as const;

export type WebhookEventGroup = keyof typeof WEBHOOK_EVENT_GROUPS;
export type WebhookEvent = (typeof WEBHOOK_EVENT_GROUPS)[WebhookEventGroup][number];

export const WEBHOOK_EVENTS: WebhookEvent[] = Object.values(WEBHOOK_EVENT_GROUPS).flat();

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as string[]).includes(value);
}

export const WEBHOOK_FORMATS = ["JSON", "SLACK", "DISCORD", "TEAMS"] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

/**
 * Hosts each chat's incoming-webhook URLs live on. Not a security boundary (any public HTTPS
 * address is allowed for JSON); it catches pasting a Slack URL into the Discord form.
 */
const CHAT_HOSTS: Record<Exclude<WebhookFormat, "JSON">, RegExp> = {
  SLACK: /^hooks\.slack\.com$/,
  DISCORD: /^(?:canary\.|ptb\.)?discord(?:app)?\.com$/,
  TEAMS: /(?:^|\.)(?:webhook\.office\.com|logic\.azure\.com|office\.com)$/,
};

export type UrlProblem = "invalid" | "not_https" | "wrong_service";

/** Why a webhook URL cannot be used, or null. HTTP is allowed only when `allowHttp`. */
export function webhookUrlProblem(raw: string, format: WebhookFormat, allowHttp = false): UrlProblem | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid";
  }
  if (url.username || url.password) return "invalid";
  if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return "not_https";
  if (format !== "JSON" && !CHAT_HOSTS[format].test(url.hostname.toLowerCase())) return "wrong_service";
  return null;
}
