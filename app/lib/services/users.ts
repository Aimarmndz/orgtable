import "server-only";
import { prisma } from "@/app/lib/prisma";
import { hashPassword } from "@/app/lib/auth";
import type { GlobalRole } from "@/app/lib/roles";
import {
  createPersonalWorkspace,
  prepareAccountDeletion,
  soleOwnedOrganizations,
} from "@/app/lib/services/workspaces";

// User account business logic, WITHOUT request context (cookies/session), authorization
// or auditing: the Server Actions that call it handle those (app/lib/actions/admin.ts,
// setup.ts). Isolating it this way makes it reusable and, above all, directly testable
// against the database (see test/integration/users.int.test.ts).

export type NewUserInput = {
  name: string;
  email: string;
  password: string;
  role: GlobalRole;
  // Only for open registration (/register): when they accepted the policy and terms.
  termsAcceptedAt?: Date;
  // Interface language at sign-up (open registration), for their notifications.
  locale?: string;
};

export type CreateUserResult =
  | { ok: true; user: { id: string; email: string } }
  | { ok: false; error: "email_taken" };

/**
 * Creates an account: lowercases the email, rejects duplicates and ALWAYS stores the
 * password hashed (bcrypt, never in plain text). Email uniqueness is also enforced by
 * the column's unique index. The account's personal workspace (its handle, the first
 * segment of its board URLs) is created in the same transaction.
 */
export async function createUserAccount(
  input: NewUserInput,
): Promise<CreateUserResult> {
  const email = input.email.trim().toLowerCase();

  const exists = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (exists) return { ok: false, error: "email_taken" };

  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: input.name,
          passwordHash,
          role: input.role,
          termsAcceptedAt: input.termsAcceptedAt ?? null,
          locale: input.locale ?? null,
        },
        select: { id: true, email: true, name: true },
      });
      await createPersonalWorkspace(tx, created);
      return { id: created.id, email: created.email };
    });
    return { ok: true, user };
  } catch (e) {
    // Two concurrent sign-ups with the same email both pass the check above and the
    // second hits the unique index. With open registration this is easy (double click),
    // so it is answered as a normal duplicate instead of a 500.
    if (isUniqueViolation(e)) return { ok: false, error: "email_taken" };
    throw e;
  }
}

/** Prisma error for a unique index violation (P2002). */
export function isUniqueViolation(e: unknown): boolean {
  return e instanceof Error && "code" in e && e.code === "P2002";
}

export type ResetPasswordResult =
  | { ok: true; revokedTokens: number }
  | { ok: false; error: "not_found" };

/**
 * Resets a user's password and removes ALL their current access: revokes their sessions
 * and deletes their API tokens. Tokens do not depend on the Session table, so revoking
 * only sessions would leave the API (/api/v1) open to whoever created a token with the
 * compromised account. Deleting is the revocation semantics of ADR 0013.
 *
 * The user's existence is checked BEFORE hashing (bcrypt is expensive) and the three
 * changes run in one transaction: either all apply or none.
 */
export async function resetPasswordAndRevokeAccess(
  userId: string,
  password: string,
): Promise<ResetPasswordResult> {
  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!exists) return { ok: false, error: "not_found" };

  const passwordHash = await hashPassword(password);
  const [updated, , tokens] = await prisma.$transaction([
    prisma.user.updateMany({ where: { id: userId }, data: { passwordHash } }),
    prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.apiToken.deleteMany({ where: { userId } }),
  ]);
  // The user may have been deleted between the check and the transaction.
  if (updated.count === 0) return { ok: false, error: "not_found" };
  return { ok: true, revokedTokens: tokens.count };
}

export type DeleteUserResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "owns_boards" | "sole_owner" };

/**
 * Deletes an account that owns NO boards. The condition lives in the DELETE itself
 * (`boards: { none: {} }`) rather than in a prior query: if the user created a board
 * between the check and the deletion, the ownerId cascade would take its lists, cards
 * and Attachment rows, leaving orphaned binaries in the attachments volume. This way the
 * cascade never reaches attachments.
 */
export async function deleteUserAccount(
  userId: string,
): Promise<DeleteUserResult> {
    // Organizations: the same rules as deleting one's own account (services/workspaces.ts),
  // so an administrator cannot leave an organization without an owner either.
  const prepared = await prepareAccountDeletion(userId);
  if (!prepared.ok) return { ok: false, error: "sole_owner" };
  const count = await prisma.$transaction(async (tx) => {
    if ((await soleOwnedOrganizations(tx, userId)).length > 0) return -1;
    const deleted = await tx.user.deleteMany({ where: { id: userId, boards: { none: {} } } });
    return deleted.count;
  });
  if (count === -1) return { ok: false, error: "sole_owner" };
  if (count > 0) return { ok: true };
  const exists = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  return { ok: false, error: exists ? "owns_boards" : "not_found" };
}
