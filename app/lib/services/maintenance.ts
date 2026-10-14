import "server-only";
import { prisma } from "@/app/lib/prisma";

// Periodic cleanup of data that must not be kept forever (storage limitation principle,
// GDPR art. 5.1.e). Triggered by an external cron via POST /api/cron/maintenance, like
// the reminders (ADR 0015). The retention periods are in docs/privacy.md and shown by the
// privacy policy, so they come from here and are not repeated by hand elsewhere.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days the audit log (with IPs) is kept. Configurable, 90 by default. */
export function auditRetentionDays(): number {
  const raw = process.env.ORGTABLE_AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw === "") return 90;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    // A typo must not turn into "delete everything" or "never delete".
    throw new Error(
      `ORGTABLE_AUDIT_RETENTION_DAYS must be an integer >= 1 (got: "${raw}")`,
    );
  }
  return n;
}

/** Days that closed or expired sessions are kept before being deleted. */
export const ENDED_SESSION_RETENTION_DAYS = 30;

/** Days a notification is kept, read or not. */
export const NOTIFICATION_RETENTION_DAYS = 180;

export type MaintenanceResult = {
  auditLogsDeleted: number;
  sessionsDeleted: number;
  notificationsDeleted: number;
};

export async function purgeExpiredData(now: Date): Promise<MaintenanceResult> {
  const auditCutoff = new Date(now.getTime() - auditRetentionDays() * DAY_MS);
  const sessionCutoff = new Date(now.getTime() - ENDED_SESSION_RETENTION_DAYS * DAY_MS);
  const notificationCutoff = new Date(
    now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS,
  );

  const [audit, sessions, notifications] = await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { createdAt: { lt: auditCutoff } } }),
    prisma.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: sessionCutoff } },
          { revokedAt: { lt: sessionCutoff } },
        ],
      },
    }),
    prisma.notification.deleteMany({ where: { createdAt: { lt: notificationCutoff } } }),
  ]);

  return {
    auditLogsDeleted: audit.count,
    sessionsDeleted: sessions.count,
    notificationsDeleted: notifications.count,
  };
}
