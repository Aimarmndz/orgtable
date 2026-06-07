# ADR 0013 — API pública con tokens personales hasheados (Bearer)

**Estado:** aceptada · **Fecha:** 2026-06-07 · **Relacionada:** [ADR 0006](./0006-rbac-explicit-guards.md), [ADR 0008](./0008-session-store.md)

## Contexto

El Hito 9 abre una API REST (`/api/v1`) para usar orgtable desde scripts u otras
aplicaciones. Hay que decidir **cómo se autentica** esa API (sin cookies de navegador) y
**cómo se guardan** las credenciales.

## Decisión

- **Tokens de acceso personal** (PAT) que el usuario crea en `/settings`. La petición los
  envía en `Authorization: Bearer <token>`.
- **Nunca se guarda el token en claro**: solo su **hash SHA-256** (`ApiToken.tokenHash`,
  único) y un **prefijo** visible para identificarlo en la lista. El token completo se
  muestra **una sola vez** al crearlo.
- La API **reutiliza la autorización por rol** existente: resuelto el usuario por el
  token, cada endpoint vuelve a comprobar el rol del tablero contra `board_members`
  (igual que las Server Actions, [ADR 0006](./0006-rbac-explicit-guards.md)). Un token
  actúa **como su dueño**, con su mismo acceso, ni más ni menos.
- Las mutaciones de la API llaman a `revalidateBoard()`, así que los cambios hechos por
  la API también llegan en vivo a los navegadores conectados (tiempo real del Hito 4).

## Justificación

- **SHA-256 sin sal es suficiente para un token de alta entropía.** El token son 24 bytes
  aleatorios (no una contraseña humana), así que no hay ataque de diccionario que mitigar
  con bcrypt/argon2; un hash rápido permite además resolverlo en un único `findUnique` por
  el hash. (Las contraseñas de usuario sí usan bcrypt: ahí el riesgo es distinto.)
- **Coherencia con el modelo de revocación** ([ADR 0008](./0008-session-store.md)):
  revocar es borrar la fila; el token deja de funcionar al instante.
- **Reutilizar la autorización** evita una segunda fuente de verdad de permisos: el
  servidor sigue siendo la única autoridad y no hay forma de que la API conceda más de lo
  que concede la UI.
- **Cero dependencias nuevas**: `node:crypto` ya está disponible.

## Consecuencias

- Sin OAuth ni scopes por token: un token tiene todo el acceso del usuario. Si en el
  futuro hicieran falta permisos más finos (solo lectura, un tablero concreto), se
  añadirían columnas a `ApiToken` y un chequeo extra, sin cambiar el modelo de
  autenticación.
- `lastUsedAt` se actualiza en cada petición (best-effort); es una escritura barata y útil
  para que el usuario detecte tokens en uso o en desuso.
- La superficie inicial cubre tableros, listas y tarjetas (CRUD esencial); checklists,
  etiquetas y adjuntos quedan como ampliación natural.
- Documentado en [`docs/api/public-api.md`](../api/public-api.md).
