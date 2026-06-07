# API pública (REST v1)

orgtable expone una API REST bajo `/api/v1` para automatizar tableros desde scripts u
otras aplicaciones (Hito 9). La decisión de diseño está en
[ADR 0013](../decisions/0013-api-tokens.md).

## Autenticación

Las peticiones se autentican con un **token de acceso personal** en la cabecera
`Authorization`:

```
Authorization: Bearer orgt_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

- Crea y revoca tus tokens en **Ajustes** (`/settings`). El token completo se muestra
  **una sola vez**; guárdalo bien. En la base de datos solo vive su hash SHA-256.
- Un token actúa **como tú**: tiene tu mismo acceso a los tableros (mismo rol). El
  servidor vuelve a comprobar el rol del tablero en cada petición.
- **Alcance (scope)**: al crear el token eliges **Lectura y escritura** o **Solo lectura**.
  Un token de solo lectura puede hacer `GET` pero recibe `403` en cualquier `POST`/`PATCH`/
  `DELETE`.
- **Caducidad**: opcionalmente el token caduca (30/90/365 días). Un token caducado se
  rechaza con `401` (no se borra; lo verás marcado «Caducado» en Ajustes).
- Revocar un token (borrarlo en Ajustes) lo invalida al instante.

## Convenciones

- Cuerpos y respuestas en **JSON** (`Content-Type: application/json`).
- Las fechas se devuelven en **ISO 8601** (UTC).
- Errores con la forma `{ "error": "mensaje" }` y un código HTTP adecuado:

| Código | Significado |
|--------|-------------|
| `401` | Token ausente o no válido |
| `403` | Autenticado, pero sin permiso (p. ej. editar siendo lector) |
| `404` | No existe **o** no tienes acceso (no se revela cuál) |
| `422` | Cuerpo no válido (validación) |

> Que un recurso ajeno devuelva `404` (y no `403`) es intencionado: la API no revela la
> existencia de tableros a los que no perteneces.

## Endpoints

### Tableros

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/v1/boards` | miembro | Tus tableros (resumen) |
| `POST` | `/api/v1/boards` | — | Crea un tablero (quedas como propietario) |
| `GET` | `/api/v1/boards/:id` | miembro | El tablero con sus listas y tarjetas |
| `PATCH` | `/api/v1/boards/:id` | propietario | Renombra el tablero |
| `DELETE` | `/api/v1/boards/:id` | propietario | Borra el tablero |

### Listas

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/v1/boards/:id/lists` | miembro | Listas del tablero, en orden |
| `POST` | `/api/v1/boards/:id/lists` | editor | Crea una lista al final |

### Tarjetas

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| `GET` | `/api/v1/lists/:id/cards` | miembro | Tarjetas de la lista, en orden |
| `POST` | `/api/v1/lists/:id/cards` | editor | Crea una tarjeta al final |
| `GET` | `/api/v1/cards/:id` | miembro | Detalle de una tarjeta |
| `PATCH` | `/api/v1/cards/:id` | editor | Actualiza título, descripción o vencimiento |
| `DELETE` | `/api/v1/cards/:id` | editor | Borra la tarjeta |

**Cuerpos:**

- Crear tablero / lista: `{ "title": "…" }`.
- Crear tarjeta: `{ "title": "…", "description"?: string|null, "dueDate"?: "YYYY-MM-DD"|null }`.
- Actualizar tarjeta (`PATCH`): cualquiera de `title`, `description`, `dueDate` (al menos
  uno).

## Ejemplos

```bash
TOKEN="orgt_…"
BASE="https://tu-instancia/api/v1"

# Listar tableros
curl -H "Authorization: Bearer $TOKEN" "$BASE/boards"

# Crear un tablero
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Sprint 12"}' "$BASE/boards"

# Crear una lista en un tablero
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"En progreso"}' "$BASE/boards/<boardId>/lists"

# Crear una tarjeta con vencimiento
curl -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Revisar PR","dueDate":"2026-07-01"}' "$BASE/lists/<listId>/cards"

# Editar una tarjeta
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"title":"Revisado","dueDate":null}' "$BASE/cards/<cardId>"
```

## Tiempo real

Las mutaciones por API publican los mismos eventos que las de la interfaz, así que los
navegadores con el tablero abierto ven los cambios en vivo (ver
[docs/realtime.md](../realtime.md)).

## Implementación

- Autenticación y autorización: `app/lib/api/auth.ts` (Bearer → usuario, rol por tablero).
- Generación/hash de tokens: `app/lib/api/tokens.ts`. Respuestas: `app/lib/api/respond.ts`.
- Serialización JSON: `app/lib/api/serialize.ts`.
- Rutas: `app/api/v1/**`. Gestión de tokens: `/settings` (`app/(app)/settings`).

## Límites y evolución

- Los tokens soportan **scope** (solo lectura) y **caducidad** (Hito 13); aún no hay scope
  por tablero.
- La superficie cubre tableros, listas y tarjetas; checklists, etiquetas, adjuntos y
  miembros quedan como ampliación (backlog). Añadir un recurso es un route handler más que
  reutiliza `authenticateApiToken` + `apiBoardRole` + `isReadOnly`.
- **Rate limiting** de la API y una referencia **OpenAPI** quedan en el backlog.
