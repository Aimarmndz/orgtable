// Caja de búsqueda: un formulario GET que navega a /search?q=… No necesita JavaScript
// (mejora progresiva); el servidor renderiza los resultados. Ver docs/search.md.
export function SearchBox({
  defaultValue = "",
  autoFocus = false,
  size = "sm",
}: {
  defaultValue?: string;
  autoFocus?: boolean;
  size?: "sm" | "lg";
}) {
  const big = size === "lg";
  return (
    <form action="/search" role="search" className="relative">
      <svg
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        autoFocus={autoFocus}
        placeholder="Buscar tarjetas y tableros…"
        aria-label="Buscar"
        maxLength={120}
        className={`w-full rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-ink outline-none transition-colors placeholder:text-ink-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 ${
          big ? "py-2.5" : "h-9"
        }`}
      />
    </form>
  );
}
