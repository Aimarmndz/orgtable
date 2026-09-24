# Design

Sistema visual de orgtable. Estética: **Editorial cálido**. El cromo vive en neutros
cálidos (arena, papel, espresso) con un único acento **terracota**; el color del
contenido (fondos de tablero y etiquetas) usa una paleta apagada y cohesiva. Tokens en
OKLCH, definidos en `app/globals.css` (Tailwind 4 `@theme`), con temas claro y oscuro.

## Color

Estrategia: **Restrained en el cromo, apagado-cohesivo en el contenido**. La interfaz
base es cálida y neutra; el único acento es la terracota (saturación < 80%). Sin morado
neón, sin glows, sin negro puro (el "ink" es un espresso cálido).

### Neutros (cromo)

| Rol | Claro (OKLCH) | Oscuro (OKLCH) | Uso |
|-----|---------------|----------------|-----|
| `--bg` | 0.965 0.013 74 | 0.205 0.012 52 | Fondo de la app (arena / carbón cálido) |
| `--surface` | 0.992 0.005 80 | 0.25 0.014 52 | Tarjetas, paneles, modales (papel) |
| `--surface-2` | 0.94 0.015 74 | 0.30 0.016 52 | Inputs, hovers |
| `--column` | 0.95 0.014 72 | 0.23 0.013 52 | Fondo de columnas del tablero |
| `--ink` | 0.27 0.022 52 | 0.95 0.012 75 | Texto principal (≥4.5:1) |
| `--ink-muted` | 0.49 0.026 55 | 0.73 0.02 68 | Texto secundario (≥4.5:1) |
| `--border` | 0.88 0.016 72 | 0.36 0.016 55 | Bordes sutiles, divisores |

### Acento e intención

| Rol | Claro | Oscuro | Uso |
|-----|-------|--------|-----|
| `--accent` | 0.56 0.125 42 | 0.68 0.115 45 | Acción primaria, foco, selección (terracota) |
| `--accent-ink` | 0.99 0.01 80 | 0.2 0.02 50 | Texto sobre acento |
| `--danger` | 0.52 0.18 28 | 0.71 0.16 30 | Borrar, error |
| `--success` | 0.48 0.1 145 | 0.72 0.1 150 | Confirmaciones |

### Colores de tablero / etiqueta (contenido)

Paleta editorial **apagada** (clay, oliva, ciruela, ocre, ladrillo, pizarra), no
vibrante, en `app/lib/colors.ts`. Tableros con L≤0.54 y etiquetas con L≈0.52–0.57 para
que el texto blanco encima sea legible. Sobre un fondo de tablero coloreado, las
columnas son papel con un punto de translucidez (`bg-column/95`) y las tarjetas son
`--surface` sólido con una **regla lateral** tintada con el color de su primera etiqueta.

## Typography

Dos familias con carácter (auto-alojadas en `app/fonts`, Fontshare; ver `app/layout.tsx`):

- **Cabinet Grotesk** (`--font-display`, utilidad `font-display`): titulares y la marca.
  Tracking ceñido (`tracking-tight`), pesos 700–900. Jerarquía por peso y color, no por
  tamaños desmedidos.
- **Satoshi** (`--font-sans`): interfaz y cuerpo, pesos 400/500/700.
- **Geist Mono** (`--font-mono`): números tabulares, metadatos, contadores.

Banned: Inter y serifas genéricas. Escala fija en rem, ratio ~1.2. `text-wrap: balance`
en titulares. Mayúsculas solo en micro-etiquetas (≤2 palabras, p. ej. cabeceras de
columna y de sección).

| Token | Tamaño / peso / familia | Uso |
|-------|-------------------------|-----|
| Display de página | 1.875–3rem / 700–800 / Cabinet | "Tus tableros", título de tablero, login |
| Subtítulo | 1.25rem / 700 / Cabinet | Título de modal |
| Cuerpo | 0.875rem / 400–500 / Satoshi | Texto de tarjeta, formularios |
| Micro-etiqueta | 0.625–0.75rem / 600 / Satoshi (mayús.) | Cabeceras de columna/sección |

## Components

Vocabulario consistente. Cada control define `default / hover / focus-visible / active /
disabled`.

- **Botón primario**: fondo `--accent`, texto `--accent-ink`, radio 8px, sin glow;
  feedback táctil `active:translate-y-px`; foco con anillo `--accent`.
- **Botón sutil/ghost/danger**: transparente o `--surface-2`; mismo feedback táctil.
- **Input**: fondo `--surface`, borde `--border`, label encima, error debajo; foco con
  borde + anillo `--accent`.
- **Tarjeta (card)**: `--surface`, radio 8px, borde 1px, sombra tintada ≤8px; regla
  lateral de 3px con el color de la primera etiqueta; etiquetas como `punto + NOMBRE`.
  Si tiene checklist, una **barra de progreso** slim en la cara muestra el avance de un
  vistazo (acento mientras avanza, `--success` al completarse) + contador `done/total`.
- **Columna**: papel translúcido sobre el fondo del tablero, radio 16px, cabecera en
  versalitas.
- **Etiqueta**: pastilla con color apagado de la paleta, radio completo, texto legible.
- **Modal**: `<dialog>`/portal; backdrop oscurecido; escala+fade de entrada; sombra
  difusa amplia tintada al ink.
- **Empty state**: enseña qué hacer (no "no hay nada"), con icono SVG (nunca emoji).

Radios: inputs/botones 8px, tarjetas 8px, columnas 16px, modales/paneles 16px,
pastillas/etiquetas completo.

## Layout

- **App shell**: barra superior fina translúcida (logo display, nombre de instancia,
  tema, usuario) + área de contenido.
- **Login**: split asimétrico — panel de marca terracota (display grande) a un lado,
  formulario al otro; colapsa a una columna por debajo de `lg`.
- **Columnas**: flex horizontal, ancho fijo (~18rem), scroll-x; tarjetas en flex
  vertical con scroll-y interno.
- **Tableros (índice)**: grid `repeat(auto-fill, minmax(15rem, 1fr))`, cada tablero con
  su color apagado y un degradado sutil para legibilidad del título.
- **Z-index semántico**: textura(0) → contenido(10) → barra(20) → modal-backdrop(30) →
  modal(40) → toast(50).

## Motion

150–250 ms, `ease-out`. La motion comunica estado (hover, arrastre, apertura de modal,
feedback táctil de botón), nunca decora. `prefers-reduced-motion`: crossfade o
instantáneo. Sin secuencias de carga orquestadas.

## Textura

Grano de papel sutil global: capa `body::before` fija, `pointer-events: none`, mezcla
`multiply` (claro) / `screen` (oscuro) a baja opacidad. Solo en pseudo-elemento fijo —
nunca en contenedores con scroll, para no repintar la GPU al desplazar.
