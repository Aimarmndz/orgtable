import type { Metadata } from "next";
import Link from "next/link";
import { getLegalInfo } from "@/app/lib/services/instance";
import { LICENSE_NAME, sourceCodeUrl } from "@/app/lib/site";
import { getI18n } from "@/app/i18n/server";
import { fmt } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";
import { LegalHeading, MissingLegalInfoNotice, NotProvided, richWith } from "../legal-data";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.legal.terms.title, description: m.legal.terms.metaDescription };
}

export default async function TermsPage() {
  const [info, { m }] = await Promise.all([getLegalInfo(), getI18n()]);
  const t = m.legal.terms;

  return (
    <>
      <LegalHeading title={t.title} info={info} />
      <MissingLegalInfoNotice info={info} />

      <h2>{t.provider.heading}</h2>
      <p>
        {richWith(fmt(t.provider.body, { license: LICENSE_NAME }), {
          operator: info?.operatorName ?? <NotProvided />,
        })}
      </p>

      <h2>{t.service.heading}</h2>
      <p>
        {rich(t.service.body, { link: (c) => <Link href="/legal/privacy">{c}</Link> })}
      </p>

      <h2>{t.account.heading}</h2>
      <ul>
        <li>{t.account.age}</li>
        <li>{t.account.responsibility}</li>
        <li>{t.account.deletion}</li>
      </ul>

      <h2>{t.content.heading}</h2>
      <p>{t.content.ownership}</p>
      <p>{t.content.prohibitedIntro}</p>
      <ul>
        <li>{t.content.illegal}</li>
        <li>{t.content.malware}</li>
        <li>{t.content.spam}</li>
        <li>{t.content.abuse}</li>
      </ul>
      <p>{t.content.enforcement}</p>

      <h2>{t.availability.heading}</h2>
      <p>{t.availability.body}</p>

      <h2>{t.changes.heading}</h2>
      <p>{t.changes.body}</p>

      <h2>{t.software.heading}</h2>
      <p>
        {rich(
          t.software.body,
          { link: (c) => <a href={sourceCodeUrl()}>{c}</a> },
          { license: LICENSE_NAME },
        )}
      </p>

      <h2>{t.contact.heading}</h2>
      <p>
        {richWith(t.contact.body, {
          contact: info?.operatorEmail ? (
            <a href={`mailto:${info.operatorEmail}`}>{info.operatorEmail}</a>
          ) : (
            <NotProvided />
          ),
        })}
      </p>
    </>
  );
}
