# Webhooks and integrations

An organization can tell other systems what happens in its boards (**outgoing webhooks**),
post it to a team chat (**Slack, Discord, Teams**) and let other tools create cards
(**incoming webhooks**). Everything lives in its settings, for people with the
`integrations.manage` permission (owners, admins, or a [custom role](./roles.md) that holds
it):

| Page                             | What                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| `/<slug>/settings/webhooks`      | Outgoing webhooks, recent deliveries, how to verify                    |
| `/<slug>/settings/webhooks/new`  | New webhook (`?format=SLACK` etc. from the apps page)                  |
| `/<slug>/settings/webhooks/<id>` | Edit, secret, test, pause, deliveries with request/response, redeliver |
| `/<slug>/settings/integrations`  | Slack, Discord, Teams and incoming webhooks                            |

Outgoing webhooks need `ORGTABLE_SECRET_KEY` (their signing secrets are stored encrypted, see
[security](./security.md#secrets-at-rest)).

## Events

| Group   | Events                                                                          |
| ------- | ------------------------------------------------------------------------------- |
| Cards   | `card.created`, `card.updated`, `card.moved`, `card.deleted`, `comment.created` |
| Lists   | `list.created`, `list.deleted`                                                  |
| Boards  | `board.created`, `board.deleted`                                                |
| Members | `member.added`, `member.removed`, `member.role_changed` (board members)         |

They are emitted by the Server Actions, the public API and incoming webhooks alike
(`app/lib/webhooks/emit.ts`). `card.moved` is a change of list; reordering inside a list is
not an event. A test (`ping`) can be sent from a webhook's page.

## Scope

A webhook covers **the whole organization** or **one board**.

- Organization-wide webhooks carry the boards shared with the whole organization. A private
  board's events never go to them: whoever manages integrations may not be able to open it.
- A webhook of one board can only be created by someone who can open that board, and carries
  its events whatever its visibility. It is deleted with the board.

## Payload (format JSON)

```json
{
  "id": "6f0d…",
  "event": "card.created",
  "createdAt": "2026-10-15T10:42:00.000Z",
  "workspace": { "id": "…", "slug": "acme", "name": "Acme" },
  "board": {
    "id": "…",
    "title": "Roadmap",
    "url": "https://orgtable.example.org/acme/roadmap"
  },
  "actor": { "id": "…", "name": "Ana Torres" },
  "data": {
    "card": { "id": "…", "title": "Ship it", "list": "To do" },
    "list": { "id": "…", "title": "To do" }
  }
}
```

`board.url` needs `ORGTABLE_PUBLIC_URL`; without it, it is `null`. `actor` is `null` for cards
created by an incoming webhook (`data.source.incomingHook` names it).

**Slack, Discord and Teams** get one sentence instead ("Ana created the card «Ship it» in To do ·
Roadmap") in the language of whoever created the webhook, with a link. Text that came from users
is escaped for each chat: Slack's `<`, `>` and `&`, Discord with `allowed_mentions: {parse: []}`,
so a card title can neither ping `@everyone` nor fake a link. Each format only accepts URLs of
its own service.

## Verifying the signature

Every request carries:

```
X-Orgtable-Event: card.created
X-Orgtable-Delivery: <delivery id>
X-Orgtable-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
```

Compute the HMAC with your secret over `<t>.<raw body>`, compare it (in constant time) with a
`v1`, and refuse timestamps older than five minutes. The secret is shown **once** when the
webhook is created; **rotating** it shows a new one and the previous one keeps signing (a second
`v1`) for 24 hours, so the receiver can be updated without losing events.

## Delivery and retries

`app/lib/webhooks/dispatch.ts`. Each event writes one `WebhookDelivery` per matching webhook with
the body already rendered, and sending starts at once in the background. A delivery is claimed
(`FOR UPDATE SKIP LOCKED` and a 60-second lease) so two processes never send it twice.

- Success: any 2xx within 10 seconds. Redirects are not followed.
- Failure: retried after 1 min, 5 min, 30 min, 2 h and 6 h (six attempts). Retries are sent by
  `POST /api/cron/webhooks`, to be scheduled every minute ([operations](./operations.md#scheduled-tasks)).
- After 15 deliveries in a row fail for good, the webhook is **switched off** and the page says
  so; turning it on again resets the count.
- The log keeps each delivery's body, status, answer (first 4 KB) and timing for 30 days.
  "Send again" creates a new delivery with the same body.

## Security

Webhook URLs are typed by users, so orgtable must never be made to call its own network
(server-side request forgery). `app/lib/webhooks/ssrf.ts`:

- Only `https://` URLs without credentials.
- Loopback, private ranges (10/8, 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16,
  including cloud metadata, fe80::/10), carrier-grade NAT, multicast, documentation and reserved
  ranges, and IPv4-mapped IPv6 forms of them are refused.
- The check runs **inside the socket's DNS lookup**, on the address actually connected to, so a
  name that resolves differently later (DNS rebinding) is still caught; IP literals are checked
  before connecting.

`ORGTABLE_WEBHOOKS_ALLOW_PRIVATE=1` lifts it (and allows `http://`) for self-hosters whose targets
are on their own network.

## Incoming webhooks

A secret URL that creates a card in one list each time something POSTs JSON to it (a web form, a
monitoring alert, Zapier):

```bash
curl -X POST https://orgtable.example.org/api/hooks/in/inb_… \
  -H 'content-type: application/json' \
  -d '{"title":"Call Hotel Mar","labels":["lead"],"due":"2026-11-02","assignee":"ana@acme.com"}'
```

- `title` is required; `description`, `due` (a date), `labels` (names of the board's labels;
  unknown ones are ignored) and `assignee` (the email of someone who can open the board) are
  optional. Answers `201 {"id": "<card id>"}`.
- Up to 60 cards a minute per URL and 64 KB per request.
- The URL is shown **once**; only its SHA-256 is stored. "New URL" replaces it at once.
- Cards are created on behalf of whoever made the hook: if they can no longer edit the board, the
  URL answers 403. Creating one needs `integrations.manage` and edit access to the board.
- Cards created this way emit `card.created` to outgoing webhooks too.

## Where it lives

| Piece                       | File                                                                  |
| --------------------------- | --------------------------------------------------------------------- |
| Events, URL rules           | `app/lib/webhooks/events.ts`                                          |
| Rendering per format        | `app/lib/webhooks/render.ts`                                          |
| Queue, sending, retries     | `app/lib/webhooks/dispatch.ts`                                        |
| HTTP client, SSRF guard     | `app/lib/webhooks/http.ts`, `app/lib/webhooks/ssrf.ts`                |
| Signature                   | `app/lib/webhooks/sign.ts`                                            |
| Rules (outgoing / incoming) | `app/lib/services/webhooks.ts`, `app/lib/services/incoming-hooks.ts`  |
| Endpoints                   | `app/api/hooks/in/[token]`, `app/api/cron/webhooks`                   |
| Tests                       | `test/webhooks-pure.test.ts`, `test/integration/webhooks.int.test.ts` |
