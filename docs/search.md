# Búsqueda

La búsqueda global (Hito 6) permite encontrar **tableros** y **tarjetas** desde
cualquier punto de la app. Es de solo lectura y está acotada a lo que el usuario puede
ver. La decisión técnica está en [ADR 0011](./decisions/0011-search-ilike-scoped.md).

## Cómo se usa

- En pantallas medianas o más anchas hay una **caja de búsqueda en la barra superior**.
  En móvil, un icono de lupa lleva a la página de búsqueda.
- Escribir y enviar (Enter) navega a `/search?q=…`. La página renderiza los resultados
  en el servidor: no hace falta JavaScript (mejora progresiva).
- Los resultados se agrupan en **Tableros** y **Tarjetas**. Cada tarjeta muestra su
  tablero y su lista, y al pulsarla se abre directamente en su tablero mediante un
  **deep-link** `?card=<id>` (ver más abajo).

## Qué se busca

- **Tableros**: por `title` y `description`.
- **Tarjetas**: por `title` y `description`.

La coincidencia es por **subcadena, insensible a mayúsculas** (`ILIKE`), con un mínimo
de 2 caracteres. Los resultados se ordenan por `updatedAt` (lo más reciente primero) y
se limitan (12 tableros, 30 tarjetas) para mantener la respuesta ligera.

## Autorización

La consulta (`searchForUser` en `app/lib/queries.ts`) **incluye el filtro de acceso en
el propio `WHERE`**: solo tableros donde el usuario es dueño o miembro, y tarjetas
dentro de esos tableros. Es el mismo patrón que `getBoardsForUser`. No hay filtrado en
cliente ni después de la consulta: el servidor es la única autoridad
([docs/authorization.md](./authorization.md)). Un usuario nunca verá en los resultados
una tarjeta de un tablero al que no pertenece.

## Deep-link a una tarjeta

`/board/<id>?card=<cardId>` abre el tablero con esa tarjeta ya desplegada en su modal.
La página de tablero lee `searchParams.card` y lo pasa a `BoardView` como
`initialCardId`. Si el id no existe en el tablero (por ejemplo, la tarjeta se borró), no
se abre nada: es un comportamiento seguro por defecto.

## Componentes y archivos

- `app/lib/queries.ts` — `searchForUser(userId, query)` y el tipo `SearchResults`.
- `app/(app)/search/page.tsx` — la página de resultados.
- `app/components/search-box.tsx` — la caja (formulario GET reutilizable, navbar y página).
- `app/(app)/board/[id]/page.tsx` + `app/components/board/board-view.tsx` — el deep-link.

## Límites conocidos y evolución

- Sin ranking por relevancia ni tolerancia a erratas. Orden por recencia.
- `ILIKE '%term%'` es un escaneo (el comodín inicial impide usar un índice B-tree). A la
  escala de una instancia self-hosted es instantáneo; si creciera, la vía es full-text
  de PostgreSQL (`tsvector` + GIN) o `pg_trgm`, sin cambiar la interfaz de
  `searchForUser`. Ver el ADR para el detalle.
