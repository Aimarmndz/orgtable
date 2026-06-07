# Filtros de tablero

El Hito 12 añade **filtros** en la vista de tablero para acotar las tarjetas visibles. Es
solo de presentación: oculta las que no encajan, no cambia datos.

## Cómo se usa

- En la cabecera del tablero, el botón **Filtrar** (con un contador de filtros activos)
  abre un panel con tres dimensiones:
  - **Etiquetas**: muestra solo tarjetas con al menos una de las etiquetas elegidas.
  - **Asignados**: solo tarjetas asignadas a al menos una de las personas elegidas.
  - **Vencimiento**: `Cualquiera` / `Vencidas` / `Con fecha` / `Sin fecha`.
- Dentro de una dimensión la lógica es **OR** (cualquiera vale); entre dimensiones es
  **AND** (deben cumplirse todas). «Limpiar filtros» lo resetea.
- Mientras hay un filtro activo, **el arrastre se desactiva** (las posiciones se calcularían
  sobre un subconjunto visible); al limpiar, vuelve a estar disponible.

## Diseño

- La lógica vive en un módulo **puro y testeable**, `app/lib/board-filters.ts`
  (`cardMatchesFilters`, `filtersActive`), compartido y cubierto por
  `test/board-filters.test.ts`.
- El estado de los filtros es local de cliente en `BoardView` (no va en la URL). La barra
  es `app/components/board/filter-bar.tsx`. `BoardView` filtra las tarjetas que pasa a cada
  `ListColumn` y propaga `sortingDisabled` a `ListColumn`/`CardItem`.

## Búsqueda vs. filtros

Los filtros acotan **un tablero** que ya tienes abierto. La **búsqueda global**
([docs/search.md](./search.md)) encuentra tableros y tarjetas en toda la instancia.

## Evolución (backlog)

- Filtros rápidos guardados por tablero.
- Filtro por estado de checklist.
- Búsqueda **full-text** de PostgreSQL (`tsvector` + GIN) detrás de `searchForUser` (hoy
  `ILIKE`, adecuado a la escala self-hosted — ver [ADR 0011](./decisions/0011-search-ilike-scoped.md)).
