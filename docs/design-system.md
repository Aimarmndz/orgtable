# Sistema de diseño

Este documento describe el sistema visual de **orgtable**: su estética, los tokens de
color, el tema oscuro, las paletas de contenido y los componentes de interfaz
reutilizables. Es un resumen operativo; las decisiones de diseño completas viven en
[`DESIGN.md`](../DESIGN.md) y [`PRODUCT.md`](../PRODUCT.md).

---

## Estética y principios

orgtable es un **clon de Trello self-hosted** (tableros → listas →
tarjetas con arrastrar y soltar). El producto debe sentirse tan fluido y familiar como
Trello, pero que sea tuyo. La marca es **familiar, colorida y directa**; alegre sin ser
infantil. La voz es concreta y en español.

El principio central es:

> **El color vive en el contenido; el cromo es neutro.**

Los fondos de tablero y las etiquetas llevan el color (estrategia *committed*); la
interfaz base —barras, paneles, tarjetas, formularios— se mantiene neutra (estrategia
*restrained*). El tablero es el héroe: cabeceras y navegación se apartan para que mande el
contenido.

**Anti-referencias** (lo que evitamos): UI corporativa gris sin vida, dashboards SaaS
genéricos con gradientes decorativos y eyebrows en mayúsculas, y el "look hecho por IA"
(grises lavados sobre casi-blancos, bordes laterales de color como acento, sombras difusas
pegadas a bordes de 1px).

### Accesibilidad

- **Contraste AA**: el texto de cuerpo cumple ≥4.5:1 (los tokens `--ink` e `--ink-muted`
  están calibrados para ello en ambos temas).
- Las **etiquetas de color nunca son el único indicador**: siempre llevan nombre/texto.
- **Tema claro y oscuro** con selector persistente.
- **`prefers-reduced-motion`** se respeta globalmente en `globals.css` (ver
  [Motion](#motion)).

---

## Tokens semánticos (OKLCH)

Los tokens se definen en [`app/globals.css`](../app/globals.css) con **OKLCH** (mejor
control perceptual de luminosidad y croma que RGB/HSL). Se exponen a Tailwind 4 mediante
`@theme inline`, que mapea cada variable CSS a una `--color-*` utilizable como
`bg-surface`, `text-ink`, `border-border`, etc.

```css
@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-column: var(--column);
  --color-ink: var(--ink);
  --color-ink-muted: var(--ink-muted);
  --color-border: var(--border);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-accent-ink: var(--accent-ink);
  --color-danger: var(--danger);
  --color-success: var(--success);
  /* … fuentes … */
}
```

### Neutros (cromo)

| Token | Claro | Oscuro | Uso |
|-------|-------|--------|-----|
| `--bg` | `0.975 0.004 255` | `0.17 0.012 260` | Fondo de la app |
| `--surface` | `1 0 0` | `0.255 0.014 260` | Tarjetas, paneles, modales |
| `--surface-2` | `0.96 0.005 255` | `0.3 0.015 260` | Inputs, hovers, fondos secundarios |
| `--column` | `0.955 0.006 255` | `0.205 0.013 260` | Columnas del tablero |
| `--ink` | `0.22 0.02 260` | `0.96 0.01 260` | Texto principal (≥4.5:1) |
| `--ink-muted` | `0.46 0.02 260` | `0.72 0.015 260` | Texto secundario (≥4.5:1) |
| `--border` | `0.9 0.006 255` | `0.34 0.015 260` | Bordes y divisores sutiles |

### Acento e intención

| Token | Claro | Oscuro | Uso |
|-------|-------|--------|-----|
| `--accent` | `0.55 0.17 255` | `0.68 0.15 255` | Acción primaria, foco, selección |
| `--accent-hover` | `0.5 0.17 255` | `0.74 0.15 255` | Hover del acento |
| `--accent-ink` | `1 0 0` | `0.17 0.02 260` | Texto sobre acento |
| `--danger` | `0.55 0.2 25` | `0.7 0.17 25` | Borrar, error |
| `--success` | `0.6 0.15 150` | `0.72 0.14 150` | Confirmaciones, progreso |

> Todos los valores son `oklch(L C H)`. Cada token tiene su par claro/oscuro: el tema lo
> selecciona reasignando las variables bajo `:root` o `.dark`.

---

## Tema oscuro

El tema oscuro funciona **por clase**: una clase `.dark` en `<html>` que reasigna todas
las variables de color. La activación a nivel de Tailwind se declara con
`@custom-variant`:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Esto hace que utilidades como `dark:block` o `dark:hidden` se apliquen cuando el elemento
está dentro de un árbol con la clase `.dark`, en lugar de depender de
`prefers-color-scheme`. Así el usuario puede **forzar** un tema independientemente de la
preferencia del sistema.

### Toggle persistente

El componente [`ThemeToggle`](../app/components/theme-toggle.tsx) alterna la clase y
persiste la elección en `localStorage`. No necesita estado de React: los dos iconos
(sol/luna) se muestran por CSS según la clase `.dark` (`dark:block` / `dark:hidden`).

```tsx
function toggle() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  localStorage.setItem("theme", next ? "dark" : "light");
}
```

### Script anti-parpadeo (anti-FOUC)

Si el tema se aplicara desde React tras la hidratación, habría un **flash** del tema
incorrecto en la primera pintura. Para evitarlo,
[`app/layout.tsx`](../app/layout.tsx) inyecta un script **inline en `<head>`** que se
ejecuta antes del primer paint: lee `localStorage`, cae a `prefers-color-scheme` si no hay
preferencia guardada y añade la clase `.dark` si procede.

```js
(function(){
  try {
    var t = localStorage.getItem('theme');
    var m = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (t === 'dark' || (t !== 'light' && m)) {
      document.documentElement.classList.add('dark');
    }
  } catch(e) {}
})();
```

El `<html>` lleva `suppressHydrationWarning` porque el script muta la clase antes de que
React hidrate, lo que de otro modo provocaría un aviso de discordancia.

La fuente es **Geist Sans** (con Geist Mono para detalles técnicos), cargada vía
`next/font` y expuesta como `--font-geist-sans` / `--font-geist-mono`.

---

## Paletas de contenido

Definidas en [`app/lib/colors.ts`](../app/lib/colors.ts). Son colores del **contenido**
(no del cromo): vibrantes y con luminosidad lo bastante baja para que el **texto blanco**
encima sea legible (≥4.5:1).

### Color de tablero — `BOARD_COLORS`

Seis hues para los fondos de tablero:

```ts
export const BOARD_COLORS = {
  blue:   "oklch(0.55 0.13 255)",
  green:  "oklch(0.56 0.12 155)",
  purple: "oklch(0.52 0.15 300)",
  amber:  "oklch(0.62 0.13 70)",
  rose:   "oklch(0.57 0.16 8)",
  teal:   "oklch(0.56 0.09 195)",
} as const;
```

Helpers asociados:

- `pickBoardColor(seed)` — color **determinista** a partir de un id (hash simple), para
  asignar un color estable al crear un tablero sin color explícito.
- `boardBackgroundFor({ id, background })` — usa el color elegido o, si no hay, uno estable
  según el `id`.

### Color de etiqueta — `LABEL_COLORS`

Ocho colores para las etiquetas (todas con L ~0.55–0.64 → texto blanco legible):

```ts
export const LABEL_COLORS = {
  green:  "oklch(0.6 0.14 150)",
  lime:   "oklch(0.62 0.14 130)",
  amber:  "oklch(0.64 0.13 70)",
  red:    "oklch(0.58 0.2 25)",
  purple: "oklch(0.55 0.16 300)",
  blue:   "oklch(0.58 0.15 255)",
  teal:   "oklch(0.58 0.1 195)",
  pink:   "oklch(0.6 0.18 350)",
} as const;
```

`labelBackground(color)` devuelve el color de fondo de una pastilla (con *fallback* a
`blue`). Las claves se exponen como `LABEL_COLOR_KEYS` para pintar el selector de color al
crear una etiqueta (ver [`docs/card-detail.md`](./card-detail.md)).

---

## Componentes de interfaz

Un vocabulario reducido y consistente. Los radios siguen la escala de `DESIGN.md`
(inputs/botones/tarjetas 8px, columnas/paneles 12px, modal 16px, pastillas radio completo).

### Button

[`app/components/ui/button.tsx`](../app/components/ui/button.tsx) — botón presentacional
(sin `"use client"`, válido en componentes de servidor y cliente) con cuatro variantes:

| Variante | Estilo |
|----------|--------|
| `primary` | `bg-accent text-accent-ink hover:bg-accent-hover` |
| `ghost` | `text-ink-muted hover:bg-surface-2 hover:text-ink` |
| `danger` | `text-danger hover:bg-danger/10` |
| `subtle` | `bg-surface-2 text-ink hover:bg-border` |

Base común: `rounded-lg`, `px-4 py-2`, `text-sm font-medium`, `transition-colors`, anillo
de foco `focus-visible:outline-accent` y estado `disabled` (`opacity-60`,
`pointer-events-none`).

```tsx
<Button>Guardar</Button>                 {/* primary por defecto */}
<Button variant="subtle">Añadir</Button>
<Button variant="danger">Borrar</Button>
```

### Input y Textarea

[`app/components/ui/input.tsx`](../app/components/ui/input.tsx) exporta `Input` y
`Textarea` con estilos idénticos: fondo `--surface`, borde `--border`, texto `--ink`,
placeholder atenuado y foco con borde de acento + anillo
(`focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25`).

```tsx
<Input type="date" name="dueDate" />
<Textarea name="description" rows={4} />
```

---

## Motion

Transiciones de **150–250 ms** con `ease-out`. La motion comunica estado (hover, apertura
de modal, entrada de tarjeta), nunca decora. En `globals.css` viven los keyframes
`overlay-in` (fade del backdrop) y `dialog-in` (fade + leve `translateY`/`scale`), usados
por el modal de detalle.

La preferencia de movimiento reducido se respeta globalmente:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Además, las scrollbars se afinan en punteros finos (`scrollbar-width: thin`) porque las
columnas del tablero scrollean a menudo.

---

Ver también: [`DESIGN.md`](../DESIGN.md) · [`PRODUCT.md`](../PRODUCT.md) ·
[`docs/card-detail.md`](./card-detail.md).
