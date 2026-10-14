"use client";

import { useState } from "react";
import {
  updateUserRole,
  resetUserPassword,
  deleteUser,
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
}: {
  userId: string;
  userName: string;
  role: "ADMIN" | "MEMBER";
  isSelf: boolean;
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
          <Button type="submit" variant="subtle" className="h-8 px-2.5 text-xs">
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
          className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
        >
          {t.resetPassword}
        </button>
      )}

      <form action={revokeUserSessions}>
        <input type="hidden" name="userId" value={userId} />
        <button
          type="submit"
          className="rounded-lg px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-2 hover:text-ink"
          title={t.revokeSessionsTitle}
        >
          {t.revokeSessions}
        </button>
      </form>

      <form
        action={deleteUser}
        onSubmit={(e) => {
          if (!confirm(t.deleteConfirm))
            e.preventDefault();
        }}
      >
        <input type="hidden" name="userId" value={userId} />
        <button
          className="grid size-8 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-danger/10 hover:text-danger"
          aria-label={t.deleteLabel}
        >
          ✕
        </button>
      </form>
    </div>
  );
}
