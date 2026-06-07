# ADR 0014 — Modelo de colaboración en la tarjeta (asignados y comentarios)

**Estado:** aceptada · **Fecha:** 2026-06-07 · **Relacionada:** [ADR 0006](./0006-rbac-explicit-guards.md), [ADR 0012](./0012-notifications.md)

## Contexto

El Hito 10 añade **asignar miembros** a una tarjeta y **comentarios**. Hay que decidir el
modelo de datos, quién puede hacer qué, y qué pasa al borrar.

## Decisión

- **Asignados**: tabla de unión `CardAssignee` (cardId, userId). Solo se puede asignar a
  quien **ya es miembro del tablero**; lo verifica el servidor (servicio
  `assignMemberToCard`, reutilizado por la Server Action). Asignar/quitar requiere permiso
  de **edición** (`canEditBoard`).
- **Comentarios**: modelo `Comment` (autor, texto, fecha), **hilo plano** sin anidación.
  Comentar requiere edición; **borrar** lo puede hacer el **autor o el propietario** del
  tablero.
- **Borrado en cascada**: tanto `CardAssignee` como `Comment` se borran con la tarjeta y
  con el usuario (`onDelete: Cascade`).
- **Notificaciones** reutilizando `notify()` ([ADR 0012](./0012-notifications.md)):
  `card.assigned` al asignar a otra persona; `comment.added` a los asignados de la tarjeta
  (menos al autor).

## Justificación

- **Asignar solo a miembros** evita un estado inconsistente (asignar a quien no ve el
  tablero) y mantiene al servidor como única autoridad
  ([ADR 0006](./0006-rbac-explicit-guards.md)). La lógica vive en un servicio testeable.
- **Hilo plano** cubre el 95% del caso (discusión breve en una tarjeta) sin la complejidad
  de árboles de respuestas; encaja con un clon de Trello.
- **Cascade en comentarios**: se prioriza la simplicidad y la coherencia del borrado de
  cuentas/tarjetas frente a preservar el historial con autor nulo. Si en el futuro se
  quisiera conservar la discusión al borrar una cuenta, se cambiaría `authorId` a
  `onDelete: SetNull` (nullable) y la UI mostraría "usuario eliminado".

## Consecuencias

- Un comentario desaparece si se borra su autor (un miembro). Aceptable: borrar cuentas es
  raro y está restringido (no se puede borrar a quien posee tableros).
- La API expone asignados y comentarios en las respuestas de tarjeta (lectura). Crear/
  borrar por API queda como ampliación; la interfaz ya lo cubre por completo.
- Los asignados y comentarios **no** se incluyen en el export/import de tableros (igual que
  los adjuntos): el export es una copia del contenido estructural del tablero.
- Documentado en [`docs/card-collaboration.md`](../card-collaboration.md).
