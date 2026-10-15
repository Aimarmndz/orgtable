import { z } from "zod";
import { BOARD_COLOR_KEYS, LABEL_COLOR_KEYS } from "@/app/lib/colors";
import { CARD_DESCRIPTION_MAX } from "@/app/lib/limits";

// Shared validation schemas (zod), used by the Server Actions and the API to validate input
// before touching the database.
//
// Human messages are KEYS into locales/<lang>/errors.json ("errors.validation.*"), not
// text: the schemas stay language-independent. Server Actions turn them into the user's
// language with issueMessage(m, issue) (app/i18n/server.ts); the API, into English with
// apiValidationError (app/lib/api/respond.ts).

export const loginSchema = z.object({
  email: z.email("errors.validation.emailInvalid"),
  password: z.string().min(1, "errors.validation.passwordRequired"),
});

// Reusable password (setup wizard, account creation and reset by the administrator,
// registration). bcrypt only uses the first 72 BYTES: beyond that, two passwords with the
// same prefix would be equivalent, so they are rejected instead of silently truncated.
// UTF-8 bytes are counted, not characters (an "ñ" takes 2). loginSchema does not apply this
// limit so as not to lock out anyone who already has a longer password stored.
const passwordSchema = z
  .string()
  .min(8, "errors.validation.passwordTooShort")
  .max(200, "errors.validation.passwordTooLong")
  .refine(
    (p) => Buffer.byteLength(p, "utf8") <= 72,
    "errors.validation.passwordTooLong",
  );

export const setupSchema = z.object({
  instanceName: z
    .string()
    .trim()
    .min(1, "errors.validation.instanceNameRequired")
    .max(60, "errors.validation.maxChars60"),
  name: z
    .string()
    .trim()
    .min(1, "errors.validation.yourNameRequired")
    .max(60, "errors.validation.maxChars60"),
  email: z.email("errors.validation.emailInvalid"),
  password: passwordSchema,
});

export const boardTitleSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.titleRequired")
  .max(120, "errors.validation.maxChars120");

export const listTitleSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.titleRequired")
  .max(120, "errors.validation.maxChars120");

export const cardTitleSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.titleRequired")
  .max(500, "errors.validation.maxChars500");

// The limit lives in limits.ts so that the UI can use it without importing zod; it is
// re-exported so that schemas and actions keep taking it from here.
export { CARD_DESCRIPTION_MAX };

// Due date sent by the UI (date input and drag in the calendar): "YYYY-MM-DD", or
// empty/null to clear it. z.iso.date() rejects impossible dates such as 2026-02-31; an
// unparseable date used to become null and silently CLEAR the due date.
export const dueDateSchema = z.union([z.literal(""), z.null(), z.iso.date()]);

// Description + due date update from the card modal (updateCard).
export const cardDetailsSchema = z.object({
  description: z.string().trim().max(CARD_DESCRIPTION_MAX),
  dueDate: dueDateSchema,
});

// Label and board background colours. Validated against the palette with z.enum (not with
// the `in` operator, which accepts prototype keys such as 'constructor'). `.catch` keeps
// the old tolerance: an unknown colour falls back to the default instead of failing.
export const labelColorSchema = z.enum(LABEL_COLOR_KEYS).catch("blue");
const boardBackgroundSchema = z.enum(BOARD_COLOR_KEYS).nullable().catch(null);

// Card comments.
export const commentTextSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.commentRequired")
  .max(2000, "errors.validation.maxChars2000");

// --- Board members and instance roles ---

// Roles the owner can give a board member (OWNER is not assigned from the UI: it is the
// board's creator). See app/lib/roles.ts.
export const assignableBoardRoleSchema = z.enum(["EDITOR", "VIEWER"], {
  error: "errors.validation.roleInvalid",
});

// Invite an existing user to a board by email.
export const addMemberSchema = z.object({
  email: z.email("errors.validation.emailInvalid"),
  role: assignableBoardRoleSchema,
});

// Global role of the user in the instance.
export const globalRoleSchema = z.enum(["ADMIN", "MEMBER"], {
  error: "errors.validation.roleInvalid",
});

// Account creation by the administrator. Open registration, when the instance allows it,
// uses registerSchema. See docs/authorization.md.
export const createUserSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "errors.validation.nameRequired")
    .max(60, "errors.validation.maxChars60"),
  email: z.email("errors.validation.emailInvalid"),
  password: passwordSchema,
  role: globalRoleSchema,
});

// Reset a user's password (by the administrator).
export const resetPasswordSchema = z.object({
  userId: z.string().min(1),
  password: passwordSchema,
});

// --- Board import (JSON) ---
// Schema of the file produced by GET /api/boards/[id]/export. Lenient with the `orgtable`
// envelope (optional) but strict with the shape and the size limits. importBoard answers
// any failure with a single message, so these schemas carry no messages of their own.

const importChecklistItemSchema = z.object({
  text: z.string().max(200),
  done: z.boolean(),
});

const importChecklistSchema = z.object({
  title: z.string().max(80),
  items: z.array(importChecklistItemSchema).max(200).optional(),
});

const importCardSchema = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(CARD_DESCRIPTION_MAX).nullable().optional(),
  dueDate: z.string().max(40).nullable().optional(),
  labels: z.array(z.string().max(40)).max(50).optional(),
  checklists: z.array(importChecklistSchema).max(50).optional(),
});

const importListSchema = z.object({
  title: z.string().min(1).max(120),
  cards: z.array(importCardSchema).max(500).optional(),
});

const importLabelSchema = z.object({
  name: z.string().min(1).max(40),
  color: labelColorSchema,
});

export const boardImportSchema = z.object({
  orgtable: z
    .object({ type: z.string().optional(), version: z.number().optional() })
    .optional(),
  board: z.object({
    title: z.string().min(1).max(120),
    background: boardBackgroundSchema.optional(),
    labels: z.array(importLabelSchema).max(50).optional(),
    lists: z.array(importListSchema).max(50).optional(),
  }),
});

// --- Public API ---
// JSON request bodies of the API. They reuse the same limits as the Server Actions
// (cardTitleSchema, etc.). See docs/api/public-api.md.

export const apiTokenNameSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.nameRequired")
  .max(60, "errors.validation.maxChars60");

// Token scope: "full" (read + write) or "read" (read only).
export const apiTokenScopeSchema = z.enum(["full", "read"]);

// Expiry chosen in /settings: never, or a number of days.
export const apiTokenExpirySchema = z.enum(["0", "30", "90", "365"]);

// Due date in the API: "YYYY-MM-DD" (the documented form) or full ISO 8601 with an offset
// ("2026-07-01T09:00:00Z" / "+02:00"). null clears it. An empty or unrecognised string
// gives 422 instead of being stored as null (it used to clear the due date and answer 200).
export const apiDueDateSchema = z.union([
  z.iso.date(),
  z.iso.datetime({ offset: true }),
]);

export const apiCardCreateSchema = z.object({
  title: cardTitleSchema,
  description: z.string().max(CARD_DESCRIPTION_MAX).nullish(),
  dueDate: apiDueDateSchema.nullish(),
});

export const apiCardUpdateSchema = z
  .object({
    title: cardTitleSchema.optional(),
    description: z.string().max(CARD_DESCRIPTION_MAX).nullable().optional(),
    dueDate: apiDueDateSchema.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "errors.validation.noFieldsToUpdate",
  });

// --- Open registration and own account (see docs/privacy.md) ---------------------------

const personNameSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.nameRequired")
  .max(60, "errors.validation.maxChars60");

// The consent checkbox arrives as "on" when ticked and is absent otherwise: consent has to
// be an affirmative act (GDPR art. 7), never a default value.
export const registerSchema = z.object({
  name: personNameSchema,
  email: z.email("errors.validation.emailInvalid").max(254, "errors.validation.maxChars254"),
  password: passwordSchema,
  acceptTerms: z.literal("on", {
    error: "errors.validation.acceptTermsRequired",
  }),
});

export const profileSchema = z.object({
  name: personNameSchema,
  email: z.email("errors.validation.emailInvalid").max(254, "errors.validation.maxChars254"),
  // Only needed when the email changes; the service checks it.
  currentPassword: z.string().max(200, "errors.validation.maxChars200"),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "errors.validation.currentPasswordRequired")
      .max(200, "errors.validation.maxChars200"),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "errors.validation.passwordsDontMatch",
    path: ["confirmPassword"],
  });

export const deleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, "errors.validation.passwordToConfirm")
    .max(200, "errors.validation.maxChars200"),
});

// Optional form text: empty or whitespace-only is stored as null. One key per limit
// because a message key carries no parameters.
const optionalText = (max: 40 | 120 | 200) =>
  z
    .string()
    .trim()
    .max(max, `errors.validation.maxChars${max}`)
    .transform((v) => (v === "" ? null : v));

export const instanceSettingsSchema = z.object({
  instanceName: z
    .string()
    .trim()
    .min(1, "errors.validation.instanceNameRequired")
    .max(60, "errors.validation.maxChars60"),
  registrationOpen: z.enum(["open", "closed"]).transform((v) => v === "open"),
  operatorName: optionalText(120),
  operatorEmail: z
    .string()
    .trim()
    .max(254, "errors.validation.maxChars254")
    .transform((v) => (v === "" ? null : v))
    .pipe(z.email("errors.validation.contactEmailInvalid").nullable()),
  operatorLegalId: optionalText(40),
  operatorAddress: optionalText(200),
  hostingDescription: optionalText(200),
  backupRetentionDays: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : Number(v)))
    .pipe(
      z
        .number({ error: "errors.validation.backupDaysNumber" })
        .int("errors.validation.backupDaysInteger")
        .min(0, "errors.validation.backupDaysNegative")
        .max(3650, "errors.validation.backupDaysMax")
        .nullable(),
    ),
});

// --- Workspaces (docs/workspaces.md) ---
// The slug's format and reserved words are checked by app/lib/slugs.ts in the service, so
// a slug typed in any form or the API gets the same answer; here only the length.
const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, "errors.validation.workspaceNameRequired")
  .max(60, "errors.validation.maxChars60");
const workspaceSlugInputSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "errors.workspaces.slugFormat")
  .max(39, "errors.workspaces.slugFormat");

export const organizationSchema = z.object({
  name: workspaceNameSchema,
  slug: workspaceSlugInputSchema,
});

// Sign-up as an organization: the person's account plus the organization they own.
export const registerOrganizationSchema = registerSchema.extend({
  organizationName: workspaceNameSchema,
  organizationSlug: workspaceSlugInputSchema,
});

export const workspaceRoleSchema = z.enum(["OWNER", "ADMIN", "MEMBER"], {
  error: "errors.validation.roleInvalid",
});

// The role picker of the members list and the employee form: a base role, or
// "custom:<id>" for a custom role of the organization (always on top of MEMBER).
export const memberRoleChoiceSchema = z
  .string()
  .max(80)
  .transform((value, ctx) => {
    if (value.startsWith("custom:") && value.length > 7) {
      return { role: "MEMBER" as const, customRoleId: value.slice(7) };
    }
    const base = workspaceRoleSchema.safeParse(value);
    if (!base.success) {
      ctx.addIssue({ code: "custom", message: "errors.validation.roleInvalid" });
      return z.NEVER;
    }
    return { role: base.data, customRoleId: null };
  });

// A custom role (docs/roles.md). Permissions are checked against the catalogue by the
// service (sanitizeCustomPermissions), so unknown names are dropped, not refused.
export const customRoleSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "errors.workspaces.roleNameRequired")
    .max(60, "errors.workspaces.roleNameTooLong"),
  color: z.string().max(20),
  description: z
    .string()
    .trim()
    .max(200, "errors.workspaces.roleDescriptionTooLong")
    .transform((v) => (v === "" ? null : v)),
  permissions: z.array(z.string().max(40)).max(40),
});

// A team of an organization (docs/teams.md).
export const teamSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "errors.workspaces.teamNameRequired")
    .max(60, "errors.workspaces.teamNameTooLong"),
  color: z.string().max(20),
  description: z
    .string()
    .trim()
    .max(200, "errors.workspaces.roleDescriptionTooLong")
    .transform((v) => (v === "" ? null : v)),
});

export const boardRoleSchema = z.enum(["OWNER", "EDITOR", "VIEWER"], {
  error: "errors.validation.roleInvalid",
});

// An owner or admin creates an employee's account in their organization.
export const createEmployeeSchema = z.object({
  name: personNameSchema,
  email: z.email("errors.validation.emailInvalid").max(254, "errors.validation.maxChars254"),
  password: passwordSchema,
  role: memberRoleChoiceSchema,
});

export const employeePasswordSchema = z.object({
  userId: z.string().min(1),
  password: passwordSchema,
});

export const boardVisibilitySchema = z.enum(["WORKSPACE", "PRIVATE"]);

// --- Password links sent by email (docs/email.md) ---
export const forgotPasswordSchema = z.object({
  email: z.email("errors.validation.emailInvalid").max(254, "errors.validation.maxChars254"),
});

export const newPasswordSchema = z
  .object({
    token: z.string().min(1).max(200),
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "errors.validation.passwordsDontMatch",
    path: ["confirm"],
  });
