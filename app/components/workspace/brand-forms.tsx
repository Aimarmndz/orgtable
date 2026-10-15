"use client";

import { useActionState, useState } from "react";
import { updateBrandAction, uploadLogoAction, type BrandFormState } from "@/app/lib/actions/branding";
import { BOARD_COLORS, BOARD_COLOR_KEYS, type BoardColor } from "@/app/lib/colors";
import { Button } from "@/app/components/ui/button";
import { Feedback, Field, LABEL, SELECT } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";
import { initials } from "@/app/lib/initials";

// Brand of an organization (docs/workspaces.md, "Brand"): colour with a live preview, time
// zone, and the logo upload.

export function BrandForm({
  workspaceId,
  name,
  brandColor,
  timezone,
  timezones,
  instanceTimezone,
  autoColor,
}: {
  workspaceId: string;
  name: string;
  // The colour "automatic" stands for (a stable one from the id).
  autoColor: string;
  brandColor: string | null;
  timezone: string | null;
  timezones: string[];
  instanceTimezone: string;
}) {
  const { m } = useI18n();
  const t = m.workspaces.brand;
  const [state, action, pending] = useActionState<BrandFormState, FormData>(updateBrandAction, {});
  const [color, setColor] = useState<string>(brandColor ?? "");
  const preview = color && color in BOARD_COLORS ? BOARD_COLORS[color as BoardColor] : autoColor;
  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <fieldset>
        <legend className={LABEL}>{t.color}</legend>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="relative cursor-pointer">
            <input
              type="radio"
              name="brandColor"
              value=""
              checked={color === ""}
              onChange={() => setColor("")}
              className="peer sr-only"
              aria-label={t.auto}
            />
            <span className="grid h-8 place-items-center rounded-full border border-dashed border-ink/30 px-3 text-xs font-semibold text-ink-muted peer-checked:border-solid peer-checked:border-ink peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              {t.auto}
            </span>
          </label>
          {BOARD_COLOR_KEYS.map((key) => (
            <label key={key} className="relative cursor-pointer">
              <input
                type="radio"
                name="brandColor"
                value={key}
                checked={color === key}
                onChange={() => setColor(key)}
                className="peer sr-only"
                aria-label={m.workspaces.rolesPage.colors[key]}
              />
              <span
                aria-hidden
                className="block size-8 rounded-full ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"
                style={{ background: BOARD_COLORS[key] }}
              />
            </label>
          ))}
        </div>
      </fieldset>
      <div aria-hidden className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/60 p-3">
        <span className="grid size-9 place-items-center rounded-lg text-xs font-bold text-white" style={{ background: preview }}>
          {initials(name)}
        </span>
        <span className="text-sm font-semibold">{name}</span>
        <span className="ml-auto rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ background: preview }}>
          {t.preview}
        </span>
      </div>
      <Field label={t.timezone} hint={t.timezoneHint}>
        <select name="timezone" defaultValue={timezone ?? ""} className={SELECT}>
          <option value="">{`${t.instanceTimezone} (${instanceTimezone})`}</option>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </Field>
      <Feedback state={state} pending={pending} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {t.save}
        </Button>
      </div>
    </form>
  );
}

export function LogoForm({ workspaceId }: { workspaceId: string }) {
  const { m } = useI18n();
  const t = m.workspaces.brand;
  const [state, action, pending] = useActionState<BrandFormState, FormData>(uploadLogoAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Field label={t.logo} hint={t.logoHint} className="min-w-0 flex-1">
        <input
          type="file"
          name="logo"
          required
          accept="image/png,image/jpeg,image/webp"
          className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-lg file:border file:border-ink/20 file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-semibold"
        />
      </Field>
      <Button type="submit" variant="outline" disabled={pending} className="h-10">
        {t.upload}
      </Button>
      <div className="basis-full">
        <Feedback state={state} pending={pending} />
      </div>
    </form>
  );
}
