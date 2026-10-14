import type { Metadata } from "next";
import Link from "next/link";
import { getLegalInfo } from "@/app/lib/services/instance";
import {
  auditRetentionDays,
  ENDED_SESSION_RETENTION_DAYS,
  NOTIFICATION_RETENTION_DAYS,
} from "@/app/lib/services/maintenance";
import { SESSION_MAX_AGE_DAYS } from "@/app/lib/session";
import { parseTrustedProxyHops } from "@/app/lib/client-ip";
import { getI18n } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";
import { rich } from "@/app/i18n/rich";
import {
  LegalHeading,
  MissingLegalInfoNotice,
  NotProvided,
  OperatorCard,
  richWith,
} from "../legal-data";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.legal.privacy.title, description: m.legal.privacy.metaDescription };
}

const b = (t: string) => <strong>{t}</strong>;

// Retention periods come from the same constants used by the cleanup job
// (services/maintenance.ts) and the session length in session.ts: if the code changes,
// the text changes with it.
export default async function PrivacyPage() {
  const [info, { m, intl }] = await Promise.all([getLegalInfo(), getI18n()]);
  const t = m.legal.privacy;
  const auditDays = auditRetentionDays();
  // Without trusted proxies the app does not know the real IP and does not store it
  // (client-ip.ts).
  const storesIp = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS) > 0;
  const dataRows = [
    t.data.account,
    t.data.acceptance,
    t.data.content,
    t.data.notifications,
    t.data.sessions,
    t.data.tokens,
    {
      data: storesIp ? t.data.audit.dataWithIp : t.data.audit.dataWithoutIp,
      purpose: t.data.audit.purpose,
      basis: t.data.audit.basis,
    },
  ];
  const settingsLink = (anchor: string, text: string) => (
    <Link href={`/settings#${anchor}`}>{text}</Link>
  );

  return (
    <>
      <LegalHeading title={t.title} info={info} />
      <MissingLegalInfoNotice info={info} />

      <h2>{t.summary.heading}</h2>
      <p>{rich(t.summary.body, { link: (c) => settingsLink("data", c) })}</p>

      <h2>{t.controller.heading}</h2>
      <p>{t.controller.body}</p>
      <OperatorCard info={info} />

      <h2>{t.data.heading}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{t.data.colData}</th>
              <th scope="col">{t.data.colPurpose}</th>
              <th scope="col">{t.data.colBasis}</th>
            </tr>
          </thead>
          <tbody>
            {dataRows.map((row) => (
              <tr key={row.data}>
                <td>{row.data}</td>
                <td>{row.purpose}</td>
                <td>{row.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t.data.noProfiling}</p>

      <h2>{t.retention.heading}</h2>
      <ul>
        <li>{t.retention.account}</li>
        <li>
          {plural(intl, t.retention.sessionLength, SESSION_MAX_AGE_DAYS)}{" "}
          {plural(intl, t.retention.endedSessions, ENDED_SESSION_RETENTION_DAYS)}
        </li>
        <li>{plural(intl, t.retention.notifications, NOTIFICATION_RETENTION_DAYS)}</li>
        <li>{plural(intl, t.retention.audit, auditDays)}</li>
        <li>
          {info?.backupRetentionDays != null
            ? info.backupRetentionDays === 0
              ? t.retention.backupsNone
              : plural(intl, t.retention.backupsDays, info.backupRetentionDays)
            : richWith(t.retention.backupsUnknown, { notProvided: <NotProvided /> })}
        </li>
      </ul>

      <h2>{t.recipients.heading}</h2>
      <ul>
        <li>{rich(t.recipients.boardMembers, { b })}</li>
        <li>{rich(t.recipients.organization, { b })}</li>
        <li>{rich(t.recipients.admin, { b })}</li>
        <li>
          {richWith(
            t.recipients.hosting,
            { hosting: info?.hostingDescription ?? <NotProvided /> },
            { b },
          )}
        </li>
      </ul>
      <p>{t.recipients.outsideEea}</p>
      <p>{t.recipients.noticeBeforeSharing}</p>

      <h2>{t.cookies.heading}</h2>
      <p>
        {rich(t.cookies.body, {
          code: (c) => <code>{c}</code>,
          link: (c) => <Link href="/legal/cookies">{c}</Link>,
        })}
      </p>

      <h2>{t.rights.heading}</h2>
      <p>{t.rights.intro}</p>
      <ul>
        <li>{rich(t.rights.access, { b, link: (c) => settingsLink("data", c) })}</li>
        <li>{rich(t.rights.rectification, { b, link: (c) => settingsLink("profile", c) })}</li>
        <li>{rich(t.rights.erasure, { b, link: (c) => settingsLink("data", c) })}</li>
        <li>{rich(t.rights.objection, { b })}</li>
      </ul>
      <p>
        {rich(t.rights.complaint, { link: (c) => <a href="https://www.aepd.es">{c}</a> })}
      </p>

      <h2>{t.security.heading}</h2>
      <p>{t.security.body}</p>

      <h2>{t.changes.heading}</h2>
      <p>{rich(t.changes.body, { link: (c) => settingsLink("about", c) })}</p>
    </>
  );
}
