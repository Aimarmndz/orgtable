"use client";

import { useState } from "react";
import {
  updateUserRole,
  resetUserPassword,
  deleteUser,
  resetUserTwoFactor,
  revokeUserSessions,
} from "@/app/lib/actions/admin";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useI18n } from "@/app/i18n/client";
import { fmt } from "@/app/i18n/format";

// Per-row actions of the admin panel: change the global role, reset the password (with
// an inline field) and delete the account. The actions report back through a redirect
// with a query (?ok/?error) that the page turns into a notice.
export function UserRowActions({
  userId,
  userName,
  role,
  isSelf,
  twoFactor = false,
}: {
  userId: string;
  userName: string;
  role: "ADMIN" | "MEMBER";
  isSelf: boolean;
  // The account has two-step verification on: offer to reset it.
  twoFactor?: boolean;
}) {
  const [resetting, setResetting] = useState(false);
  const { m } = useI18n();
  const t = m.admin.users;

  // You can't change your own role or delete yourself: avoids locking yourself out.
  if (isSelf) {
    return (
      <div className="flex items-center justify-end gap-2 text-xs text-ink-muted">
        <span className="rounded-full bg-surface-2 px-2.5 py-1 font-medium">
          {t.you}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <form action={updateUserRole}>
        <input type="hidden" name="userId" value={userId} />
        <select
          name="role"
          defaultValue={role}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-ink outline-none focus-visible:border-accent"
          aria-label={t.roleLabel}
        >
          <option value="MEMBER">{m.admin.roles.MEMBER}</option>
          <option value="ADMIN">{m.admin.roles.ADMIN}</option>
        </select>
      </form>

      {resetting ? (
        <form
          action={resetUserPassword}
          className="flex items-center gap-1"
          onSubmit={() => setResetting(false)}
        >
          <input type="hidden" name="userId" value={userId} />
          <Input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder={t.newPassword}
            aria-label={fmt(t.newPasswordFor, { name: userName })}
            autoComplete="new-password"
            className="h-8 w-40 text-xs"
          />
          <Button type="submit" variant="outline" className="h-8 px-2.5 text-xs">
            {m.common.actions.save}
          </Button>
          <button
            type="button"
            onClick={() => setResetting(false)}
            className="text-xs text-ink-muted hover:text-ink"
          >
            {m.common.actions.cancel}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setResetting(true)}
          className="inline-flex h-8 items-center rounded-lg border border-ink/20 bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-surface-2"
        >
          {t.resetPassword}
        </button>
      )}

      <form action={revokeUserSessions}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          className="inline-flex h-8 items-center rounded-lg border border-ink/20 bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-surface-2"
          title={t.revokeSessionsTitle}
        >
          {t.revokeSessions}
        </button>
      </form>

      {twoFactor && (
        <form
          action={resetUserTwoFactor}
          onSubmit={(e) => {
            if (!confirm(fmt(t.resetTwoFactorConfirm, { name: userName }))) e.preventDefault();
          }}
        >
          <input type="hidden" name="userId" value={userId} />
          <button
            type="submit"
            className="inline-flex h-8 items-center rounded-lg border border-ink/20 bg-surface px-2.5 text-xs font-semibold text-ink shadow-sm transition hover:bg-surface-2"
          >
            {t.resetTwoFactor}
          </button>
        </form>
      )}

      <form
        action={deleteUser}
        onSubmit={(e) => {
          if (!confirm(t.deleteConfirm))
            e.preventDefault();
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-danger/40 bg-surface px-2.5 text-xs font-semibold text-danger shadow-sm transition hover:bg-danger/5"
          aria-label={t.deleteLabel}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden>
            <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
          </svg>
          {m.common.actions.delete}
        </button>
      </form>
    </div>
  );
}
