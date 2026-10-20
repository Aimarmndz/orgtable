import type { Metadata } from "next";
import { requireAdmin } from "@/app/lib/dal";
import { getAllUsers } from "@/app/lib/queries";
import { getI18n } from "@/app/i18n/server";
import { formatDate } from "@/app/lib/format-date";
import { CreateUserForm } from "./create-user-form";
import { UserRowActions } from "./user-row-actions";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.admin.users.meta.title, description: m.admin.users.meta.description };
}

/**
 * Message for a ?ok=… / ?error=… code returned by the row actions (see actions/admin.ts).
 * The codes are the keys of m.admin.users.ok / .errors; an unknown code shows nothing.
 */
function messageFor(messages: Record<string, string>, code: string | undefined) {
  return code && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const admin = await requireAdmin();
  const { intl, m } = await getI18n();
  const t = m.admin.users;
  const [{ ok, error }, users] = await Promise.all([
    searchParams,
    getAllUsers(),
  ]);
  const okMessage = messageFor(t.ok, ok);
  const errorMessage = messageFor(t.errors, error);

  return (
    <div className="relative z-10 mx-auto w-full max-w-4xl overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">
          {t.title}
        </h1>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        {t.intro}
      </p>

      {okMessage && (
        <p
          role="status"
          className="mt-4 rounded-lg bg-success/10 px-3 py-2 text-sm text-success"
        >
          {okMessage}
        </p>
      )}
      {errorMessage && (
        <p
          role="alert"
          className="mt-4 rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {errorMessage}
        </p>
      )}

      <div className="mt-6">
        <CreateUserForm />
      </div>

      {/* overflow-x-auto (not hidden): on mobile the table scrolls and the Actions
          column stays reachable; it also clips the rounded corners. */}
      <div className="mt-8 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">{t.table.user}</th>
              <th className="px-4 py-3 font-semibold">{t.table.boards}</th>
              <th className="px-4 py-3 font-semibold">{t.table.joined}</th>
              <th className="px-4 py-3 text-right font-semibold">{t.table.actions}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {users.map((u) => (
              <tr key={u.id} data-menu-scope="row" data-menu-title={u.name} className="bg-surface">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{u.name}</span>
                    {u.role === "ADMIN" && (
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                        {t.adminBadge}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-muted">{u.email}</div>
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  <span title={t.ownedBoards}>{u._count.boards}</span>
                  <span className="text-ink-muted/50"> · </span>
                  <span title={t.memberBoards}>
                    {u._count.memberships}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink-muted">
                  {formatDate(u.createdAt, intl)}
                </td>
                <td className="px-4 py-3">
                  <UserRowActions
                    userId={u.id}
                    userName={u.name}
                    role={u.role}
                    isSelf={u.id === admin.id}
                    twoFactor={Boolean(u.totpEnabledAt)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
