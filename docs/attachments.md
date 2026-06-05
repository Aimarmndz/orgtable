# Adjuntos en tarjetas

Cada tarjeta puede tener archivos adjuntos (hasta **10 MB** por archivo). El binario se
guarda en **disco**; en la base de datos solo viven los metadatos (nombre original,
nombre en disco, tipo MIME, tamaño).

## Almacenamiento

Los ficheros se guardan en el directorio que indique `ORGTABLE_UPLOAD_DIR`:

- **Producción (Docker):** `/data/uploads`, un **volumen persistente** (`uploads`)
  declarado en `docker-compose.yml`. Sobrevive a recreaciones del contenedor y se
  incluye en la estrategia de copias de seguridad (ver
  [`docs/operations.md`](./operations.md)).
- **Desarrollo local:** si no se define la variable, se usa `./uploads` (ignorado por
  git).

Cada archivo se guarda con un **nombre aleatorio** (`crypto.randomUUID()` + extensión
saneada). El nombre original que ve el usuario se conserva aparte en la base de datos.
Las rutas se construyen con `path.basename`, lo que neutraliza cualquier intento de
*path traversal*. La decisión de usar disco local (y no S3) está en
[ADR 0010](./decisions/0010-local-file-storage.md).

## Subida, descarga y borrado

| Operación | Quién | Cómo |
| --- | --- | --- |
| Subir | EDITOR / OWNER | Server Action `uploadAttachment` (recibe el `File` por `FormData`). Valida tamaño y guarda en disco. |
| Descargar | Cualquier miembro | Route Handler `GET /api/attachments/[id]`. |
| Borrar | EDITOR / OWNER | Server Action `deleteAttachment` (borra fila y fichero). |

Piezas:

- [`app/lib/storage.ts`](../app/lib/storage.ts) — guardar/leer/borrar en disco y el
  límite de tamaño.
- [`app/lib/actions/attachments.ts`](../app/lib/actions/attachments.ts) — Server Actions
  con autorización por rol.
- [`app/api/attachments/[id]/route.ts`](../app/api/attachments/[id]/route.ts) — descarga
  con autorización.
- El modal de tarjeta (`card-modal.tsx`) muestra la lista, el botón de subir (editores)
  y el de borrar; la tarjeta muestra un contador de adjuntos.

## Por qué la descarga pasa por un route handler

Los adjuntos son **privados**: solo los miembros del tablero deben poder verlos. Por eso
no se sirven desde `/public` (que sería accesible por URL sin autenticar), sino desde un
route handler que comprueba **sesión válida + membresía** antes de devolver el binario,
con `Content-Disposition: attachment` y `Cache-Control: private, no-store`.
