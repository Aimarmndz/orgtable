"use client";

import { useActionState, useMemo, useState } from "react";
import { createRoleAction, updateRoleAction, type RoleFormState } from "@/app/lib/actions/roles";
import {
  BASE_ONLY_PERMISSIONS,
  PERMISSION_GROUPS,
  PERMISSIONS,
  type Permission,
  type PermissionGroup,
} from "@/app/lib/permissions";
import { BOARD_COLORS, BOARD_COLOR_KEYS } from "@/app/lib/colors";
import { Button } from "@/app/components/ui/button";
import { Input, Textarea } from "@/app/components/ui/input";
import { Feedback, Field, LABEL, Switch } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";
import { fmt, plural } from "@/app/i18n/format";

// The editor of a custom role (docs/roles.md): name, colour, description and the permission
// switches grouped as in the design. A bar with the number of unsaved changes appears when
// something changed. With `readOnly` it shows a base role (or a role to someone who cannot
// edit roles) with every control disabled.

type Role = {
  id?: string;
  name: string;
  color: string;
  description: string | null;
  permissions: readonly string[];
};

export function RoleEditor({
  workspaceId,
  role,
  readOnly = false,
  lockedNote,
  identity = true,
}: {
  workspaceId: string;
  role: Role;
  readOnly?: boolean;
  lockedNote?: string;
  // false for a base role: its name and description are the page's header.
  identity?: boolean;
}) {
  const { m, intl } = useI18n();
  const t = m.workspaces.rolesPage;
  const isNew = !role.id;
  const [state, action, pending] = useActionState<RoleFormState, FormData>(
    isNew ? createRoleAction : updateRoleAction,
    {},
  );
  const initial = useMemo(
    () => ({
      name: role.name,
      color: role.color,
      description: role.description ?? "",
      permissions: new Set(role.permissions),
    }),
    [role],
  );
  const [name, setName] = useState(initial.name);
  const [color, setColor] = useState(initial.color);
  const [description, setDescription] = useState(initial.description);
  const [perms, setPerms] = useState<Set<string>>(() => new Set(initial.permissions));

  const changes =
    (name !== initial.name ? 1 : 0) +
    (color !== initial.color ? 1 : 0) +
    (description !== initial.description ? 1 : 0) +
    PERMISSIONS.filter((p) => perms.has(p) !== initial.permissions.has(p)).length;

  const discard = () => {
    setName(initial.name);
    setColor(initial.color);
    setDescription(initial.description);
    setPerms(new Set(initial.permissions));
  };
  const toggle = (p: Permission, on: boolean) =>
    setPerms((prev) => {
      const next = new Set(prev);
      if (on) next.add(p);
      else next.delete(p);
      return next;
    });

  const held = PERMISSIONS.filter((p) => perms.has(p)).length;

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      {role.id && <input type="hidden" name="roleId" value={role.id} />}

      <section className={identity ? "rounded-2xl border border-border bg-surface p-5 sm:p-6" : "hidden"}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Field label={t.name}>
            <Input
              name="name"
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly}
              className="mt-1.5"
            />
          </Field>
          <fieldset disabled={readOnly}>
            <legend className={LABEL}>{t.color}</legend>
            <div className="mt-1.5 flex h-10 items-center gap-1.5">
              {BOARD_COLOR_KEYS.map((key) => (
                <label key={key} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={key}
                    checked={color === key}
                    onChange={() => setColor(key)}
                    className="peer sr-only"
                    aria-label={t.colors[key]}
                  />
                  <span
                    aria-hidden
                    className="block size-7 rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                    style={{ background: BOARD_COLORS[key] }}
                  />
                </label>
              ))}
            </div>
          </fieldset>
          <Field label={t.description} className="sm:col-span-2">
            <Textarea
              name="description"
              rows={2}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={readOnly}
              className="mt-1.5"
            />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="font-display text-lg font-bold tracking-tight">{t.permissionsTitle}</h2>
          <span className="font-mono text-sm text-ink-muted">
            {fmt(t.count, { count: String(held), total: String(PERMISSIONS.length) })}
          </span>
        </div>
        {lockedNote && <p className="mt-1 text-sm text-ink-muted">{lockedNote}</p>}
        <div className="mt-3 grid gap-x-8 gap-y-2 md:grid-cols-2">
          {(Object.keys(PERMISSION_GROUPS) as PermissionGroup[]).map((group) => (
            <fieldset key={group} className="min-w-0">
              <legend className={`${LABEL} pt-3`}>{t.groups[group]}</legend>
              <div className="divide-y divide-border">
                {PERMISSION_GROUPS[group].map((p) => {
                  const baseOnly = BASE_ONLY_PERMISSIONS.includes(p);
                  return (
                    <Switch
                      key={p}
                      name="permissions"
                      value={p}
                      label={t.permissions[p].label}
                      hint={baseOnly && !readOnly ? t.baseOnly : t.permissions[p].hint || undefined}
                      checked={perms.has(p)}
                      onChange={(e) => toggle(p, e.target.checked)}
                      disabled={readOnly || baseOnly}
                    />
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </section>

      <Feedback state={state} pending={pending} />

      {!readOnly && (isNew || changes > 0) && (
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-ink px-4 py-3 text-bg shadow-[0_16px_40px_-12px_oklch(0.27_0.022_52/0.5)]">
          <span className="min-w-0 flex-1 text-sm font-medium">
            {isNew ? t.newHint : plural(intl, t.unsaved, changes)}
          </span>
          {!isNew && (
            <button
              type="button"
              onClick={discard}
              className="h-9 rounded-lg px-3 text-sm font-semibold text-bg/80 hover:bg-bg/10 hover:text-bg"
            >
              {t.discard}
            </button>
          )}
          <Button type="submit" disabled={pending} className="h-9">
            {isNew ? t.create : t.save}
          </Button>
        </div>
      )}
    </form>
  );
}
