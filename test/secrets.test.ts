import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SecretKeyMissingError,
  decryptBytes,
  decryptSecret,
  encryptBytes,
  encryptSecret,
  isSecretKeyConfigured,
} from "@/app/lib/crypto/secrets";

// Secrets at rest (docs/security.md): AES-256-GCM with a key from ORGTABLE_SECRET_KEY, bound
// to the place each value belongs to.
const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.ORGTABLE_SECRET_KEY;
  process.env.ORGTABLE_SECRET_KEY = KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.ORGTABLE_SECRET_KEY;
  else process.env.ORGTABLE_SECRET_KEY = saved;
});

describe("secrets", () => {
  it("round-trips, with a fresh IV every time", () => {
    const a = encryptSecret("hunter2", "totp:u1");
    const b = encryptSecret("hunter2", "totp:u1");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(decryptSecret(a, "totp:u1")).toBe("hunter2");
    expect(decryptBytes(encryptBytes(Buffer.from([0, 1, 2]), "x"), "x")).toEqual(Buffer.from([0, 1, 2]));
  });

  it("refuses another context, a tampered value and another key", () => {
    const v = encryptSecret("hunter2", "totp:u1");
    expect(() => decryptSecret(v, "totp:u2")).toThrow();
    const parts = v.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), "totp:u1")).toThrow();
    process.env.ORGTABLE_SECRET_KEY = "another-key-another-key-another-key-0000";
    expect(() => decryptSecret(v, "totp:u1")).toThrow();
  });

  it("fails loudly without a key, or with a short one", () => {
    delete process.env.ORGTABLE_SECRET_KEY;
    expect(isSecretKeyConfigured()).toBe(false);
    expect(() => encryptSecret("x", "c")).toThrow(SecretKeyMissingError);
    process.env.ORGTABLE_SECRET_KEY = "short";
    expect(isSecretKeyConfigured()).toBe(false);
    expect(() => encryptSecret("x", "c")).toThrow(SecretKeyMissingError);
  });
});
