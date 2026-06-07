# Colaboración en la tarjeta: asignados y comentarios

El Hito 10 permite **asignar miembros** a una tarjeta y **comentar** en ella. La decisión
de diseño está en [ADR 0014](./decisions/0014-card-collaboration.md).

## Asignados

- En el modal de tarjeta, la sección **Asignados** muestra quién la tiene asignada
  (avatares con la inicial) y, para quien puede editar, una lista de miembros del tablero
  para asignar con un clic. Se puede quitar a un asignado con la ✕.
- En la cara de la tarjeta (en el tablero) aparecen los avatares de los asignados, así que
  se ve de un vistazo quién la lleva.
- **Solo se puede asignar a miembros del tablero**: el servidor lo verifica
  (`assignMemberToCard` en `app/lib/services/assignees.ts`). Asignar/quitar requiere
  permiso de edición.
- Al asignar a otra persona se le envía una notificación `card.assigned`
  ([docs/notifications.md](./notifications.md)).

## Comentarios

- La sección **Comentarios** del modal es un hilo plano: cada comentario muestra autor,
  fecha y texto. Comentar requiere permiso de edición (los lectores no comentan).
- **Borrar** un comentario lo puede hacer su **autor** o el **propietario** del tablero.
- Al comentar, los **asignados** de la tarjeta (menos el autor) reciben una notificación
  `comment.added`.

## Archivos

- Modelos `CardAssignee` y `Comment` en `prisma/schema.prisma` (migración
  `…_card_collaboration`).
- Servicios testeables: `app/lib/services/assignees.ts` (`assignMemberToCard`),
  `app/lib/services/cards.ts` (`cardContext`).
- Server Actions: `app/lib/actions/assignees.ts`, `app/lib/actions/comments.ts`.
- UI: secciones en `app/components/card/card-modal.tsx`; avatares en
  `app/components/board/card-item.tsx`.
- DTO y lectura: `app/lib/types.ts` (`AssigneeDTO`, `CommentDTO`), `getBoardWithLists` en
  `app/lib/queries.ts`. La API los expone en las respuestas de tarjeta
  (`app/lib/api/serialize.ts`).
- Tests: `test/integration/collaboration.int.test.ts`.

## Límites y evolución

- Hilo plano, sin respuestas anidadas ni reacciones (reacciones están en el backlog).
- Crear/borrar comentarios y asignaciones **por la API** queda como ampliación (hoy la API
  los expone en lectura; la interfaz cubre la escritura).
- @menciones que notifiquen a un usuario concreto: ampliación natural del parseo del texto.
