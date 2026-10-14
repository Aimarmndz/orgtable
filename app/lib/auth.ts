import "server-only";
import bcrypt from "bcryptjs";

// Password hashing with bcryptjs (pure JS, no native build: zero friction in the Alpine
// image). See docs/authentication.md.

export const SALT_ROUNDS = 12;

// REAL bcrypt hash (60 characters, cost SALT_ROUNDS) of a random UUID that was never
// stored: no password matches it. It burns the same time when the email does not exist.
// It must be a valid hash: with a malformed literal (the previous one was 59 long)
// bcrypt.compare returns false instantly and the response time reveals whether an account
// exists. It is a literal to avoid paying for a hashSync when the module is imported.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$llgSC9FXycV4gh6.tWFq..r2hz9NXMksFmfWuDrIuN7lf.C.qa5pq";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Checks the password against `hash` or, when there is no account (`null`), against the
 * dummy hash, which always gives false after the same bcrypt work. That way sign-in takes
 * the same time whether or not the email exists.
 */
export async function verifyPasswordOrDummy(
  password: string,
  hash: string | null,
): Promise<boolean> {
  const valid = await verifyPassword(password, hash ?? DUMMY_PASSWORD_HASH);
  return hash !== null && valid;
}
