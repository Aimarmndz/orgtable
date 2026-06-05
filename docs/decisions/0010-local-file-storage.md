# ADR 0010 — Adjuntos en disco local (no S3)

**Estado:** aceptada · **Fecha:** 2026-06-05

## Contexto

El Hito 5 añade adjuntos en las tarjetas. ¿Dónde se guarda el binario? Las opciones
habituales son almacenamiento de objetos (S3 o compatible) o el disco local del
servidor.

## Decisión

Guardar los adjuntos en el **disco local**, en un directorio configurable
(`ORGTABLE_UPLOAD_DIR`) que en Docker es un volumen persistente. En la base de datos
solo se guardan los metadatos.

## Justificación

- **Self-hosted, sin dependencias de nube.** orgtable se instala con un comando y un
  `docker-compose` de dos servicios. Exigir una cuenta de S3 (o desplegar MinIO)
  rompería esa simplicidad y la promesa de "tus datos en tu servidor".
- **Un volumen ya es persistente y respaldable.** El volumen `uploads` se añade a la
  misma estrategia de backups que la base de datos (`docs/operations.md`).
- **El acceso debe ser autorizado igualmente.** Sea disco o S3, los adjuntos son
  privados y se sirven por un route handler que valida la membresía. El backend de
  almacenamiento no cambia ese diseño.

## Consecuencias

- El almacenamiento está acoplado al sistema de ficheros del contenedor de la app. En
  un despliegue **multi-instancia**, el volumen de uploads debe ser **compartido** entre
  réplicas (NFS, volumen de red...) o migrarse a almacenamiento de objetos.
- `app/lib/storage.ts` aísla las operaciones de fichero (`save`/`read`/`delete`), así
  que añadir un backend S3 en el futuro sería sustituir esa capa sin tocar las acciones
  ni el route handler.
- Límite de 10 MB por archivo para acotar el uso de disco; ajustable en
  `app/lib/storage.ts`.
