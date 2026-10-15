import "server-only";
import { createHash, createHmac } from "node:crypto";
import { safeRequest } from "@/app/lib/webhooks/http";

// A minimal S3 client (AWS Signature Version 4) for backups: put, get and delete one object.
// It speaks to AWS S3 and to the compatible services (Cloudflare R2, Backblaze B2, MinIO,
// Wasabi…). AWS endpoints use virtual-hosted URLs; any other endpoint uses path-style
// (endpoint/bucket/key), which every compatible service supports. Requests go through the
// same SSRF guard as webhooks (app/lib/webhooks/ssrf.ts). See docs/backups.md.

export type S3Target = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
};

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

// RFC 3986 encoding as SigV4 wants it (every character but unreserved ones).
function encode(s: string, keepSlash = false): string {
  return encodeURIComponent(s)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(keepSlash ? /%2F/g : /$^/, "/");
}

function objectUrl(t: S3Target, key: string): URL {
  const base = new URL(t.endpoint);
  const virtual = /(^|\.)amazonaws\.com$/.test(base.hostname);
  const host = virtual ? `${t.bucket}.${base.host}` : base.host;
  const path = virtual ? `/${encode(key, true)}` : `/${encode(t.bucket)}/${encode(key, true)}`;
  return new URL(`${base.protocol}//${host}${path}`);
}

/** The headers of a signed request (exported for the tests against the AWS examples). */
export function signRequest(
  method: string,
  url: URL,
  t: Pick<S3Target, "region" | "accessKey" | "secretKey">,
  payloadHash: string,
  now: Date,
  extra: Record<string, string> = {},
): Record<string, string> {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: url.host,
    ...extra,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedHeaders = Object.keys(headers).sort();
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .sort()
    .join("&");
  const canonical = [
    method,
    url.pathname,
    canonicalQuery,
    signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join(""),
    signedHeaders.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${date}/${t.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${t.secretKey}`, date), t.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${t.accessKey}/${scope}, SignedHeaders=${signedHeaders.join(";")}, Signature=${signature}`,
  };
}

async function call(t: S3Target, method: string, key: string, body: Buffer | null) {
  const url = objectUrl(t, key);
  const headers = signRequest(method, url, t, sha256(body ?? ""), new Date());
  if (body) headers["content-type"] = "application/octet-stream";
  const r = await safeRequest(method, url.toString(), headers, body);
  if (!r.ok) {
    const detail = r.status === null ? r.error : `HTTP ${r.status}: ${r.body.toString("utf8").slice(0, 300)}`;
    throw new Error(`S3 ${method} failed (${detail})`);
  }
  return r;
}

export async function s3Put(t: S3Target, key: string, body: Buffer): Promise<void> {
  await call(t, "PUT", key, body);
}

export async function s3Get(t: S3Target, key: string): Promise<Buffer> {
  return (await call(t, "GET", key, null)).body;
}

export async function s3Delete(t: S3Target, key: string): Promise<void> {
  await call(t, "DELETE", key, null);
}

/** Writes, reads back and deletes a small object: what "Test connection" does. */
export async function s3Test(t: S3Target, prefix: string): Promise<void> {
  const key = `${prefix}orgtable-connection-test-${Date.now()}.txt`;
  const body = Buffer.from("orgtable backup connection test\n");
  await s3Put(t, key, body);
  const back = await s3Get(t, key);
  if (!back.equals(body)) throw new Error("S3 returned something else than what was written");
  await s3Delete(t, key);
}
