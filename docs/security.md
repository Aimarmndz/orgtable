# Seguridad

Este documento resume la **postura de seguridad** de orgtable y el resultado de la
auditoría realizada sobre los hitos 0–11. Es self-hosted: el modelo de amenazas asume una
instancia tras un reverse proxy con TLS, con cuentas creadas por el administrador (no hay
registro abierto).

## Metodología de la auditoría

- **`pnpm audit`** sobre las dependencias.
- **Auditoría adversarial multi-agente**: 7 revisores en paralelo, uno por superficie de
  ataque (autenticación/sesiones, autorización/IDOR, inyección, XSS/salida, subida de
  ficheros, secretos/SSRF, hardening web), leyendo el **código real**. Cada hallazgo pasó
  por un **escéptico** que intentó refutarlo contra el código (84 agentes en total). De 78
  hallazgos en bruto: **13 confirmados, 64 refutados**.
- **Revisión manual** de los puntos de mayor valor (cookies, cabeceras, descarga de
  adjuntos, SQL crudo).

## Dependencias (`pnpm audit`)

- **2026-09-24**: con la migración a pnpm, `pnpm audit` daba 63 avisos (2 críticos en
  `next` 16.2.7). Se subió todo dentro de su versión mayor (`next` 16.3.6, Prisma 7.10…)
  y se forzaron transitivas parcheadas con `overrides` en `pnpm-workspace.yaml`. Queda
  **0 avisos** y uno ignorado y justificado (`deepmerge-ts`, solo en el CLI de Prisma).
  El detalle y el porqué están en [`DECISIONES.md`](./DECISIONES.md).
- CI ejecuta `pnpm audit --prod --audit-level high` en cada push y PR.

## Hallazgos confirmados y su estado

| Severidad | Hallazgo | Estado |
|-----------|----------|--------|
| **Alta** | **IDOR en `moveCard`**: solo validaba el tablero de DESTINO, no el de ORIGEN. Un editor podía mover a su tablero una tarjeta de otro al que no tiene acceso, conociendo su id. | **Corregido**: `moveCard` exige `cardBelongsToBoard(cardId, destino)` (la tarjeta debe estar ya en el tablero de destino; no se mueven tarjetas entre tableros). Test de regresión en `security.int.test.ts`. |
| Media (op.) | `SESSION_SECRET` sin definir degradaba a clave vacía/predecible (sesiones forjables). | **Corregido**: se exige `SESSION_SECRET` (≥16 chars) al firmar/verificar; falla ruidosamente. |
| Media (op.) | `DATABASE_URL` sin validar: el adapter caería a los defaults de libpq y conectaría a una BD no deseada. | **Corregido**: `createPrismaClient` lanza si falta (salvo en `next build`). |
| Baja | Faltaban cabeceras de seguridad (clickjacking, sniffing, CSP, HSTS). | **Corregido**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` y HSTS en `next.config.ts`; CSP con nonce en `proxy.ts`. Tests en `test/csp.test.ts` y `test/next-config.test.ts`. |
| Baja | El 503 del cron revelaba "sin CRON_SECRET". | **Corregido**: mensaje genérico ("Servicio no disponible"). |
| Media (op.) | El wizard de setup queda **bloqueado para siempre**; sin reset por UI. | **Aceptado/documentado**: es un bloqueo intencionado; la recuperación es `UPDATE "InstanceConfig" SET "setupCompletedAt" = NULL` (ver `docs/setup-wizard.md`). |

Los demás hallazgos "confirmados" por el panel eran en realidad **controles correctos**
(ver abajo), no vulnerabilidades.

## Controles verificados (lo que ya está bien)

- **La autorización no depende del middleware**: `proxy.ts` solo hace un chequeo
  *optimista* (¿existe la cookie?); la autoridad real es el **DAL** (`verifySession` valida
  el JWT **y** la fila de sesión: existe, no revocada, no expirada) en cada página/acción.
  Esto **mitiga los bypass de middleware** de Next.
- **RBAC de dos capas**: cada mutación comprueba membresía (`requireBoardAccess`/
  `apiBoardRole`) **y** rol (`canEditBoard`/`canManageBoard`). Las lecturas se acotan por
  dueño-o-miembro en el `WHERE`.
- **Adjuntos**: descarga **autorizada por membresía** + `Content-Disposition: attachment`
  (fuerza la descarga, no el render → mitiga XSS almacenado por SVG/HTML); subir requiere
  editor; el nombre en disco es aleatorio (sin path traversal).
- **Inyección**: Prisma **parametriza** todas las consultas; el único SQL crudo
  (`pg_notify` del bus, `TRUNCATE` de los tests) usa **parámetros/constantes**, nunca input
  de usuario. La búsqueda usa `ILIKE` vía Prisma (parametrizada).
- **XSS**: React **escapa** el contenido de usuario (títulos, comentarios, notificaciones).
  El único `dangerouslySetInnerHTML` es el script de tema, una **constante** sin input.
- **Secretos**: contraseñas con **bcrypt** (coste 12); tokens de API guardados **hasheados**
  (SHA-256), mostrados una sola vez; el secreto del cron se compara en **tiempo constante**.
- **Sesiones**: cookie `httpOnly`, `secure` en producción, `sameSite=lax`, expiración;
  **revocación inmediata** (logout, reset de contraseña, cierre forzado).
- **Anti-mass-assignment**: todas las acciones validan con **zod** (whitelist de campos).
- **Login**: rate-limiting por IP + auditoría de intentos.
- **Cabeceras** (`next.config.ts` + `proxy.ts`):
  - Páginas: **CSP con nonce por petición** (`app/lib/csp.ts`): `script-src` solo propios
    con nonce y `'strict-dynamic'`, sin `eval` en producción, `frame-ancestors 'none'`,
    `object-src 'none'`, `base-uri`/`form-action 'self'`. El layout raíz lee el nonce de
    `x-nonce` para el script inline del tema.
  - `/api/**`: `default-src 'none'` (solo JSON, SSE y descargas).
  - `Strict-Transport-Security: max-age=31536000` (sin `includeSubDomains`),
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
    `Permissions-Policy`.
  - Sin `upgrade-insecure-requests`: rompería las instalaciones por `http://IP:3000`.
    El porqué de cada excepción está en [`DECISIONES.md`](./DECISIONES.md).
- **Tamaño de las peticiones a Server Actions**: `serverActions.bodySizeLimit` y
  `proxyClientMaxBodySize` en 11 MB (`next.config.ts`), justo por encima del máximo de un
  adjunto (10 MB). Límite conocido: es global y Next lo aplica **antes de autenticar**, así
  que cualquiera puede enviar hasta 11 MB a una acción; las acciones rechazan después lo
  que exceda sus límites propios.

## Recomendaciones futuras (backlog)

- **Guard del último admin**: impedir borrar/degradar al último ADMIN de la instancia.
- **Endpoint de reset del setup** (admin) en vez de SQL manual.
- Email/Web Push y preferencias (ya en el backlog del roadmap).
- **Subida de adjuntos por route handler** (`/api/...`) con autenticación antes de leer el
  cuerpo, para poder bajar el límite global de las Server Actions. Lo decide el
  propietario.

## Reproducir la auditoría

```bash
pnpm audit                 # dependencias
pnpm lint && pnpm typecheck
pnpm test && pnpm test:integration   # incluye tests de autorización (IDOR, 403/404)
```

La auditoría adversarial multi-agente se relanza con el workflow `orgtable-security-audit`.

## Reportar una vulnerabilidad

Ver [`SECURITY.md`](../SECURITY.md) en la raíz del repositorio.
