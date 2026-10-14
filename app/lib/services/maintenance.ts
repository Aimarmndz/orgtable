import "server-only";
import { prisma } from "@/app/lib/prisma";

// Limpieza periódica de datos que no deben guardarse para siempre (principio de limitación
// del plazo de conservación, art. 5.1.e RGPD). La dispara un cron externo con
// POST /api/cron/maintenance, como los recordatorios (ADR 0015). Los plazos están en
// docs/privacy.md y los muestra la política de privacidad, así que salen de aquí y no se
// repiten a mano en otro sitio.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días que se guarda el registro de auditoría (con IPs). Configurable, 90 por defecto. */
export function auditRetentionDays(): number {
  const raw = process.env.ORGTABLE_AUDIT_RETENTION_DAYS;
  if (raw === undefined || raw === "") return 90;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    // Un valor mal escrito no puede convertirse en «borrar todo» ni en «no borrar nunca».
    throw new Error(
      `ORGTABLE_AUDIT_RETENTION_DAYS debe ser un entero >= 1 (recibido: "${raw}")`,
    );
  }
  return n;
}

/** Días que se guardan las sesiones ya cerradas o caducadas antes de borrarlas. */
export const ENDED_SESSION_RETENTION_DAYS = 30;

/** Días que se guarda una notificación, leída o no. */
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
