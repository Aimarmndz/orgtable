# Vista de calendario

La vista de calendario (Hito 7) muestra las tarjetas de un tablero con **fecha de
vencimiento** sobre una rejilla mensual. Es una forma alternativa de mirar el mismo
tablero: no añade datos nuevos ni cambia el modelo.

## Cómo se usa

- En la cabecera de un tablero hay un conmutador **Tablero / Calendario**.
- En **Calendario** se ve el mes actual; las flechas cambian de mes y «Hoy» vuelve al
  mes en curso. El día de hoy se resalta con un anillo de acento.
- Cada tarjeta con vencimiento aparece como una pastilla en su día, con el punto de
  color de su primera etiqueta. **Al pulsarla se abre su modal** —el mismo de la vista
  de tablero—, así que se puede editar, completar checklist, etc., sin cambiar de vista.
- Las tarjetas **sin** fecha de vencimiento no aparecen; un aviso al pie indica cuántas
  hay.

## Diseño técnico

- Componente cliente `app/components/board/calendar-view.tsx`, renderizado por
  `BoardView` cuando la vista activa es `calendar`. La vista activa es estado local de
  cliente (`useState`), no va en la URL: cambiar de vista no recarga ni navega.
- Reutiliza el `selectedCardId` de `BoardView` para abrir el modal, de modo que el
  detalle de tarjeta y el tiempo real (`router.refresh()`) siguen funcionando igual.
- La rejilla es de 6 semanas (42 celdas) empezando en el **lunes** de la semana del día
  1 (locale español).
- **Sin desfases de zona horaria**: las tarjetas se indexan por la parte de fecha del
  `dueDate` (`YYYY-MM-DD`, vía `slice(0,10)`) y cada celda se compara con la misma clave
  local `YYYY-MM-DD`. No se usa la hora del `dueDate` (las fechas se eligen con un
  `<input type="date">`, así que representan un día, no un instante).

## Archivos

- `app/components/board/calendar-view.tsx` — la rejilla mensual.
- `app/components/board/board-view.tsx` — el conmutador y el render condicional.

## Reprogramar arrastrando (Hito 11)

Si tienes permiso de edición, puedes **arrastrar una tarjeta a otro día** para cambiar su
fecha de vencimiento. Usa `@dnd-kit` (chips arrastrables, celdas como zonas de soltar) y
una acción enfocada `setCardDueDate` que **solo** toca la fecha (no pisa la descripción).
El tablero se resincroniza por el tiempo real tras revalidar.

## Evolución posible

- Un calendario **global** que cruce todos los tableros del usuario (hoy es por tablero).
