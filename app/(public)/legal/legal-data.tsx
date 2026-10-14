import { Fragment, type ReactNode } from "react";
import { formatDate } from "@/app/lib/format-date";
import { fmt } from "@/app/i18n/format";
import { rich, type RichTags } from "@/app/i18n/rich";
import { getI18n } from "@/app/i18n/server";
import type { LegalInfo } from "@/app/lib/services/instance";

// Shared pieces of the legal pages. Whatever the operator has not filled in is shown as
// such ("not provided") instead of being made up: a legal text must not state false data.

export async function NotProvided() {
  const { m } = await getI18n();
  return <span className="text-ink-muted italic">{m.legal.shared.notProvided}</span>;
}

/**
 * Like rich(), but some {placeholders} are filled with React nodes (the operator's data or
 * <NotProvided />). Instance data never goes through rich(): a value typed by the admin
 * that happens to look like a <tag> must stay plain text.
 */
export function richWith(
  template: string,
  nodes: Record<string, ReactNode>,
  tags: RichTags = {},
): ReactNode {
  const names = Object.keys(nodes);
  if (names.length === 0) return rich(template, tags);
  const parts = template.split(new RegExp(`\\{(${names.join("|")})\\}`));
  // split() with a capture group alternates text and placeholder names.
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={i}>{i % 2 === 0 ? rich(part, tags) : nodes[part]}</Fragment>
      ))}
    </>
  );
}

export async function LegalHeading({
  title,
  info,
}: {
  title: string;
  info: LegalInfo | null;
}) {
  const { m, intl } = await getI18n();
  const t = m.legal.shared;
  return (
    <header className="mb-8">
      <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        {info ? fmt(t.appliesToNamed, { instance: info.instanceName }) : t.appliesTo}
        {info?.legalUpdatedAt ? (
          <> {fmt(t.lastUpdated, { date: formatDate(info.legalUpdatedAt, intl) })}</>
        ) : null}
      </p>
    </header>
  );
}

/** Controller card: who operates the instance and how to contact them. */
export async function OperatorCard({ info }: { info: LegalInfo | null }) {
  const { m } = await getI18n();
  const t = m.legal.shared.operator;
  const rows: { label: string; value: ReactNode }[] = [
    { label: t.controller, value: info?.operatorName ?? <NotProvided /> },
    {
      label: t.contact,
      value: info?.operatorEmail ? (
        <a href={`mailto:${info.operatorEmail}`}>{info.operatorEmail}</a>
      ) : (
        <NotProvided />
      ),
    },
    { label: t.taxId, value: info?.operatorLegalId ?? <NotProvided /> },
    { label: t.address, value: info?.operatorAddress ?? <NotProvided /> },
    { label: t.hosting, value: info?.hostingDescription ?? <NotProvided /> },
  ];
  return (
    <dl className="not-prose grid gap-x-6 gap-y-4 rounded-2xl border border-border bg-surface p-5 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
            {r.label}
          </dt>
          <dd className="mt-0.5 break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Warning shown while the admin has not filled in the instance's legal details. */
export async function MissingLegalInfoNotice({ info }: { info: LegalInfo | null }) {
  if (info?.operatorName && info.operatorEmail) return null;
  const { m } = await getI18n();
  return (
    <p
      role="note"
      className="not-prose mb-8 rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger"
    >
      {m.legal.shared.missingInfo}
    </p>
  );
}
