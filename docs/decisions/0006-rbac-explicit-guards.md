# ADR 0006 — Autorización por rol con guardas explícitas

**Estado:** aceptada · **Fecha:** 2026-06-05

## Contexto

El Hito 3 (multiusuario) introduce roles por tablero (`OWNER`/`EDITOR`/`VIEWER`) y un
rol global (`ADMIN`/`MEMBER`). Hay que decidir **cómo se aplica** la autorización en
las Server Actions y las páginas.

Next.js 16 ofrece las funciones `forbidden()` y `unauthorized()`, que lanzan una
interrupción y renderizan una página 403/401. Son cómodas, pero **experimentales**:
requieren activar `experimental.authInterrupts` en `next.config.ts`.

## Decisión

Usar **guardas explícitas** con ayudantes puros, no las APIs experimentales:

```ts
const { role } = await requireBoardAccess(boardId);
if (!canEditBoard(role)) return;          // acción de formulario → no-op
if (!canEditBoard(role)) return { ok: false }; // acción de drag & drop → revertir
```

La jerarquía de roles vive en `app/lib/roles.ts` (`canEditBoard`, `canManageBoard`),
compartida entre servidor y cliente.

## Justificación

- **Sin dependencias experimentales**: `authInterrupts` puede cambiar o requerir
  ficheros `forbidden.tsx`. Las guardas explícitas son estándar y estables.
- **Coherencia con el código existente**: las acciones ya "fallan en silencio"
  cuando la entrada no valida (`if (!parsed.success) return;`). El control de rol
  sigue el mismo patrón.
- **UI optimista**: las acciones de drag & drop devuelven `{ ok: false }` en vez de
  lanzar; el cliente puede revertir su estado sin un overlay de error.
- **Defensa en profundidad**: la UI oculta los controles según el rol
  (`board-perms.tsx`), pero la barrera real es la guarda del servidor, que se ejecuta
  siempre.

## Consecuencias

- Cada Server Action mutadora añade una línea de guarda. Es repetitivo pero explícito
  y fácil de auditar.
- Las páginas de administración protegen con `requireAdmin()` (redirige a `/boards`),
  no con `forbidden()`.
- Si en el futuro `authInterrupts` se estabiliza, se podría migrar a `forbidden()`
  para mostrar páginas 403 propias sin cambiar el modelo de permisos.
