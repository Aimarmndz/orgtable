import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Encryption of the secrets orgtable has to read back (two-step verification keys, webhook
// signing secrets, S3 credentials, backups): AES-256-GCM with a key derived from
// ORGTABLE_SECRET_KEY. Passwords and tokens are NOT here: those are hashed, never stored.
// See docs/security.md, "Secrets at rest".
//
// - The key comes from the environment, never from the database: a stolen dump alone does
//   not open the secrets.
// - Every value is bound to its place with a `context` (e.g. "totp:<userId>") used as GCM
//   additional data, so a ciphertext copied to another row does not decrypt there.
// - Format "v1.<iv>.<tag>.<ciphertext>" (base64url), so the scheme can change later.

const VERSION = "v1";

export class SecretKeyMissingError extends Error {
  constructor() {
    super(
      "ORGTABLE_SECRET_KEY is not set or is too short (at least 32 characters). " +
        "Generate one with: openssl rand -hex 32",
    );
    this.name = "SecretKeyMissingError";
  }
}

/** Whether the features that keep secrets (2FA, webhooks, S3 backups) can be used. */
export function isSecretKeyConfigured(): boolean {
  const raw = process.env.ORGTABLE_SECRET_KEY?.trim();
  return Boolean(raw && raw.length >= 32);
}

let cached: { raw: string; key: Buffer } | null = null;

function key(): Buffer {
  const raw = process.env.ORGTABLE_SECRET_KEY?.trim();
  if (!raw || raw.length < 32) throw new SecretKeyMissingError();
  if (cached?.raw === raw) return cached.key;
  // HKDF so any long random string works (hex from openssl, base64…), and so this key is
  // never the same bytes as anything else derived from the variable later.
  const derived = Buffer.from(hkdfSync("sha256", raw, "orgtable", "orgtable/secrets/v1", 32));
  cached = { raw, key: derived };
  return derived;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function encryptBytes(plain: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return [VERSION, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join(".");
}

/** Throws if the value was tampered with, belongs to another context or another key. */
export function decryptBytes(value: string, context: string): Buffer {
  const [version, iv, tag, ct] = value.split(".");
  if (version !== VERSION || !iv || !tag || ct === undefined) throw new Error("Unknown secret format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
}

export function encryptSecret(plain: string, context: string): string {
  return encryptBytes(Buffer.from(plain, "utf8"), context);
}

export function decryptSecret(value: string, context: string): string {
  return decryptBytes(value, context).toString("utf8");
}
