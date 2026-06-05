# Design

Sistema visual de orgtable. Estética: **Trello clásico, colorido**, con temas claro y
oscuro. El color vive en el contenido (fondos de tablero y etiquetas); el cromo es
neutro. Tokens en OKLCH, definidos en `app/globals.css` (Tailwind 4 `@theme`).

## Color

Estrategia: **Restrained en el cromo, Committed en el contenido**. La interfaz base es
neutra; cada tablero aporta su color de fondo y las etiquetas su acento.

### Neutros (cromo)

| Rol | Claro (OKLCH) | Oscuro (OKLCH) | Uso |
|-----|---------------|----------------|-----|
| `--bg` | 0.975 0.004 255 | 0.17 0.012 260 | Fondo de la app |
| `--surface` | 1 0 0 | 0.215 0.014 260 | Tarjetas, paneles, modales |
| `--surface-2` | 0.965 0.005 255 | 0.255 0.015 260 | Columnas, inputs, hovers |
| `--ink` | 0.22 0.02 260 | 0.96 0.01 260 | Texto principal (≥4.5:1) |
| `--ink-muted` | 0.48 0.02 260 | 0.72 0.015 260 | Texto secundario (≥4.5:1) |
| `--border` | 0.90 0.006 255 | 0.30 0.015 260 | Bordes sutiles, divisores |

### Acento e intención

| Rol | Claro | Oscuro | Uso |
|-----|-------|--------|-----|
| `--accent` | 0.55 0.17 255 | 0.68 0.15 255 | Acción primaria, foco, selección |
| `--accent-ink` | 1 0 0 | 0.17 0.02 260 | Texto sobre acento |
| `--danger` | 0.55 0.20 25 | 0.68 0.17 25 | Borrar, error |
| `--success` | 0.60 0.15 150 | 0.72 0.14 150 | Confirmaciones |

### Colores de tablero / etiqueta (Committed)

Paleta de 6 hues vibrantes para fondos de tablero y etiquetas (cada uno con variantes
para claro/oscuro): azul `255`, verde `150`, púrpura `300`, ámbar `75`, rosa `0`,
teal `195`. Sobre un fondo de tablero coloreado, las columnas son una capa translúcida
neutra y las tarjetas son `--surface` sólido.

## Typography

Una sola familia: **Geist Sans** (ya cargada vía `next/font`), Geist Mono solo para
detalles técnicos puntuales. Escala fija en rem (no fluida), ratio ~1.2.

| Token | Tamaño / peso | Uso |
|-------|---------------|-----|
| Título de página | 1.5rem / 600 | Cabecera de "Tus tableros", título de tablero |
| Subtítulo | 1.125rem / 600 | Cabecera de columna, título de modal |
| Cuerpo | 0.875rem / 400 | Texto de tarjeta, formularios |
| Etiqueta | 0.75rem / 500 | Metadatos, botones pequeños |

`text-wrap: balance` en títulos. Sin mayúsculas en cuerpo; mayúsculas solo en
micro-etiquetas (≤2 palabras).

## Components

Vocabulario consistente en todas las pantallas. Cada control interactivo define
`default / hover / focus-visible / active / disabled`.

- **Botón primario**: fondo `--accent`, texto `--accent-ink`, radio 8px, sin sombra
  difusa; hover sube ligeramente la luminosidad; foco con anillo `--accent`.
- **Botón sutil/ghost**: transparente, hover `--surface-2`.
- **Input**: fondo `--surface`, borde `--border`, foco anillo `--accent`.
- **Tarjeta (card)**: `--surface`, radio 8px, borde `--border` de 1px (sin sombra
  difusa de >8px en el mismo elemento), hover eleva con sombra definida ≤8px.
- **Columna**: capa translúcida sobre el fondo del tablero, radio 12px.
- **Etiqueta**: pastilla con color de la paleta, radio completo, texto legible.
- **Modal**: `<dialog>` nativo o portal; backdrop oscurecido; escala+fade de entrada.
- **Empty state**: enseña qué hacer (no "no hay nada").

Radios: inputs/botones 8px, tarjetas 8px, columnas/paneles 12px, modal 16px,
pastillas/etiquetas completo. Nunca 24px+ en tarjetas.

## Layout

- **App shell**: barra superior fina (logo, nombre de instancia, tema, usuario) +
  área de contenido. El tablero ocupa todo el ancho con scroll horizontal de columnas.
- **Columnas**: flex horizontal, ancho fijo (~18rem), scroll-x; tarjetas en flex
  vertical con scroll-y interno.
- **Tableros (índice)**: grid `repeat(auto-fill, minmax(15rem, 1fr))`, cada tablero
  con su color de fondo.
- **Z-index semántico**: dropdown(10) → sticky(20) → modal-backdrop(30) → modal(40) →
  toast(50).

## Motion

150–250 ms, `ease-out`. La motion comunica estado (hover, arrastre, apertura de
modal, entrada de tarjeta), nunca decora. `prefers-reduced-motion`: crossfade o
instantáneo. Sin secuencias de carga orquestadas.
