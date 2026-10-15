import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getInstanceConfig, requireUser } from "@/app/lib/dal";
import { isSecretKeyConfigured } from "@/app/lib/crypto/secrets";
import { pendingTwoFactorSetup, twoFactorStatus } from "@/app/lib/services/two-factor";
import { startTwoFactorAction } from "@/app/lib/actions/two-factor";
import { PageHeader, SettingsCard, SettingsPage } from "@/app/components/settings/page-header";
import { ConfirmTwoFactorForm } from "@/app/components/settings/two-factor-forms";
import { Button } from "@/app/components/ui/button";
import { getI18n } from "@/app/i18n/server";

// /settings/security/two-factor: turning on two-step verification. The secret is created by
// a POST (never by opening the page) and waits encrypted until the first code confirms it.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.settings.twoFactor.setupTitle };
}

export default async function TwoFactorSetupPage() {
  const user = await requireUser();
  const { m } = await getI18n();
  const t = m.settings.twoFactor;
  const status = await twoFactorStatus(user.id);
  if (status.enabledAt) redirect("/settings/security");
  const keyReady = isSecretKeyConfigured();
  const config = await getInstanceConfig();
  const pending = keyReady ? await pendingTwoFactorSetup(user.id, config?.instanceName || "orgtable") : null;
  // The QR is drawn on the server as SVG markup by the qrcode library from the otpauth
  // address only: no user-controlled HTML goes into it.
  const svg = pending ? await QRCode.toString(pending.uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null;

  return (
    <SettingsPage>
      <Link href="/settings/security" className="text-sm font-semibold text-ink-muted hover:text-ink">
        ‹ {t.back}
      </Link>
      <PageHeader address="/settings/security/two-factor" title={t.setupTitle} description={t.setupIntro} />
      {!keyReady ? (
        <SettingsCard>
          <p className="text-sm text-ink-muted">{t.noKey}</p>
        </SettingsCard>
      ) : !pending || !svg ? (
        <SettingsCard>
          <form action={startTwoFactorAction}>
            <Button type="submit">{t.start}</Button>
          </form>
        </SettingsCard>
      ) : (
        <SettingsCard>
          <div className="grid gap-6 sm:grid-cols-[13rem_minmax(0,1fr)]">
            <div>
              <p className="mb-2 text-sm font-semibold">{t.step1}</p>
              <div
                className="w-52 rounded-xl bg-white p-2 [&>svg]:h-auto [&>svg]:w-full"
                // Markup from QRCode.toString, built from our own otpauth address.
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <div>
                <p className="text-sm text-ink-muted">{t.manual}</p>
                <p className="mt-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm tracking-wider">
                  {pending.secret.match(/.{1,4}/g)?.join(" ")}
                </p>
              </div>
              <ConfirmTwoFactorForm />
            </div>
          </div>
        </SettingsCard>
      )}
    </SettingsPage>
  );
}
