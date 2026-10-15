import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@/app/lib/prisma";
import {
  createWebhook,
  deleteWebhook,
  pingWebhook,
  redeliver,
  rotateWebhookSecret,
  updateWebhook,
} from "@/app/lib/services/webhooks";
import { DISABLE_AFTER, processDeliveries } from "@/app/lib/webhooks/dispatch";
import { postWebhook } from "@/app/lib/webhooks/http";
import { verifySignatureHeader } from "@/app/lib/webhooks/sign";
import { createIncomingHook, receiveIncomingCard, regenerateIncomingHook } from "@/app/lib/services/incoming-hooks";
import { createCard } from "@/app/lib/actions/cards";
import { createCustomRole } from "@/app/lib/services/roles";
import { changeMemberRole, removeMember } from "@/app/lib/services/workspaces";
import {
  resetDb,
  disconnect,
  seedUser,
  seedBoard,
  seedOrganization,
  addWorkspaceMember,
  seedList,
  loginAs,
  formOf,
} from "./helpers";

// Outgoing and incoming webhooks (docs/webhooks.md), against a real HTTP server on localhost.
// Private targets are allowed here (ORGTABLE_ALLOW_PRIVATE_TARGETS), as a self-hoster would;
// the guard itself is tested with it switched off.

type Received = { headers: http.IncomingHttpHeaders; body: string };
const received: Received[] = [];
let answer = 200;
let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.writeHead(answer, { "content-type": "text/plain" });
      res.end(answer === 200 ? "ok" : "nope");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb();
  received.length = 0;
  answer = 200;
  process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS = "1";
  await prisma.instanceConfig.create({
    data: { id: "singleton", instanceName: "Test", setupCompletedAt: new Date() },
  });
});

afterAll(async () => {
  delete process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS;
  await new Promise((r) => server.close(r));
  await disconnect();
});

async function settle(where: object = {}) {
  for (let i = 0; i < 100; i++) {
    const pending = await prisma.webhookDelivery.count({ where: { status: "PENDING", attempts: 0, ...where } });
    if (pending === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("deliveries did not settle");
}

async function seedCompany() {
  const owner = await seedUser({ name: "Owner" });
  const member = await seedUser({ name: "Member" });
  const org = await seedOrganization(owner.id, "acme");
  await addWorkspaceMember(org.id, member.id, "MEMBER");
  const board = await seedBoard(owner.id, "Roadmap", { workspaceId: org.id });
  const list = await seedList(board.id, "To do");
  return { owner, member, org, board, list };
}

const HOOK = { name: "CI", format: "JSON" as const, boardId: null, events: ["card.created", "card.deleted"] };

describe("managing webhooks", () => {
  it("needs integrations.manage and a valid URL with events", async () => {
    const { owner, member, org } = await seedCompany();
    expect(await createWebhook({ workspaceId: org.id, actorId: member.id, webhook: { ...HOOK, url: base } })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base, events: ["nope"] } })).toEqual({
      ok: false,
      error: "no_events",
    });
    delete process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS;
    expect(await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base } })).toEqual({
      ok: false,
      error: "not_https",
    });
    process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS = "1";
    const ok = await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base } });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.secret).toMatch(/^whsec_/);
    const row = await prisma.webhook.findUniqueOrThrow({ where: { id: ok.id } });
    expect(row.secretEnc).not.toContain(ok.secret);
  });

  it("never touches another organization's webhooks or boards", async () => {
    const { owner, org } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const theirBoard = await seedBoard(stranger.id, "Theirs", { workspaceId: globex.id });
    expect(
      await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base, boardId: theirBoard.id } }),
    ).toEqual({ ok: false, error: "not_found" });
    const theirs = await createWebhook({ workspaceId: globex.id, actorId: stranger.id, webhook: { ...HOOK, url: base } });
    if (!theirs.ok) throw new Error(theirs.error);
    expect(await updateWebhook({ workspaceId: org.id, actorId: owner.id, webhookId: theirs.id, webhook: { ...HOOK, url: base } })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await deleteWebhook({ workspaceId: org.id, actorId: owner.id, webhookId: theirs.id })).toEqual({ ok: false, error: "not_found" });
    expect(await rotateWebhookSecret({ workspaceId: org.id, actorId: owner.id, webhookId: theirs.id })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("delivery", () => {
  it("sends a signed event when a card is created", async () => {
    const { owner, org, list } = await seedCompany();
    const hook = await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base } });
    if (!hook.ok) throw new Error(hook.error);
    await loginAs(owner.id);
    await createCard(formOf({ listId: list.id, title: "Ship it" }));
    await settle();
    expect(received).toHaveLength(1);
    const [req] = received;
    expect(req.headers["x-orgtable-event"]).toBe("card.created");
    expect(verifySignatureHeader(hook.secret, String(req.headers["x-orgtable-signature"]), req.body, Date.now() / 1000)).toBe(true);
    const payload = JSON.parse(req.body);
    expect(payload).toMatchObject({
      event: "card.created",
      workspace: { slug: "acme" },
      actor: { id: owner.id, name: "Owner" },
      data: { card: { title: "Ship it" } },
    });
    const d = await prisma.webhookDelivery.findFirstOrThrow();
    expect(d).toMatchObject({ status: "SUCCESS", attempts: 1, responseStatus: 200 });
  });

  it("keeps private boards out of organization-wide webhooks", async () => {
    const { owner, org } = await seedCompany();
    const secret = await seedBoard(owner.id, "Salaries", { workspaceId: org.id, visibility: "PRIVATE" });
    const list = await seedList(secret.id);
    await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: `${base}/org` } });
    await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: `${base}/board`, boardId: secret.id } });
    await loginAs(owner.id);
    await createCard(formOf({ listId: list.id, title: "Raise" }));
    await settle();
    expect(received).toHaveLength(1);
    expect(await prisma.webhookDelivery.count()).toBe(1);
  });

  it("only lets someone who can open a board make a webhook for it", async () => {
    const { owner, member, org } = await seedCompany();
    const role = await createCustomRole({
      workspaceId: org.id,
      actorId: owner.id,
      role: { name: "Integrator", color: "blue", description: null, permissions: ["integrations.manage"] },
    });
    if (!role.ok) throw new Error(role.error);
    await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: member.id, role: "MEMBER", customRoleId: role.id });
    const secret = await seedBoard(owner.id, "Salaries", { workspaceId: org.id, visibility: "PRIVATE" });
    expect(
      await createWebhook({ workspaceId: org.id, actorId: member.id, webhook: { ...HOOK, url: base, boardId: secret.id } }),
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("retries a failure later and succeeds", async () => {
    const { owner, org, list } = await seedCompany();
    await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base } });
    answer = 500;
    await loginAs(owner.id);
    await createCard(formOf({ listId: list.id, title: "Flaky" }));
    await settle();
    let d = await prisma.webhookDelivery.findFirstOrThrow();
    expect(d).toMatchObject({ status: "PENDING", attempts: 1, responseStatus: 500 });
    expect(d.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    answer = 200;
    await prisma.webhookDelivery.update({ where: { id: d.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await processDeliveries()).toBe(1);
    d = await prisma.webhookDelivery.findFirstOrThrow();
    expect(d).toMatchObject({ status: "SUCCESS", attempts: 2 });
    expect(received).toHaveLength(2);
    expect(received[0].body).toBe(received[1].body);
  });

  it("switches a webhook off after too many final failures", async () => {
    const { owner, org } = await seedCompany();
    const hook = await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base } });
    if (!hook.ok) throw new Error(hook.error);
    await prisma.webhook.update({ where: { id: hook.id }, data: { consecutiveFailures: DISABLE_AFTER - 1 } });
    answer = 500;
    const d = await prisma.webhookDelivery.create({
      data: { webhookId: hook.id, event: "card.created", body: "{}", attempts: 5, nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await processDeliveries([d.id]);
    expect((await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("FAILED");
    expect((await prisma.webhook.findUniqueOrThrow({ where: { id: hook.id } })).disabledAt).not.toBeNull();
  });

  it("signs with both secrets for a day after a rotation, and pings and redelivers", async () => {
    const { owner, org } = await seedCompany();
    const hook = await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: base } });
    if (!hook.ok) throw new Error(hook.error);
    const rotated = await rotateWebhookSecret({ workspaceId: org.id, actorId: owner.id, webhookId: hook.id });
    if (!rotated.ok) throw new Error(rotated.error);
    const ping = await pingWebhook({ workspaceId: org.id, actorId: owner.id, webhookId: hook.id });
    if (!ping.ok) throw new Error(ping.error);
    const sig = String(received[0].headers["x-orgtable-signature"]);
    const now = Date.now() / 1000;
    expect(verifySignatureHeader(rotated.secret, sig, received[0].body, now)).toBe(true);
    expect(verifySignatureHeader(hook.secret, sig, received[0].body, now)).toBe(true);
    expect(received[0].headers["x-orgtable-event"]).toBe("ping");
    const again = await redeliver({ workspaceId: org.id, actorId: owner.id, deliveryId: ping.deliveryId });
    expect(again.ok).toBe(true);
    expect(received).toHaveLength(2);
  });
});

describe("chat formats", () => {
  it("escapes what users typed so it cannot ping everyone", async () => {
    const { owner, org, list } = await seedCompany();
    await createWebhook({
      workspaceId: org.id,
      actorId: owner.id,
      webhook: { ...HOOK, url: `${base}/slack`, format: "JSON", events: ["card.created"] },
    });
    // The chat formats only accept their own hosts; written directly to test the rendering.
    await prisma.webhook.updateMany({ data: { format: "SLACK" } });
    const discord = await createWebhook({ workspaceId: org.id, actorId: owner.id, webhook: { ...HOOK, url: `${base}/discord`, events: ["card.created"] } });
    if (!discord.ok) throw new Error(discord.error);
    await prisma.webhook.update({ where: { id: discord.id }, data: { format: "DISCORD" } });
    await loginAs(owner.id);
    await createCard(formOf({ listId: list.id, title: "<!channel> @everyone" }));
    await settle();
    const slack = received.find((r) => r.body.includes('"text"'));
    const disc = received.find((r) => r.body.includes('"content"'));
    expect(JSON.parse(slack!.body).text).toContain("&lt;!channel&gt;");
    expect(JSON.parse(disc!.body).allowed_mentions).toEqual({ parse: [] });
  });
});

describe("SSRF guard", () => {
  it("refuses to connect to a private address when not allowed", async () => {
    delete process.env.ORGTABLE_ALLOW_PRIVATE_TARGETS;
    const r = await postWebhook(`${base}/x`, "{}", {});
    expect(r.ok).toBe(false);
    expect("error" in r && r.error).toMatch(/non-public/);
    const local = await postWebhook(`http://localhost:${new URL(base).port}/x`, "{}", {});
    expect(local.ok).toBe(false);
    expect(received).toHaveLength(0);
  });
});

describe("incoming webhooks", () => {
  it("creates cards with labels and an assignee, and stops when its URL changes", async () => {
    const { owner, member, org, board, list } = await seedCompany();
    const label = await prisma.label.create({ data: { boardId: board.id, name: "Lead", color: "green" } });
    const hook = await createIncomingHook({ workspaceId: org.id, actorId: owner.id, name: "Form", listId: list.id });
    if (!hook.ok) throw new Error(hook.error);
    const r = await receiveIncomingCard(hook.token, { title: "Call Hotel Mar", labels: ["lead", "unknown"], assignee: "x@x.com" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const card = await prisma.card.findUniqueOrThrow({ where: { id: r.cardId }, include: { labels: true } });
    expect(card).toMatchObject({ title: "Call Hotel Mar", listId: list.id });
    expect(card.labels.map((l) => l.labelId)).toEqual([label.id]);
    const memberEmail = (await prisma.user.findUniqueOrThrow({ where: { id: member.id } })).email;
    const r2 = await receiveIncomingCard(hook.token, { title: "Two", assignee: memberEmail });
    if (!r2.ok) throw new Error(r2.error);
    expect(await prisma.cardAssignee.count({ where: { cardId: r2.cardId, userId: member.id } })).toBe(1);
    expect((await receiveIncomingCard(hook.token, { nope: true })).ok).toBe(false);
    const regen = await regenerateIncomingHook({ workspaceId: org.id, actorId: owner.id, hookId: hook.id });
    if (!regen.ok) throw new Error(regen.error);
    expect(await receiveIncomingCard(hook.token, { title: "Old URL" })).toMatchObject({ ok: false, status: 404 });
    expect((await receiveIncomingCard(regen.token, { title: "New URL" })).ok).toBe(true);
  });

  it("stops working when its creator loses access", async () => {
    const { owner, member, org, list } = await seedCompany();
    const role = await createCustomRole({
      workspaceId: org.id,
      actorId: owner.id,
      role: { name: "Integrator", color: "blue", description: null, permissions: ["integrations.manage"] },
    });
    if (!role.ok) throw new Error(role.error);
    await changeMemberRole({ workspaceId: org.id, actorId: owner.id, userId: member.id, role: "MEMBER", customRoleId: role.id });
    const hook = await createIncomingHook({ workspaceId: org.id, actorId: member.id, name: "Form", listId: list.id });
    if (!hook.ok) throw new Error(hook.error);
    await removeMember({ workspaceId: org.id, actorId: owner.id, userId: member.id });
    expect(await receiveIncomingCard(hook.token, { title: "Nope" })).toMatchObject({ ok: false, status: 403 });
  });

  it("only takes lists of the organization's boards", async () => {
    const { owner, org } = await seedCompany();
    const stranger = await seedUser();
    const globex = await seedOrganization(stranger.id, "globex");
    const theirs = await seedList((await seedBoard(stranger.id, "Theirs", { workspaceId: globex.id })).id);
    expect(await createIncomingHook({ workspaceId: org.id, actorId: owner.id, name: "X", listId: theirs.id })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await receiveIncomingCard("inb_nonsense", { title: "x" })).toMatchObject({ ok: false, status: 404 });
  });
});
