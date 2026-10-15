import { describe, it, expect } from "vitest";
import { isPublicAddress } from "@/app/lib/webhooks/ssrf";
import { signatureHeader, verifySignatureHeader } from "@/app/lib/webhooks/sign";
import { WEBHOOK_EVENTS, webhookUrlProblem } from "@/app/lib/webhooks/events";

// The parts of webhooks that need no network or database (docs/webhooks.md).
describe("SSRF guard", () => {
  it("refuses loopback, private, link-local and other non-public ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPublicAddress(ip), ip).toBe(true);
    }
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });
});

describe("signature", () => {
  it("verifies with the right secret and a recent timestamp only", () => {
    const body = '{"event":"card.created"}';
    const header = signatureHeader(["s3cret"], 1_800_000_000, body);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifySignatureHeader("s3cret", header, body, 1_800_000_100)).toBe(true);
    expect(verifySignatureHeader("other", header, body, 1_800_000_100)).toBe(false);
    expect(verifySignatureHeader("s3cret", header, `${body} `, 1_800_000_100)).toBe(false);
    expect(verifySignatureHeader("s3cret", header, body, 1_800_001_000)).toBe(false);
  });

  it("signs with both secrets during a rotation", () => {
    const header = signatureHeader(["new", "old"], 1_800_000_000, "x");
    expect(verifySignatureHeader("new", header, "x", 1_800_000_000)).toBe(true);
    expect(verifySignatureHeader("old", header, "x", 1_800_000_000)).toBe(true);
  });
});

describe("events and URLs", () => {
  it("has the events of the design, each once", () => {
    expect(new Set(WEBHOOK_EVENTS).size).toBe(WEBHOOK_EVENTS.length);
    expect(WEBHOOK_EVENTS).toContain("card.moved");
  });

  it("wants https, no credentials, and the right chat for each format", () => {
    expect(webhookUrlProblem("https://example.com/hook", "JSON")).toBeNull();
    expect(webhookUrlProblem("http://example.com/hook", "JSON")).toBe("not_https");
    expect(webhookUrlProblem("http://example.com/hook", "JSON", true)).toBeNull();
    expect(webhookUrlProblem("https://user:pw@example.com/", "JSON")).toBe("invalid");
    expect(webhookUrlProblem("nonsense", "JSON")).toBe("invalid");
    expect(webhookUrlProblem("https://hooks.slack.com/services/T/B/X", "SLACK")).toBeNull();
    expect(webhookUrlProblem("https://discord.com/api/webhooks/1/abc", "SLACK")).toBe("wrong_service");
    expect(webhookUrlProblem("https://discord.com/api/webhooks/1/abc", "DISCORD")).toBeNull();
    expect(webhookUrlProblem("https://acme.webhook.office.com/webhookb2/x", "TEAMS")).toBeNull();
  });
});
