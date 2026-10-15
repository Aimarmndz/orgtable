import { createHmac, timingSafeEqual } from "node:crypto";

// Signature of outgoing webhooks (docs/webhooks.md, "Verifying the signature"). Header:
//
//   X-Orgtable-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">[,v1=<…>]
//
// The timestamp is signed too, so a captured request cannot be replayed later with a new one.
// During a secret rotation both the new and the previous secret sign (two v1 values).

export function signature(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function signatureHeader(secrets: string[], timestamp: number, body: string): string {
  return [`t=${timestamp}`, ...secrets.map((s) => `v1=${signature(s, timestamp, body)}`)].join(",");
}

/**
 * How a receiver checks it (also used by the tests): one v1 must match, and the timestamp must
 * be recent (5 minutes by default).
 */
export function verifySignatureHeader(
  secret: string,
  header: string,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): boolean {
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > toleranceSeconds) return false;
  const expected = Buffer.from(signature(secret, t, body));
  return parts
    .filter(([k]) => k === "v1")
    .some(([, v]) => v && v.length === expected.length && timingSafeEqual(Buffer.from(v), expected));
}
