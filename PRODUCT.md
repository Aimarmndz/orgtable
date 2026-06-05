# Product

## Register

product

## Users

Personas técnicas que auto-hospedan sus propias herramientas (desarrolladores,
equipos pequeños, entusiastas del self-hosting). Trabajan en el navegador, sobre todo
en escritorio. Su tarea principal es capturar trabajo y moverlo entre estados en
tableros Kanban: crear tarjetas rápido, arrastrarlas entre listas, abrir el detalle
para añadir contexto (descripción, etiquetas, fechas, checklists).

## Product Purpose

orgtable es un clon de Trello open-source y self-hosted: tableros → listas → tarjetas
con arrastrar y soltar. El éxito es que se sienta tan fluido y familiar como Trello,
pero que sea tuyo (tus datos, tu servidor). El producto desaparece detrás de la tarea.

## Brand Personality

Familiar, colorido y directo. Alegre sin ser infantil, con la confianza de una
herramienta de producto pulida. La voz es concreta y en español, sin jerga de
marketing.

## Anti-references

- UI corporativa gris y sin vida (estilo Jira pesado).
- Dashboards SaaS genéricos: tarjetas-métrica, gradientes decorativos, eyebrows en
  mayúsculas con tracking.
- El look "hecho por IA": grises lavados sobre casi-blancos, bordes laterales de color
  como acento, sombras difusas pegadas a bordes de 1px.
- Recargado o skeuomórfico.

## Design Principles

- **Familiaridad ganada.** El patrón Kanban de Trello es el lenguaje del producto; no
  se reinventa, se ejecuta bien.
- **El color vive en el contenido.** Los fondos de tablero y las etiquetas llevan el
  color; el cromo de la interfaz se mantiene neutro.
- **El tablero es el héroe.** Cabeceras y navegación se apartan para que el contenido
  mande.
- **Fluido por defecto.** Crear, arrastrar y mover ocurren al instante (UI optimista),
  sin recargas ni esperas.

## Accessibility & Inclusion

- Contraste AA: texto de cuerpo ≥4.5:1. Las etiquetas de color nunca son el único
  indicador (siempre llevan nombre o texto).
- Soporte de tema claro y oscuro con un selector persistente.
- `prefers-reduced-motion` respetado en todas las transiciones.
