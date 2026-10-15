import "server-only";
import { randomBytes, createHash } from "node:crypto";

// Generation and hashing of personal access tokens. The token is shown to the user ONCE;
// only its SHA-256 hash is stored in the database. See docs/decisions/0013-api-tokens.md.

const PREFIX = "orgt_";
// Organization keys (WorkspaceApiKey) start with this instead, so authentication knows which
// table to look in.
export const ORG_KEY_PREFIX = "ot_org_";

export type GeneratedToken = {
  /** Full plain-text token. Shown only once; never persisted. */
  token: string;
  /** SHA-256 hash (hex) that is stored and looked up on authentication. */
  hash: string;
  /** First characters, so the user can identify the token in the list. */
  prefix: string;
};

/** Hex SHA-256 of a token. Deterministic: same input → same hash. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a new token: 24 random bytes in base64url with the `orgt_` prefix. */
export function generateApiToken(): GeneratedToken {
  const token = PREFIX + randomBytes(24).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    // Visible prefix (e.g. "orgt_Ab3kQ9x"): enough to recognise it without revealing it.
    prefix: token.slice(0, PREFIX.length + 7),
  };
}

/** A new organization key, like generateApiToken but with ORG_KEY_PREFIX. */
export function generateOrgKey(): GeneratedToken {
  const token = ORG_KEY_PREFIX + randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token), prefix: token.slice(0, ORG_KEY_PREFIX.length + 6) };
}
