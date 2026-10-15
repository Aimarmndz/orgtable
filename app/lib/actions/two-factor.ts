"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import { isSecretKeyConfigured } from "@/app/lib/crypto/secrets";
import {
  confirmTwoFactorSetup,
  disableTwoFactor,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
} from "@/app/lib/services/two-factor";
import { getI18n } from "@/app/i18n/server";

// One's own two-step verification, from /settings/security (docs/authentication.md). The
// rules live in app/lib/services/two-factor.ts.

export type TwoFactorState = { error?: string; message?: string; recoveryCodes?: string[] };

function text(formData: FormData, key: string, max = 200): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.slice(0, max) : "";
}

export async function startTwoFactorAction(): Promise<void> {
  const user = await requireUser();
  if (isSecretKeyConfigured()) await startTwoFactorSetup(user.id);
  redirect("/settings/security/two-factor");
}

export async function confirmTwoFactorAction(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const user = await requireUser();
  const { m } = await getI18n();
  if (!isSecretKeyConfigured()) return { error: m.errors.account.twoFactorNoKey };
  const result = await confirmTwoFactorSetup(user.id, text(formData, "code", 20));
  if (!result.ok) {
    return {
      error: result.error === "bad_code" ? m.errors.account.twoFactorBadCode : m.errors.account.twoFactorNoSetup,
    };
  }
  await recordAudit({ action: "account.two_factor_enabled", userId: user.id });
  revalidatePath("/", "layout");
  return { recoveryCodes: result.recoveryCodes };
}

export async function regenerateRecoveryCodesAction(
  _prev: TwoFactorState,
  formData: FormData,
): Promise<TwoFactorState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const result = await regenerateRecoveryCodes(user.id, text(formData, "password"));
  if (!result.ok) return { error: m.errors.account.wrongPassword };
  await recordAudit({ action: "account.recovery_codes_regenerated", userId: user.id });
  revalidatePath("/settings", "layout");
  return { recoveryCodes: result.recoveryCodes };
}

export async function disableTwoFactorAction(_prev: TwoFactorState, formData: FormData): Promise<TwoFactorState> {
  const user = await requireUser();
  const { m } = await getI18n();
  const result = await disableTwoFactor(user.id, text(formData, "password"), text(formData, "code", 40));
  if (!result.ok) {
    return {
      error: result.error === "bad_password" ? m.errors.account.wrongPassword : m.errors.account.twoFactorBadCode,
    };
  }
  await recordAudit({ action: "account.two_factor_disabled", userId: user.id });
  revalidatePath("/", "layout");
  return { message: m.settings.twoFactor.disabled };
}
