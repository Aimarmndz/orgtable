# Adjuntos en tarjetas

Cada tarjeta puede tener archivos adjuntos (hasta **10 MB** por archivo). El binario se
guarda en **disco**; en la base de datos solo viven los metadatos (nombre original,
nombre en disco, tipo MIME, tamaño).

El límite de 10 MB es `MAX_ATTACHMENT_BYTES` en `app/lib/storage.ts`. La subida viaja
en el cuerpo de una Server Action, cuyo tamaño máximo lo fija `serverActions.bodySizeLimit`
en `next.config.ts`: ese valor tiene que quedar algo por encima de los 10 MB (el
`FormData` añade cabeceras), o Next rechazará el archivo antes de llegar a la validación.

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

### Borrado en cascada y ficheros

Borrar una tarjeta, una lista o un tablero (desde la interfaz o con `DELETE` en la API
v1) borra en cascada sus filas `Attachment`, pero la base de datos no toca el disco. Por
eso esos borrados pasan por [`app/lib/services/attachments.ts`](../app/lib/services/attachments.ts):
lee los nombres en disco y borra en la base de datos dentro de una transacción y, **solo
después del commit**, borra los ficheros. Si la transacción falla, no se toca el disco.

Antes de leer, la transacción bloquea con `FOR UPDATE` las filas padre (tablero, sus
listas y sus tarjetas, según lo que se borre). Sin ese bloqueo, una subida que se
confirmara entre la lectura y el borrado desaparecía en cascada con su fichero fuera de
la lista: huérfano en disco y subida respondida como correcta. Con él, una subida en
curso termina antes de la lectura (su fichero se borra con los demás) y una posterior
falla por la clave ajena, así que `uploadAttachment` borra su fichero y relanza el
error.

`deleteAttachmentFile` nunca lanza: que el fichero ya no exista (`ENOENT`) es normal y
se ignora; cualquier otro error (permisos, volumen de solo lectura…) se registra con
`console.error` (`[storage] no se pudo borrar el adjunto`) porque deja un fichero
huérfano que hay que borrar a mano. Si falla el alta de la fila tras guardar el fichero
en una subida, el fichero se borra y el error se relanza.

Los ficheros que quedaron huérfanos antes de este cambio siguen en el volumen; no hay
barrido automático.

Piezas:

- [`app/lib/storage.ts`](../app/lib/storage.ts) — guardar/leer/borrar en disco y el
  límite de tamaño.
- [`app/lib/services/attachments.ts`](../app/lib/services/attachments.ts) — borrado de
  tarjetas, listas y tableros junto con sus ficheros.
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

Respuestas:

| Código | Cuándo |
| --- | --- |
| `200` | Miembro del tablero y el fichero está en disco. |
| `401` | Sin sesión válida. |
| `404` | El adjunto no existe **o** no eres miembro del tablero (mismo cuerpo en ambos casos, para no revelar qué ids existen, como la API v1). También si la fila existe pero el fichero no está en disco; esto se registra con `console.warn` porque indica una inconsistencia. |
| `500` | Cualquier otro error al leer el fichero (permisos, E/S del volumen); se registra con `console.error`. |
