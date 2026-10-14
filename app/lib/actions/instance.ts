"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/app/lib/dal";
import { updateInstanceSettings } from "@/app/lib/services/instance";
import { instanceSettingsSchema } from "@/app/lib/validators";
import { recordAudit } from "@/app/lib/audit";
import { getI18n, issueMessage } from "@/app/i18n/server";

// Instance settings (/admin/instance): name, open registration and the operator's legal
// details. Global ADMIN only. See docs/privacy.md.

export type InstanceSettingsState = {
  error?: string;
  field?: string;
  message?: string;
  // What was sent, to repaint the form after an error: React 19 resets uncontrolled forms
  // after each action and what was typed would be lost.
  values?: Record<string, string>;
};

const FIELDS = [
  "instanceName",
  "registrationOpen",
  "operatorName",
  "operatorEmail",
  "operatorLegalId",
  "operatorAddress",
  "hostingDescription",
  "backupRetentionDays",
] as const;

export async function saveInstanceSettings(
  _prev: InstanceSettingsState,
  formData: FormData,
): Promise<InstanceSettingsState> {
  const admin = await requireAdmin();
  const { m } = await getI18n();
  const raw = Object.fromEntries(
    FIELDS.map((f) => {
      const v = formData.get(f);
      return [f, typeof v === "string" ? v : ""];
    }),
  );
  const parsed = instanceSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      error: issueMessage(m, issue),
      field: String(issue?.path[0] ?? ""),
      values: raw,
    };
  }

  const result = await updateInstanceSettings(parsed.data);
  if (!result.ok) {
    if (result.error === "legal_info_required") {
      return {
        error: m.errors.instance.legalInfoRequired,
        field: "registrationOpen",
        values: raw,
      };
    }
    return { error: m.errors.instance.notConfigured, values: raw };
  }

  await recordAudit({
    action: "instance.updated",
    userId: admin.id,
    detail: `registration ${parsed.data.registrationOpen ? "open" : "closed"}${result.legalChanged ? ", legal details changed" : ""}`,
  });
  // The name shows in the bar of the whole app; registration, in /login and /register.
  revalidatePath("/", "layout");
  return { message: m.errors.instance.saved };
}
