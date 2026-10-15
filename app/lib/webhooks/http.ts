import "server-only";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { isPublicAddress, privateTargetsAllowed, safeLookup } from "@/app/lib/webhooks/ssrf";

// One POST to a webhook URL (docs/webhooks.md). No redirects are followed (a 3xx is a
// failure: a redirect could point back inside), every name goes through safeLookup and every
// IP literal through the same check,
// the whole exchange has a timeout and only the first 4 KB of the answer are kept.

export const WEBHOOK_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4096;

export type PostResult =
  | { ok: boolean; status: number; body: string; durationMs: number }
  | { ok: false; status: null; error: string; durationMs: number };

export function postWebhook(
  url: string,
  body: string,
  headers: Record<string, string>,
  timeoutMs = WEBHOOK_TIMEOUT_MS,
): Promise<PostResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      resolve({ ok: false, status: null, error: "Invalid URL", durationMs: 0 });
      return;
    }
    // An IP literal never goes through DNS, so safeLookup would not see it: checked here.
    const literal = target.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !privateTargetsAllowed() && !isPublicAddress(literal)) {
      resolve({ ok: false, status: null, error: `Refusing to connect to a non-public address (${literal})`, durationMs: 0 });
      return;
    }
    const client = target.protocol === "https:" ? https : http;
    const req = client.request(
      target,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(body),
          "user-agent": "orgtable-webhooks/1",
          ...headers,
        },
        lookup: safeLookup as never,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          if (size < MAX_RESPONSE_BYTES) chunks.push(chunk.subarray(0, MAX_RESPONSE_BYTES - size));
          size += chunk.length;
        });
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            body: Buffer.concat(chunks).toString("utf8"),
            durationMs: Date.now() - started,
          });
        });
        res.on("error", (err) => resolve({ ok: false, status: null, error: err.message, durationMs: Date.now() - started }));
      },
    );
    const timer = setTimeout(() => req.destroy(new Error(`Timed out after ${timeoutMs} ms`)), timeoutMs);
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${timeoutMs} ms`)));
    req.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, status: null, error: err.message.slice(0, 300), durationMs: Date.now() - started });
    });
    req.on("close", () => clearTimeout(timer));
    req.end(body);
  });
}
