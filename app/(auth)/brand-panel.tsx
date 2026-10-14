// Panel de marca de las pantallas de acceso (login y registro). Solo en pantallas anchas;
// en móvil cada formulario lleva su marca compacta. Acento terracota y display grande.
export function BrandPanel() {
  return (
    <aside className="relative hidden flex-col justify-between overflow-hidden bg-accent p-12 text-accent-ink lg:flex">
      {/* Arcos concéntricos sutiles como textura de fondo (no decorativa en exceso). */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-40 -top-40 size-[34rem] rounded-full border border-accent-ink/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-52 -left-32 size-[40rem] rounded-full border border-accent-ink/10"
      />

      <div className="relative flex items-center gap-2.5">
        <span className="grid size-8 place-items-center rounded-lg bg-accent-ink/15 font-display text-lg font-extrabold">
          o
        </span>
        <span className="font-display text-lg font-bold tracking-tight">orgtable</span>
      </div>

      <div className="relative max-w-md">
        <h2 className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-balance">
          Tu trabajo, en columnas que respiran.
        </h2>
        <p className="mt-5 max-w-sm leading-relaxed text-accent-ink/80">
          Tableros Kanban self-hosted y de código abierto. Sin anuncios y sin terceros
          mirando.
        </p>

        {/* Miniatura de un tablero: anticipa el producto sin capturas ni ilustraciones. */}
        <div aria-hidden className="mt-9 grid max-w-sm grid-cols-2 gap-2.5">
          {[
            { title: "Por hacer", cards: ["Preparar la demo", "Revisar el presupuesto"] },
            { title: "Hecho", cards: ["Crear el tablero"] },
          ].map((col) => (
            <div key={col.title} className="flex flex-col gap-2 rounded-xl bg-accent-ink/12 p-2.5">
              <span className="px-1 text-[10px] font-semibold uppercase tracking-wider opacity-80">
                {col.title}
              </span>
              {col.cards.map((c) => (
                <span
                  key={c}
                  className="rounded-lg bg-surface px-2.5 py-2 text-sm font-medium text-ink shadow-sm"
                >
                  {c}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="relative font-mono text-xs uppercase tracking-widest text-accent-ink/60">
        Kanban · Self-hosted · Código abierto
      </p>
    </aside>
  );
}
