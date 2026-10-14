import "server-only";
import { prisma } from "@/app/lib/prisma";

// First-run wizard logic (/setup), separated from the Server Action so it can be tested
// without a request (see test/integration/setup.int.test.ts).

const INSTANCE_ID = "singleton";
// Advisory lock key that serializes setup (any fixed text works: hashtext turns it into
// the integer pg_advisory_xact_lock expects).
const SETUP_LOCK_KEY = "orgtable:setup";

export type SetupOutcome =
  | { ok: true; userId: string }
  | { ok: false; reason: "ALREADY_SETUP" };

/**
 * Creates the administrator and marks the instance as configured, exactly once.
 *
 * Checking `setupCompletedAt` inside the transaction is NOT enough: under READ COMMITTED
 * two concurrent submissions both read "not configured", each creates its ADMIN and the
 * second upsert goes through as an UPDATE. SELECT ... FOR UPDATE does not help either
 * because the InstanceConfig row does not exist yet. The transaction-level advisory lock
 * makes the second wait for the first to commit and, when it checks, see setup done.
 */
export async function completeInstanceSetup(input: {
  instanceName: string;
  name: string;
  email: string;
  passwordHash: string;
}): Promise<SetupOutcome> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SETUP_LOCK_KEY}))`;

    const existing = await tx.instanceConfig.findUnique({
      where: { id: INSTANCE_ID },
    });
    if (existing?.setupCompletedAt) {
      return { ok: false, reason: "ALREADY_SETUP" } as const;
    }
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        role: "ADMIN",
      },
    });
    await tx.instanceConfig.upsert({
      where: { id: INSTANCE_ID },
      create: {
        id: INSTANCE_ID,
        instanceName: input.instanceName,
        setupCompletedAt: new Date(),
      },
      update: { instanceName: input.instanceName, setupCompletedAt: new Date() },
    });
    return { ok: true, userId: user.id } as const;
  });
}
