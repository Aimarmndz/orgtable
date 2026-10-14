import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  DUMMY_PASSWORD_HASH,
  SALT_ROUNDS,
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from "@/app/lib/auth";

// Dummy sign-in hash: it has to be a valid bcrypt hash with the same cost as the real
// ones. The previous literal was 59 characters long, bcrypt.compare returned false
// instantly and a non-existent email answered ~200 times faster than an existing one.
describe("dummy sign-in hash", () => {
  it("is 60 characters long and uses the same cost as hashPassword", () => {
    expect(DUMMY_PASSWORD_HASH).toHaveLength(60);
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(SALT_ROUNDS);
  });

  it("matches no password and does not throw", async () => {
    await expect(verifyPassword("x", DUMMY_PASSWORD_HASH)).resolves.toBe(false);
    await expect(verifyPasswordOrDummy("x", null)).resolves.toBe(false);
  });

  it("verifyPasswordOrDummy accepts the correct password of a real account", async () => {
    const hash = await hashPassword("correct");
    await expect(verifyPasswordOrDummy("correct", hash)).resolves.toBe(true);
    await expect(verifyPasswordOrDummy("other", hash)).resolves.toBe(false);
  });

  // It used to time a single call of each kind: a GC pause or a busy CI runner was enough
  // to make it fail without code changes. What matters is that the no-account path does
  // the same bcrypt work against the dummy hash; that this hash costs the same as a real
  // one is already checked by the first test.
  it("without an account it compares against the dummy hash with bcrypt", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    try {
      await verifyPasswordOrDummy("wrong", null);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("wrong", DUMMY_PASSWORD_HASH);
    } finally {
      spy.mockRestore();
    }
  });
});
