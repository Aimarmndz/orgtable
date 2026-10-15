import { describe, it, expect } from "vitest";
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  normalizeRecoveryCode,
  totpStep,
  totpUri,
  verifyTotp,
} from "@/app/lib/totp";

// RFC 4226 / 6238 test vectors and the rules on top (drift, replay).
const RFC_SECRET = Buffer.from("12345678901234567890");

describe("TOTP", () => {
  it("matches the RFC 4226 HOTP test vectors", () => {
    const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
    expected.forEach((code, i) => expect(hotp(RFC_SECRET, i)).toBe(code));
  });

  it("matches the RFC 6238 SHA-1 vectors (last six digits)", () => {
    expect(hotp(RFC_SECRET, totpStep(59_000))).toBe("287082");
    expect(hotp(RFC_SECRET, totpStep(1_111_111_109_000))).toBe("081804");
    expect(hotp(RFC_SECRET, totpStep(2_000_000_000_000))).toBe("279037");
  });

  it("round-trips base32", () => {
    const b = Buffer.from("orgtable two-step");
    expect(base32Decode(base32Encode(b)).toString()).toBe("orgtable two-step");
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("accepts one step of drift and refuses replays", () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    const code = hotp(base32Decode(secret), step);
    expect(verifyTotp(secret, code, now)).toBe(step);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(step);
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, code, now, step)).toBeNull();
    expect(verifyTotp(secret, "12345", now)).toBeNull();
    expect(verifyTotp(secret, "abcdef", now)).toBeNull();
  });

  it("builds the otpauth address authenticator apps read", () => {
    const uri = totpUri("ABC", "ana@example.com", "orgtable");
    expect(uri).toBe(
      "otpauth://totp/orgtable%3Aana%40example.com?secret=ABC&issuer=orgtable&algorithm=SHA1&digits=6&period=30",
    );
  });

  it("makes distinct recovery codes that survive sloppy typing", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(normalizeRecoveryCode(" ABCDE-fghij ")).toBe("abcdefghij");
  });
});
