import { formatDate } from "@/app/lib/format-date";
import type { LegalInfo } from "@/app/lib/services/instance";

// Piezas comunes de las páginas legales. Lo que el operador no ha rellenado se dice tal
// cual («sin indicar») en vez de inventarlo: el texto legal no puede afirmar datos falsos.

export function NotProvided() {
  return <span className="text-ink-muted italic">sin indicar por el operador</span>;
}

export function LegalHeading({
  title,
  info,
}: {
  title: string;
  info: LegalInfo | null;
}) {
  return (
    <header className="mb-8">
      <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-balance sm:text-5xl">
        {title}
      </h1>
      <p className="mt-3 text-sm text-ink-muted">
        Se aplica a esta instancia de orgtable
        {info ? <> ({info.instanceName})</> : null}.
        {info?.legalUpdatedAt ? (
          <> Última actualización: {formatDate(info.legalUpdatedAt)}.</>
        ) : null}
      </p>
    </header>
  );
}

/** Ficha del responsable: quién opera la instancia y cómo contactarle. */
export function OperatorCard({ info }: { info: LegalInfo | null }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Responsable", value: info?.operatorName ?? <NotProvided /> },
    {
      label: "Contacto",
      value: info?.operatorEmail ? (
        <a href={`mailto:${info.operatorEmail}`}>{info.operatorEmail}</a>
      ) : (
        <NotProvided />
      ),
    },
    { label: "NIF", value: info?.operatorLegalId ?? <NotProvided /> },
    { label: "Dirección", value: info?.operatorAddress ?? <NotProvided /> },
    {
      label: "Dónde se alojan los datos",
      value: info?.hostingDescription ?? <NotProvided />,
    },
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

/** Aviso cuando el admin aún no ha rellenado los datos legales de la instancia. */
export function MissingLegalInfoNotice({ info }: { info: LegalInfo | null }) {
  if (info?.operatorName && info.operatorEmail) return null;
  return (
    <p
      role="note"
      className="not-prose mb-8 rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger"
    >
      El administrador de esta instancia todavía no ha indicado quién es el responsable ni
      cómo contactarle. Mientras falten esos datos, el registro abierto está desactivado.
    </p>
  );
}
