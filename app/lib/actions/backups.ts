"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/app/lib/dal";
import { recordAudit, type AuditAction } from "@/app/lib/audit";
import { prisma } from "@/app/lib/prisma";
import {
  deleteBackup,
  mayManageBackups,
  restoreInstance,
  restoreOrganization,
  runBackup,
  testDestination,
  updateDestination,
  updateSchedule,
  type BackupError,
  type DestinationInput,
} from "@/app/lib/services/backups";
import { getI18n } from "@/app/i18n/server";
import type { Messages } from "@/app/i18n/config";

// Server Actions of backups (docs/backups.md). Every form carries `scope`: an organization's
// id ("backups.manage" in it) or "instance" (the instance administrator).

export type BackupFormState = { error?: string; message?: string };

function text(formData: FormData, key: string, max = 300): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

type Scope = { workspaceId: string | null; userId: string; slug: string | null };

/** Who may act on the scope in the form, or null. */
async function authorize(formData: FormData): Promise<Scope | null> {
  const scope = text(formData, "scope", 100);
  if (scope === "instance") {
    const admin = await requireAdmin();
    return { workspaceId: null, userId: admin.id, slug: null };
  }
  const user = await requireUser();
  if (!(await mayManageBackups(scope, user.id))) return null;
  const w = await prisma.workspace.findUnique({ where: { id: scope }, select: { slug: true } });
  return { workspaceId: scope, userId: user.id, slug: w?.slug ?? null };
}

async function audit(s: Scope, org: AuditAction, instance: AuditAction, detail: string) {
  await recordAudit({
    action: s.workspaceId ? org : instance,
    userId: s.userId,
    ...(s.workspaceId ? { targetType: "workspace", targetId: s.workspaceId } : {}),
    detail,
  });
}

function refresh(s: Scope) {
  revalidatePath(s.slug ? `/${s.slug}/settings/backups` : "/admin/backups");
}

function errorMessage(m: Messages, error: BackupError, detail?: string): string {
  const t = m.errors.backups;
  const base =
    error === "bad_destination"
      ? t.badDestination
      : error === "no_key"
        ? t.noKey
        : error === "safety_backup_failed"
          ? t.safetyFailed
          : error === "invalid_archive"
            ? t.invalidArchive
            : error === "not_found"
              ? t.notFound
              : m.errors.workspaces.forbidden;
  return detail ? `${base} (${detail})` : base;
}

const scheduleSchema = z.object({
  frequency: z.enum(["OFF", "DAILY", "WEEKLY", "MONTHLY"]),
  hour: z.coerce.number().int().min(0).max(23),
  retention: z.coerce.number().int().min(1).max(90),
});

export async function saveScheduleAction(_prev: BackupFormState, formData: FormData): Promise<BackupFormState> {
  const { m } = await getI18n();
  const s = await authorize(formData);
  if (!s) return { error: m.errors.workspaces.forbidden };
  const parsed = scheduleSchema.safeParse({
    frequency: text(formData, "frequency", 10),
    hour: text(formData, "hour", 3),
    retention: text(formData, "retention", 3),
  });
  if (!parsed.success) return { error: m.errors.backups.badSchedule };
  await updateSchedule({ workspaceId: s.workspaceId, ...parsed.data, includeAttachments: formData.get("includeAttachments") === "on" });
  await audit(s, "workspace.backup_settings", "instance.backup_settings", `${parsed.data.frequency} ${parsed.data.hour}h keep ${parsed.data.retention}`);
  refresh(s);
  return { message: m.backups.saved };
}

function destinationFrom(formData: FormData): DestinationInput {
  return {
    destination: text(formData, "destination", 10) === "S3" ? "S3" : "LOCAL",
    endpoint: text(formData, "endpoint", 300).trim(),
    region: text(formData, "region", 60),
    bucket: text(formData, "bucket", 200),
    prefix: text(formData, "prefix", 200),
    accessKey: text(formData, "accessKey", 200).trim(),
    secretKey: text(formData, "secretKey", 300).trim(),
    encrypt: formData.get("encrypt") === "on",
  };
}

export async function saveDestinationAction(_prev: BackupFormState, formData: FormData): Promise<BackupFormState> {
  const { m } = await getI18n();
  const s = await authorize(formData);
  if (!s) return { error: m.errors.workspaces.forbidden };
  const d = destinationFrom(formData);
  if (formData.get("test") === "1") {
    const tested = await testDestination(s.workspaceId, d);
    return tested.ok ? { message: m.backups.testOk } : { error: errorMessage(m, tested.error, tested.detail) };
  }
  const result = await updateDestination(s.workspaceId, d);
  if (!result.ok) return { error: errorMessage(m, result.error) };
  await audit(s, "workspace.backup_settings", "instance.backup_settings", `destination ${d.destination}${d.encrypt ? " encrypted" : ""}`);
  refresh(s);
  return { message: m.backups.saved };
}

export async function runBackupAction(_prev: BackupFormState, formData: FormData): Promise<BackupFormState> {
  const { m } = await getI18n();
  const s = await authorize(formData);
  if (!s) return { error: m.errors.workspaces.forbidden };
  const b = await runBackup({ workspaceId: s.workspaceId, kind: "MANUAL", actorId: s.userId });
  await audit(s, "workspace.backup_created", "instance.backup_created", `${b.id} ${b.status}${b.error ? `: ${b.error}` : ""}`);
  refresh(s);
  return b.status === "SUCCESS" ? { message: m.backups.done } : { error: `${m.errors.backups.failed} ${b.error ?? ""}` };
}

export async function restoreBackupAction(_prev: BackupFormState, formData: FormData): Promise<BackupFormState> {
  const { m } = await getI18n();
  const s = await authorize(formData);
  if (!s) return { error: m.errors.workspaces.forbidden };
  const backupId = text(formData, "backupId", 100);
  const expected = s.slug ?? "instance";
  if (text(formData, "confirm", 100).trim() !== expected) return { error: m.errors.backups.confirmMismatch };
  if (s.workspaceId) {
    const r = await restoreOrganization({ workspaceId: s.workspaceId, actorId: s.userId, backupId });
    if (!r.ok) return { error: errorMessage(m, r.error, r.detail) };
    await audit(s, "workspace.restore", "instance.backup_restored", `${backupId}: ${r.summary.boards} boards, ${r.summary.cards} cards`);
    revalidatePath(`/${s.slug}`, "layout");
    return { message: m.backups.restored };
  }
  const r = await restoreInstance(s.userId, backupId);
  if (!r.ok) return { error: errorMessage(m, r.error, "detail" in r ? r.detail : undefined) };
  await audit(s, "workspace.restore", "instance.backup_restored", `${backupId}: ${r.result.rows} rows, ${r.result.files} files`);
  revalidatePath("/", "layout");
  return { message: m.backups.restored };
}

export async function deleteBackupAction(formData: FormData): Promise<void> {
  const s = await authorize(formData);
  if (!s) return;
  const backupId = text(formData, "backupId", 100);
  if (await deleteBackup(s.workspaceId, backupId)) {
    await audit(s, "workspace.backup_deleted", "instance.backup_deleted", backupId);
    refresh(s);
  }
}
