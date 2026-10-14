import type { Metadata } from "next";
import { requireAdmin } from "@/app/lib/dal";
import { getLegalInfo } from "@/app/lib/services/instance";
import { AdminNav } from "../admin-nav";
import { InstanceSettingsForm } from "./instance-settings-form";
import { getI18n } from "@/app/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.admin.instance.meta.title, description: m.admin.instance.meta.description };
}

export default async function AdminInstancePage() {
  await requireAdmin();
  const [{ m }, info] = await Promise.all([getI18n(), getLegalInfo()]);
  const t = m.admin.instance;

  return (
    <div className="relative z-10 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <h1 className="font-display text-3xl font-bold tracking-tight">{t.title}</h1>
          <AdminNav current="/admin/instance" />
        </div>
        <p className="mt-1 text-sm text-ink-muted">
          {t.intro}
        </p>
        {info ? (
          <InstanceSettingsForm
            initial={{
              instanceName: info.instanceName,
              registrationOpen: info.registrationOpen,
              operatorName: info.operatorName ?? "",
              operatorEmail: info.operatorEmail ?? "",
              operatorLegalId: info.operatorLegalId ?? "",
              operatorAddress: info.operatorAddress ?? "",
              hostingDescription: info.hostingDescription ?? "",
              backupRetentionDays:
                info.backupRetentionDays === null ? "" : String(info.backupRetentionDays),
            }}
          />
        ) : (
          <p className="mt-8 text-sm text-ink-muted">{t.notConfigured}</p>
        )}
      </div>
    </div>
  );
}
