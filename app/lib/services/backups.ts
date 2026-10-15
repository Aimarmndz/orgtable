import "server-only";
import { prisma } from "@/app/lib/prisma";
import { workspaceAccessOf } from "@/app/lib/access";
import { canManageWorkspace } from "@/app/lib/roles";
import { encryptSecret, isSecretKeyConfigured } from "@/app/lib/crypto/secrets";
import { instanceTimeZone } from "@/app/lib/format-date";
import { buildOrganizationZip, readOrganizationZip, InvalidArchiveError } from "@/app/lib/backups/organization";
import { importOrganization, type ImportSummary } from "@/app/lib/backups/import";
import { buildInstanceZip, restoreInstanceZip } from "@/app/lib/backups/instance";
import { s3Test } from "@/app/lib/backups/s3";
import {
  cleanPrefix,
  deleteBackupFile,
  loadBackupFile,
  s3SecretContext,
  s3TargetOf,
  storeBackupFile,
  type DestinationConfig,
} from "@/app/lib/backups/store";
import { webhookUrlProblem } from "@/app/lib/webhooks/events";
import { privateTargetsAllowed } from "@/app/lib/webhooks/ssrf";

// Backups of an organization (workspaceId) or of the whole instance (null). Business rules;
// the actions resolve who is acting and audit. See docs/backups.md.
//
// - An organization's backups need "backups.manage" (owners, admins, or a custom role);
//   exporting needs "data.export". The instance's are for its administrator (callers check).
// - Importing or restoring first takes a backup of what is there now, and does not go on if
//   that backup fails.

export type BackupScope = { workspaceId: string } | { instance: true };
export type BackupError = "forbidden" | "not_found" | "invalid_archive" | "safety_backup_failed" | "bad_destination" | "no_key";

const configId = (workspaceId: string | null) => workspaceId ?? "instance";
const scopeName = (workspaceId: string | null) => (workspaceId ? `org-${workspaceId}` : "instance");

export async function mayManageBackups(workspaceId: string, actorId: string): Promise<boolean> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { kind: true, suspendedAt: true } });
  if (!workspace || workspace.kind !== "ORGANIZATION" || workspace.suspendedAt) return false;
  return Boolean((await workspaceAccessOf(workspaceId, actorId))?.permissions.has("backups.manage"));
}

export async function backupConfig(workspaceId: string | null) {
  return prisma.backupConfig.upsert({
    where: { id: configId(workspaceId) },
    create: { id: configId(workspaceId), workspaceId },
    update: {},
  });
}

export async function updateSchedule(input: {
  workspaceId: string | null;
  frequency: "OFF" | "DAILY" | "WEEKLY" | "MONTHLY";
  hour: number;
  retention: number;
  includeAttachments: boolean;
}): Promise<void> {
  await backupConfig(input.workspaceId);
  await prisma.backupConfig.update({
    where: { id: configId(input.workspaceId) },
    data: {
      frequency: input.frequency,
      hour: Math.min(23, Math.max(0, Math.trunc(input.hour))),
      retention: Math.min(90, Math.max(1, Math.trunc(input.retention))),
      includeAttachments: input.includeAttachments,
    },
  });
}

export type DestinationInput = {
  destination: "LOCAL" | "S3";
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  // Empty = keep the stored one.
  accessKey: string;
  secretKey: string;
  encrypt: boolean;
};

/** The destination as it would be stored, without saving it (to test it first). */
async function draftDestination(workspaceId: string | null, d: DestinationInput): Promise<DestinationConfig | BackupError> {
  if (d.destination === "LOCAL") {
    return { destination: "LOCAL", s3Endpoint: null, s3Region: null, s3Bucket: null, s3Prefix: null, s3AccessKeyEnc: null, s3SecretKeyEnc: null };
  }
  if (!isSecretKeyConfigured()) return "no_key";
  if (webhookUrlProblem(d.endpoint, "JSON", privateTargetsAllowed()) || !d.bucket.trim()) return "bad_destination";
  const current = await backupConfig(workspaceId);
  const id = configId(workspaceId);
  return {
    destination: "S3",
    s3Endpoint: new URL(d.endpoint).origin,
    s3Region: d.region.trim() || "us-east-1",
    s3Bucket: d.bucket.trim(),
    s3Prefix: cleanPrefix(d.prefix),
    s3AccessKeyEnc: d.accessKey ? encryptSecret(d.accessKey, s3SecretContext(id, "access")) : current.s3AccessKeyEnc,
    s3SecretKeyEnc: d.secretKey ? encryptSecret(d.secretKey, s3SecretContext(id, "secret")) : current.s3SecretKeyEnc,
  };
}

export async function testDestination(
  workspaceId: string | null,
  d: DestinationInput,
): Promise<{ ok: true } | { ok: false; error: BackupError; detail?: string }> {
  const draft = await draftDestination(workspaceId, d);
  if (typeof draft === "string") return { ok: false, error: draft };
  if (draft.destination === "LOCAL") return { ok: true };
  try {
    await s3Test(s3TargetOf(configId(workspaceId), draft), cleanPrefix(draft.s3Prefix));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: "bad_destination", detail: String((error as Error).message).slice(0, 300) };
  }
}

export async function updateDestination(
  workspaceId: string | null,
  d: DestinationInput,
): Promise<{ ok: true } | { ok: false; error: BackupError }> {
  await backupConfig(workspaceId);
  const draft = await draftDestination(workspaceId, d);
  if (typeof draft === "string") return { ok: false, error: draft };
  if (d.encrypt && !isSecretKeyConfigured()) return { ok: false, error: "no_key" };
  await prisma.backupConfig.update({ where: { id: configId(workspaceId) }, data: { ...draft, encrypt: d.encrypt } });
  return { ok: true };
}

/** Takes a backup now. Returns the Backup row (FAILED with the reason if it did not work). */
export async function runBackup(input: {
  workspaceId: string | null;
  kind: "MANUAL" | "SCHEDULED" | "BEFORE_IMPORT" | "BEFORE_RESTORE";
  actorId: string | null;
}) {
  const config = await backupConfig(input.workspaceId);
  const encrypt = config.encrypt && isSecretKeyConfigured();
  const backup = await prisma.backup.create({
    data: {
      workspaceId: input.workspaceId,
      kind: input.kind,
      destination: config.destination,
      encrypted: encrypt,
      includesAttachments: config.includeAttachments,
      createdById: input.actorId,
    },
  });
  try {
    const bytes = input.workspaceId
      ? await buildOrganizationZip(input.workspaceId, config.includeAttachments)
      : await buildInstanceZip(config.includeAttachments);
    const stored = await storeBackupFile({
      backupId: backup.id,
      scope: scopeName(input.workspaceId),
      bytes,
      encrypt,
      configId: config.id,
      config,
    });
    const done = await prisma.backup.update({
      where: { id: backup.id },
      data: { status: "SUCCESS", location: stored.location, size: stored.size, finishedAt: new Date() },
    });
    if (input.kind === "SCHEDULED") await applyRetention(input.workspaceId, config.retention);
    return done;
  } catch (error) {
    return prisma.backup.update({
      where: { id: backup.id },
      data: { status: "FAILED", error: String((error as Error).message ?? error).slice(0, 500), finishedAt: new Date() },
    });
  }
}

/** Keeps the newest `retention` scheduled backups; deletes the rest (file and row). */
async function applyRetention(workspaceId: string | null, retention: number): Promise<void> {
  const old = await prisma.backup.findMany({
    where: { workspaceId, kind: "SCHEDULED", status: "SUCCESS" },
    orderBy: { createdAt: "desc" },
    skip: retention,
  });
  for (const b of old) await deleteBackup(workspaceId, b.id);
}

export async function deleteBackup(workspaceId: string | null, backupId: string): Promise<boolean> {
  const b = await prisma.backup.findFirst({ where: { id: backupId, workspaceId } });
  if (!b) return false;
  if (b.location) {
    const config = await backupConfig(workspaceId);
    await deleteBackupFile({ location: b.location, destination: b.destination, configId: config.id, config });
  }
  await prisma.backup.delete({ where: { id: b.id } });
  return true;
}

/** The plain .zip of a backup of this scope (null if it does not exist or has no file). */
export async function backupBytes(workspaceId: string | null, backupId: string): Promise<{ bytes: Buffer; createdAt: Date } | null> {
  const b = await prisma.backup.findFirst({ where: { id: backupId, workspaceId, status: "SUCCESS" } });
  if (!b?.location) return null;
  const config = await backupConfig(workspaceId);
  const bytes = await loadBackupFile({
    backupId: b.id,
    location: b.location,
    destination: b.destination,
    encrypted: b.encrypted,
    configId: config.id,
    config,
  });
  return { bytes, createdAt: b.createdAt };
}

/** Imports an export into an organization, after a safety backup. */
export async function importIntoOrganization(input: {
  workspaceId: string;
  actorId: string;
  zip: Buffer;
}): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: BackupError; detail?: string }> {
  if (!(await mayManageBackups(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  let archive;
  try {
    archive = readOrganizationZip(input.zip);
  } catch (e) {
    if (e instanceof InvalidArchiveError) return { ok: false, error: "invalid_archive", detail: e.message };
    throw e;
  }
  const safety = await runBackup({ workspaceId: input.workspaceId, kind: "BEFORE_IMPORT", actorId: input.actorId });
  if (safety.status !== "SUCCESS") return { ok: false, error: "safety_backup_failed", detail: safety.error ?? undefined };
  const access = await workspaceAccessOf(input.workspaceId, input.actorId);
  try {
    const summary = await importOrganization({
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      data: archive.data,
      files: archive.files,
      asManager: Boolean(access && canManageWorkspace(access.role)),
    });
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: "invalid_archive", detail: String((e as Error).message).slice(0, 300) };
  }
}

/** Puts an organization back as it was in one of its backups, after a safety backup. */
export async function restoreOrganization(input: {
  workspaceId: string;
  actorId: string;
  backupId: string;
}): Promise<{ ok: true; summary: ImportSummary } | { ok: false; error: BackupError; detail?: string }> {
  if (!(await mayManageBackups(input.workspaceId, input.actorId))) return { ok: false, error: "forbidden" };
  const source = await backupBytes(input.workspaceId, input.backupId);
  if (!source) return { ok: false, error: "not_found" };
  const archive = readOrganizationZip(source.bytes);
  const safety = await runBackup({ workspaceId: input.workspaceId, kind: "BEFORE_RESTORE", actorId: input.actorId });
  if (safety.status !== "SUCCESS") return { ok: false, error: "safety_backup_failed", detail: safety.error ?? undefined };
  const access = await workspaceAccessOf(input.workspaceId, input.actorId);
  const manager = Boolean(access && canManageWorkspace(access.role));
  const summary = await importOrganization({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    data: archive.data,
    files: archive.files,
    asManager: manager,
    assignRoles: manager,
    replace: true,
  });
  return { ok: true, summary };
}

/** Puts the whole instance back from one of its backups, after a safety backup. */
export async function restoreInstance(actorId: string, backupId: string) {
  const source = await backupBytes(null, backupId);
  if (!source) return { ok: false as const, error: "not_found" as const };
  const safety = await runBackup({ workspaceId: null, kind: "BEFORE_RESTORE", actorId });
  if (safety.status !== "SUCCESS") return { ok: false as const, error: "safety_backup_failed" as const, detail: safety.error ?? undefined };
  // The safety backup's own row is part of what gets replaced: it is written again after.
  const keep = await prisma.backup.findUniqueOrThrow({ where: { id: safety.id } });
  const result = await restoreInstanceZip(source.bytes);
  await prisma.backup.upsert({ where: { id: keep.id }, create: keep, update: {} });
  return { ok: true as const, result };
}

// --- Scheduling ---------------------------------------------------------------------------

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, day: Number(get("day")), hour: Number(get("hour")), weekday: get("weekday") };
}

/**
 * Whether a scheduled backup is due: at the configured hour in the scope's time zone, once
 * per day / week (Mondays) / month (the 1st), and not twice in the same local day.
 */
export function isDue(
  c: { frequency: string; hour: number; lastScheduledAt: Date | null },
  now: Date,
  timeZone: string,
): boolean {
  if (c.frequency === "OFF") return false;
  const local = localParts(now, timeZone);
  if (local.hour !== c.hour) return false;
  if (c.frequency === "WEEKLY" && local.weekday !== "Mon") return false;
  if (c.frequency === "MONTHLY" && local.day !== 1) return false;
  if (c.lastScheduledAt && localParts(c.lastScheduledAt, timeZone).date === local.date) return false;
  return true;
}

/** Runs the scheduled backups that are due (POST /api/cron/backups, every hour). */
export async function runDueBackups(now: Date): Promise<{ ran: number; failed: number }> {
  const configs = await prisma.backupConfig.findMany({
    where: { frequency: { not: "OFF" } },
    select: {
      id: true,
      workspaceId: true,
      frequency: true,
      hour: true,
      lastScheduledAt: true,
      workspace: { select: { timezone: true, suspendedAt: true } },
    },
  });
  let ran = 0;
  let failed = 0;
  for (const c of configs) {
    if (c.workspace?.suspendedAt) continue;
    const tz = c.workspace?.timezone || instanceTimeZone();
    if (!isDue(c, now, tz)) continue;
    // Claimed first, so two cron calls in the same hour do not both run it.
    const { count } = await prisma.backupConfig.updateMany({
      where: { id: c.id, lastScheduledAt: c.lastScheduledAt },
      data: { lastScheduledAt: now },
    });
    if (count === 0) continue;
    const b = await runBackup({ workspaceId: c.workspaceId, kind: "SCHEDULED", actorId: null });
    ran += 1;
    if (b.status !== "SUCCESS") failed += 1;
  }
  return { ran, failed };
}

export async function listBackups(workspaceId: string | null, take = 50) {
  return prisma.backup.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
