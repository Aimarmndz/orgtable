"use client";

import { useActionState } from "react";
import { updateOrgSecurityAction, type SecurityFormState } from "@/app/lib/actions/org-security";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/input";
import { Feedback, Field, Switch } from "@/app/components/settings/form-bits";
import { useI18n } from "@/app/i18n/client";

/** The organization's security policy: mandatory two-step verification and email domains. */
export function OrgSecurityForm({
  workspaceId,
  requireTwoFactor,
  domains,
  readOnly,
}: {
  workspaceId: string;
  requireTwoFactor: boolean;
  domains: string[];
  readOnly: boolean;
}) {
  const { m } = useI18n();
  const t = m.workspaces.security;
  const [state, action, pending] = useActionState<SecurityFormState, FormData>(updateOrgSecurityAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <Switch
        name="requireTwoFactor"
        label={t.require2fa}
        hint={t.require2faHint}
        defaultChecked={requireTwoFactor}
        disabled={readOnly}
      />
      <Field label={t.domains} hint={t.domainsHint}>
        <Textarea
          name="domains"
          rows={2}
          defaultValue={domains.join("\n")}
          placeholder="acme.com"
          disabled={readOnly}
          className="mt-1.5 font-mono"
        />
      </Field>
      <Feedback state={state} pending={pending} />
      {!readOnly && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {t.save}
          </Button>
        </div>
      )}
    </form>
  );
}
