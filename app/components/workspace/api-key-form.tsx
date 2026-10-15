"use client";

import { useActionState } from "react";
import { createApiKeyAction, type ApiKeyFormState } from "@/app/lib/actions/api-keys";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Feedback, Field, SELECT } from "@/app/components/settings/form-bits";
import { OnceBox } from "@/app/components/workspace/webhook-forms";
import { useI18n } from "@/app/i18n/client";

/** Creates an organization API key; the key comes back once and is shown here. */
export function ApiKeyForm({ workspaceId }: { workspaceId: string }) {
  const { m } = useI18n();
  const t = m.webhooks.keys;
  const [state, action, pending] = useActionState<ApiKeyFormState, FormData>(createApiKeyAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
        <Field label={t.name}>
          <Input name="name" required maxLength={60} className="mt-1.5" placeholder="ERP sync" />
        </Field>
        <Field label={t.scope}>
          <select name="scope" defaultValue="read" className={SELECT}>
            <option value="read">{m.settings.tokens.scopeRead}</option>
            <option value="full">{m.settings.tokens.scopeFull}</option>
          </select>
        </Field>
        <Field label={t.expiry}>
          <select name="expiry" defaultValue="90" className={SELECT}>
            <option value="30">{t.days30}</option>
            <option value="90">{t.days90}</option>
            <option value="365">{t.days365}</option>
            <option value="0">{t.never}</option>
          </select>
        </Field>
        <Button type="submit" disabled={pending} className="h-10">
          {t.create}
        </Button>
      </div>
      {state.token && !pending && <OnceBox label={t.created} value={state.token} note={t.once} />}
      <Feedback state={{ error: state.error }} pending={pending} />
    </form>
  );
}
