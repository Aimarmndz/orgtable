import type { Metadata } from "next";
import Link from "next/link";
import { getLegalInfo } from "@/app/lib/services/instance";
import { getI18n } from "@/app/i18n/server";
import { rich } from "@/app/i18n/rich";
import { LegalHeading, MissingLegalInfoNotice, OperatorCard } from "../legal-data";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.legal.notice.title, description: m.legal.notice.metaDescription };
}

// Information about the site owner (art. 10 LSSI). The details are the same as the
// controller's in the privacy policy: they are edited in /admin/instance.
export default async function LegalNoticePage() {
  const [info, { m }] = await Promise.all([getLegalInfo(), getI18n()]);
  const t = m.legal.notice;
  return (
    <>
      <LegalHeading title={t.title} info={info} />
      <MissingLegalInfoNotice info={info} />

      <h2>{t.owner.heading}</h2>
      <OperatorCard info={info} />

      <h2>{t.purpose.heading}</h2>
      <p>
        {rich(t.purpose.body, {
          terms: (c) => <Link href="/legal/terms">{c}</Link>,
          privacy: (c) => <Link href="/legal/privacy">{c}</Link>,
        })}
      </p>

      <h2>{t.ip.heading}</h2>
      <p>{t.ip.body}</p>
    </>
  );
}
