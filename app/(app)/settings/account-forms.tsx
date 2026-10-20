"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import {
  changePassword,
  deleteAccount,
  removeAvatarAction,
  updateProfile,
  uploadAvatarAction,
  type AccountFormState,
} from "@/app/lib/actions/account";
import { initials } from "@/app/lib/initials";
import { UserPhoto, type PhotoUser } from "@/app/components/user-photo";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";

// Forms for your own account in /settings. Each uses useActionState: the action returns
// an error (with the field it refers to) or a success message.

/** Form error (role="alert") or confirmation (role="status"). */
function FormFeedback({
  state,
  pending,
  id,
}: {
  state: AccountFormState;
  pending: boolean;
  id: string;
}) {
  // Removed while submitting, so a second identical error is announced again.
  if (pending) return <div role="status" id={id} />;
  if (state.error) {
    return (
      <p
        role="alert"
        id={id}
        className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger"
      >
        {state.error}
      </p>
    );
  }
  return (
    <div role="status" id={id}>
      {state.message && (
        <p className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: (ids: { inputId: string; hintId?: string }) => React.ReactNode;
}) {
  const inputId = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      {children({ inputId, hintId: hint ? hintId : undefined })}
      {hint && (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      )}
    </div>
  );
}

function describedBy(...ids: (string | undefined | false)[]): string | undefined {
  const list = ids.filter(Boolean).join(" ");
  return list || undefined;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    updateProfile,
    {},
  );
  const { m } = useI18n();
  const t = m.settings.profile;
  const feedbackId = useId();
  const bad = (f: string) => (!pending && state.field === f) || undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t.name}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="name"
              required
              maxLength={60}
              autoComplete="name"
              defaultValue={state.values?.name ?? name}
              aria-invalid={bad("name")}
              aria-describedby={describedBy(bad("name") && feedbackId)}
            />
          )}
        </Field>
        <Field label={t.email}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="email"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              defaultValue={state.values?.email ?? email}
              aria-invalid={bad("email")}
              aria-describedby={describedBy(bad("email") && feedbackId)}
            />
          )}
        </Field>
      </div>
      <Field label={t.currentPassword} hint={t.currentPasswordHint}>
        {({ inputId, hintId }) => (
          <Input
            id={inputId}
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            className="sm:max-w-xs"
            aria-invalid={bad("currentPassword")}
            aria-describedby={describedBy(hintId, bad("currentPassword") && feedbackId)}
          />
        )}
      </Field>
      <FormFeedback state={state} pending={pending} id={feedbackId} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? m.common.actions.saving : t.save}
        </Button>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    changePassword,
    {},
  );
  const t = useI18n().m.settings.security;
  const feedbackId = useId();
  const bad = (f: string) => (!pending && state.field === f) || undefined;

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t.currentPassword}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="currentPassword"
              type="password"
              required
              autoComplete="current-password"
              aria-invalid={bad("currentPassword")}
              aria-describedby={describedBy(bad("currentPassword") && feedbackId)}
            />
          )}
        </Field>
        <Field label={t.newPassword} hint={t.newPasswordHint}>
          {({ inputId, hintId }) => (
            <Input
              id={inputId}
              name="newPassword"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              aria-invalid={bad("newPassword")}
              aria-describedby={describedBy(hintId, bad("newPassword") && feedbackId)}
            />
          )}
        </Field>
        <Field label={t.confirmPassword}>
          {({ inputId }) => (
            <Input
              id={inputId}
              name="confirmPassword"
              type="password"
              required
              autoComplete="new-password"
              aria-invalid={bad("confirmPassword")}
              aria-describedby={describedBy(bad("confirmPassword") && feedbackId)}
            />
          )}
        </Field>
      </div>
      <FormFeedback state={state} pending={pending} id={feedbackId} />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState<AccountFormState, FormData>(
    deleteAccount,
    {},
  );
  const t = useI18n().m.settings.data.delete;
  const feedbackId = useId();
  const bad = !pending && state.field === "password";

  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <Field label={t.confirmPassword}>
            {({ inputId }) => (
              <Input
                id={inputId}
                name="password"
                type="password"
                required
                autoComplete="current-password"
                aria-invalid={bad || undefined}
                aria-describedby={bad ? feedbackId : undefined}
              />
            )}
          </Field>
        </div>
        <Button
          type="submit"
          disabled={pending}
          className="bg-danger text-accent-ink hover:bg-danger/90"
        >
          {pending ? t.submitting : t.submit}
        </Button>
      </div>
      <FormFeedback state={state} pending={pending} id={feedbackId} />
    </form>
  );
}

/**
 * Profile photo: the chosen image is cropped to its centre square and shrunk to 256 px in the
 * browser (a phone photo of several MB becomes a few KB), then sent as WebP, or JPEG where
 * the browser cannot encode WebP. The server checks the bytes again.
 */
export function AvatarForm({ user }: { user: PhotoUser }) {
  const { m } = useI18n();
  const t = m.settings.profile;
  const [state, action, pending] = useActionState<AccountFormState, FormData>(uploadAvatarAction, {});
  const [preparing, setPreparing] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const feedbackId = useId();

  async function pick(file: File) {
    setLocalError(null);
    setPreparing(true);
    try {
      const blob = await squarePhoto(file, 256);
      const data = new FormData();
      data.set("photo", blob, blob.type === "image/webp" ? "photo.webp" : "photo.jpg");
      startTransition(() => action(data));
    } catch {
      // The browser could not decode it (HEIC on some browsers, a broken file…).
      setLocalError(m.errors.account.photoInvalid);
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <UserPhoto user={user} size={72}>
          <span
            aria-hidden
            className="grid size-[72px] shrink-0 place-items-center rounded-full bg-accent font-display text-2xl font-bold text-accent-ink"
          >
            {initials(user.name)}
          </span>
        </UserPhoto>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/*"
            className="sr-only"
            // The button below is the control; this field only opens the file picker.
            tabIndex={-1}
            aria-label={t.choosePhoto}
            aria-describedby={feedbackId}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <Button type="button" variant="subtle" disabled={preparing || pending} onClick={() => input.current?.click()}>
            {preparing ? t.preparing : pending ? t.uploading : user.avatarStoredName ? t.changePhoto : t.choosePhoto}
          </Button>
          {user.avatarStoredName && (
            <form action={removeAvatarAction}>
              <Button type="submit" variant="danger" disabled={preparing || pending}>
                {t.removePhoto}
              </Button>
            </form>
          )}
        </div>
      </div>
      <p className="text-sm text-ink-muted">{t.photoHint}</p>
      {localError ? (
        <p role="alert" id={feedbackId} className="rounded-lg border border-danger/20 bg-danger/10 px-3 py-2 text-sm text-danger">
          {localError}
        </p>
      ) : (
        <FormFeedback state={state} pending={pending} id={feedbackId} />
      )}
    </div>
  );
}

async function squarePhoto(file: File, size: number): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.88));
  // Safari before 17 returns PNG when asked for WebP: then JPEG, which is smaller.
  const webp = await encode("image/webp");
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("Could not encode the photo");
  return jpeg;
}
