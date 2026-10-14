"use server";

import { redirect } from "next/navigation";
import { hashPassword } from "@/app/lib/auth";
import { createSession } from "@/app/lib/session";
import { recordAudit } from "@/app/lib/audit";
import { setupSchema } from "@/app/lib/validators";
import { isSetupComplete } from "@/app/lib/dal";
import {
  completeInstanceSetup,
  type SetupOutcome,
} from "@/app/lib/services/setup";
import { getI18n, issueMessage } from "@/app/i18n/server";

// `values` returns what was typed (never the password) to repaint the form after an error:
// React 19 resets uncontrolled forms after the action.
export type SetupState = {
  error?: string;
  values?: { instanceName: string; name: string; email: string };
};

export async function completeSetup(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  // With setup already done it stops here, before validating and spending ~200 ms of
  // bcrypt: the action ID is still in the /setup bundle and can be invoked by hand.
  // redirect() throws NEXT_REDIRECT, so it stays outside any try/catch. The definitive check
  // is still inside the transaction (completeInstanceSetup).
  if (await isSetupComplete()) redirect("/login");
  const { m } = await getI18n();

  const text = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" ? v.slice(0, 254) : "";
  };
  const values = {
    instanceName: text("instanceName"),
    name: text("name"),
    email: text("email"),
  };

  const parsed = setupSchema.safeParse({
    instanceName: formData.get("instanceName"),
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return {
      error: issueMessage(m, parsed.error.issues[0]),
      values,
    };
  }

  const { instanceName, name, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  let outcome: SetupOutcome | { ok: false; reason: "ERROR" };
  try {
    outcome = await completeInstanceSetup({ instanceName, name, email, passwordHash });
  } catch (e) {
    // Database down, migrations not applied, duplicate email…: the user sees a generic
    // message, but the cause goes to the log (without FormData or email).
    console.error("[setup] could not complete the setup", describeSetupError(e));
    outcome = { ok: false, reason: "ERROR" };
  }

  // redirect() is called OUTSIDE the try/catch: it throws an internal Next exception
  // (NEXT_REDIRECT) that must not be caught by the catch above.
  if (!outcome.ok) {
    if (outcome.reason === "ALREADY_SETUP") redirect("/login");
    return {
      error: m.errors.setup.failed,
      values,
    };
  }

  await createSession(outcome.userId);
  await recordAudit({
    action: "setup.completed",
    userId: outcome.userId,
    detail: instanceName,
  });
  redirect("/boards");
}

// Prisma code and fields (e.g. P2002 on `email`) and message, which does not include the
// submitted values except in validation errors, where only the type is kept.
function describeSetupError(e: unknown): Record<string, unknown> {
  if (!(e instanceof Error)) return { error: String(e).slice(0, 200) };
  const code = "code" in e ? e.code : undefined;
  const meta = "meta" in e && typeof e.meta === "object" && e.meta ? e.meta : undefined;
  const target = meta && "target" in meta ? meta.target : undefined;
  const message =
    e.name === "PrismaClientValidationError" ? undefined : e.message.slice(0, 500);
  return { name: e.name, code, target, message };
}
