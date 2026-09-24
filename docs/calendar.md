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

- Mientras se arrastra, una copia de la pastilla (`DragOverlay`) sigue al puntero; la
  original se queda atenuada en su día (moverla con `transform` la recortaba el
  `overflow-y-auto` del calendario). La copia se pinta en un portal a `document.body`
  porque el panel lleva `backdrop-blur`, y un `backdrop-filter` crea un bloque contenedor
  que desplazaría la copia `position: fixed` respecto al puntero.
- **Teclado**: con el foco en una pastilla, Espacio la coge, las flechas la llevan al día
  vecino (izquierda/derecha) o a la misma columna de la semana anterior/siguiente
  (arriba/abajo), y Espacio o Intro la sueltan; Escape cancela. Intro sin arrastrar abre
  la tarjeta. Las coordenadas las calcula `calendarKeyboardCoordinates`
  (`app/lib/board-collision.ts`); anuncios para lectores de pantalla en español.
- Si el servidor no guarda la nueva fecha (rechazo o fallo de red), la tarjeta sigue en
  su día y aparece el aviso «No se pudo cambiar la fecha. Inténtalo de nuevo.» en su
  propia fila, bajo el mes y la navegación (`role="alert"`). Se borra al empezar otro
  arrastre.

## Evolución posible

- Un calendario **global** que cruce todos los tableros del usuario (hoy es por tablero).
