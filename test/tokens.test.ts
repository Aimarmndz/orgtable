import { describe, it, expect } from "vitest";
import { hashToken, generateApiToken } from "@/app/lib/api/tokens";

// Public API tokens (milestone 9, ADR 0013). Invariants: the hash is a stable SHA-256,
// the token carries the `orgt_` prefix, its hash matches and it never repeats.
describe("api tokens", () => {
  it("hashToken is deterministic and SHA-256 in hex (64 chars)", () => {
    const h = hashToken("orgt_example");
    expect(h).toBe(hashToken("orgt_example"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("other")).not.toBe(h);
  });

  it("generateApiToken: orgt_ prefix, consistent hash and a 12-character visible prefix", () => {
    const t = generateApiToken();
    expect(t.token.startsWith("orgt_")).toBe(true);
    expect(t.hash).toBe(hashToken(t.token));
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.token.startsWith(t.prefix)).toBe(true);
    expect(t.prefix.length).toBe(12); // "orgt_" (5) + 7 characters
  });

  it("two consecutive tokens are different", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toBe(b.hash);
  });
});
