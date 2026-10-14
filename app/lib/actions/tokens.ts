"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/app/lib/prisma";
import { requireUser } from "@/app/lib/dal";
import { recordAudit } from "@/app/lib/audit";
import {
  apiTokenNameSchema,
  apiTokenScopeSchema,
  apiTokenExpirySchema,
} from "@/app/lib/validators";
import { generateApiToken } from "@/app/lib/api/tokens";
import { getI18n, issueMessage } from "@/app/i18n/server";

const DAY_MS = 24 * 60 * 60 * 1000;

const createTokenSchema = z.object({
  name: apiTokenNameSchema,
  scope: apiTokenScopeSchema,
  expiry: apiTokenExpirySchema,
});

// Management of one's own API tokens. Creating returns the token IN CLEAR only once (in the
// form state); revoking deletes it. Authorisation is implicit: everything runs against the
// signed-in user. See docs/api/public-api.md.

export type CreateTokenState = {
  error?: string;
  // Newly created token in clear: shown once and never again.
  token?: string;
  name?: string;
  // What was chosen, to refill the form after an error.
  values?: { name: string; scope: string; expiry: string };
};

function formText(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v : "";
}

export async function createApiToken(
  _prev: CreateTokenState,
  formData: FormData,
): Promise<CreateTokenState> {
  const user = await requireUser();
  const { m } = await getI18n();
  // Name, scope and expiry are validated together: an unrecognised value is an error and
  // nothing is created (it used to fall back silently to read-write and no expiry).
  const values = {
    name: formText(formData, "name"),
    scope: formText(formData, "scope"),
    expiry: formText(formData, "expiry"),
  };
  const parsed = createTokenSchema.safeParse(values);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    // The scope/expiry enums in validators.ts carry no message of their own: the field
    // says which one failed.
    const field = issue?.path[0];
    const error =
      field === "scope"
        ? m.errors.tokens.invalidScope
        : field === "expiry"
          ? m.errors.tokens.invalidExpiry
          : issueMessage(m, issue);
    return { error, values };
  }
  const { name, scope } = parsed.data;
  const expiryDays = Number(parsed.data.expiry);
  const expiresAt = expiryDays > 0 ? new Date(Date.now() + expiryDays * DAY_MS) : null;

  const { token, hash, prefix } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      userId: user.id,
      name,
      tokenHash: hash,
      prefix,
      scope,
      expiresAt,
    },
    select: { id: true },
  });
  await recordAudit({
    action: "apitoken.created",
    userId: user.id,
    targetType: "apitoken",
    targetId: created.id,
    detail: `${name} (${scope})`,
  });
  revalidatePath("/settings");
  return { token, name };
}

/** Revokes (deletes) one's own token. The WHERE includes the userId: nobody revokes another's. */
export async function revokeApiToken(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id"));
  const { count } = await prisma.apiToken.deleteMany({
    where: { id, userId: user.id },
  });
  if (count > 0) {
    await recordAudit({
      action: "apitoken.revoked",
      userId: user.id,
      targetType: "apitoken",
      targetId: id,
    });
  }
  revalidatePath("/settings");
}
