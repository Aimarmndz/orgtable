import Link from "next/link";
import { requireUser } from "@/app/lib/dal";
import { getApiTokensForUser } from "@/app/lib/queries";
import { revokeApiToken } from "@/app/lib/actions/tokens";
import { CreateTokenForm } from "./create-token-form";

export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(d);
}

export default async function SettingsPage() {
  const user = await requireUser();
  const tokens = await getApiTokensForUser(user.id);

  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl overflow-y-auto p-6 sm:p-8">
      <h1 className="font-display text-3xl font-bold tracking-tight">Ajustes</h1>
      <p className="mt-1.5 text-sm text-ink-muted">
        Tu cuenta: {user.name} · {user.email}
      </p>

      <section className="mt-8">
        <h2 className="font-display text-lg font-bold tracking-tight">
          Tokens de API
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Crea tokens para usar la API de orgtable desde scripts u otras
          aplicaciones. Un token actúa <strong>como tú</strong>: tiene tu mismo
          acceso a los tableros. Guárdalo en un lugar seguro; solo se muestra una
          vez. Consulta la{" "}
          <Link
            href="https://github.com/Aimarmndz/orgtable/blob/main/docs/api/public-api.md"
            className="text-accent underline-offset-2 hover:underline"
          >
            documentación de la API
          </Link>
          .
        </p>

        <div className="mt-5">
          <CreateTokenForm />
        </div>

        {tokens.length === 0 ? (
          <p className="mt-6 text-sm text-ink-muted">
            Aún no has creado ningún token.
          </p>
        ) : (
          <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 bg-surface px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-ink-muted">
                    {t.prefix}… · creado {formatDate(t.createdAt)} ·{" "}
                    {t.lastUsedAt
                      ? `usado por última vez ${formatDate(t.lastUsedAt)}`
                      : "sin usar"}
                  </p>
                </div>
                <form action={revokeApiToken}>
                  <input type="hidden" name="id" value={t.id} />
                  <button className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10">
                    Revocar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
