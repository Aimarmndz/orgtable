import type { Metadata } from "next";
import { getLegalInfo } from "@/app/lib/services/instance";
import { SESSION_MAX_AGE_DAYS } from "@/app/lib/session";
import { getI18n } from "@/app/i18n/server";
import { plural } from "@/app/i18n/format";
import { LegalHeading } from "../legal-data";

export async function generateMetadata(): Promise<Metadata> {
  const { m } = await getI18n();
  return { title: m.legal.cookies.title, description: m.legal.cookies.metaDescription };
}

// Only strictly necessary storage (art. 22.2 LSSI), which is why there is no consent
// banner. If analytics is ever added, a banner is needed BEFORE loading it.
// The `locale` row must match the cookie set in app/lib/actions/locale.ts (one year).
export default async function CookiesPage() {
  const [info, { m, intl }] = await Promise.all([getLegalInfo(), getI18n()]);
  const t = m.legal.cookies;
  const rows = [
    {
      name: "session",
      ...t.session,
      duration: plural(intl, t.session.duration, SESSION_MAX_AGE_DAYS),
    },
    { name: "locale", ...t.locale },
    { name: "theme", ...t.theme },
  ];

  return (
    <>
      <LegalHeading title={t.title} info={info} />

      <p>{t.intro}</p>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{t.colName}</th>
              <th scope="col">{t.colType}</th>
              <th scope="col">{t.colPurpose}</th>
              <th scope="col">{t.colDuration}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <code>{r.name}</code>
                </td>
                <td>{r.type}</td>
                <td>{r.purpose}</td>
                <td>{r.duration}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p>{t.outro}</p>
    </>
  );
}
