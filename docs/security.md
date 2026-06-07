# Seguridad

Este documento resume la **postura de seguridad** de orgtable y el resultado de la
auditoría realizada sobre los hitos 0–11. Es self-hosted: el modelo de amenazas asume una
instancia tras un reverse proxy con TLS, con cuentas creadas por el administrador (no hay
registro abierto).

## Metodología de la auditoría

- **`npm audit`** sobre las dependencias.
- **Auditoría adversarial multi-agente**: 7 revisores en paralelo, uno por superficie de
  ataque (autenticación/sesiones, autorización/IDOR, inyección, XSS/salida, subida de
  ficheros, secretos/SSRF, hardening web), leyendo el **código real**. Cada hallazgo pasó
  por un **escéptico** que intentó refutarlo contra el código (84 agentes en total). De 78
  hallazgos en bruto: **13 confirmados, 64 refutados**.
- **Revisión manual** de los puntos de mayor valor (cookies, cabeceras, descarga de
  adjuntos, SQL crudo).

## Dependencias (`npm audit`)

- **Resuelto el único HIGH**: `next` 16.2.4 → **16.2.7** (DoS por Server Components, bypass
  de middleware/proxy, XSS, SSRF, cache poisoning). Tras la actualización: **0 high, 0
  critical**.
- Las **6 moderate** restantes son **transitivas de herramientas de build/desarrollo**
  (`@prisma/dev` → `@hono/node-server`, eslint → `brace-expansion`, next → `postcss`), no
  alcanzables en el runtime de producción. Se revisan en cada actualización de deps.

## Hallazgos confirmados y su estado

| Severidad | Hallazgo | Estado |
|-----------|----------|--------|
| **Alta** | **IDOR en `moveCard`**: solo validaba el tablero de DESTINO, no el de ORIGEN. Un editor podía mover a su tablero una tarjeta de otro al que no tiene acceso, conociendo su id. | **Corregido**: `moveCard` exige `cardBelongsToBoard(cardId, destino)` (la tarjeta debe estar ya en el tablero de destino; no se mueven tarjetas entre tableros). Test de regresión en `security.int.test.ts`. |
| Media (op.) | `SESSION_SECRET` sin definir degradaba a clave vacía/predecible (sesiones forjables). | **Corregido**: se exige `SESSION_SECRET` (≥16 chars) al firmar/verificar; falla ruidosamente. |
| Media (op.) | `DATABASE_URL` sin validar: el adapter caería a los defaults de libpq y conectaría a una BD no deseada. | **Corregido**: `createPrismaClient` lanza si falta (salvo en `next build`). |
| Baja | Faltaban cabeceras de seguridad (clickjacking, sniffing). | **Corregido**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` en `next.config.ts`. |
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

## Recomendaciones futuras (backlog)

- **CSP con nonce**: añadir una Content-Security-Policy estricta (requiere nonce para los
  scripts inline de Next; trabajo aparte).
- **Guard del último admin**: impedir borrar/degradar al último ADMIN de la instancia.
- **Endpoint de reset del setup** (admin) en vez de SQL manual.
- Email/Web Push y preferencias (ya en el backlog del roadmap).

## Reproducir la auditoría

```bash
npm audit                 # dependencias
npm run lint && npm run typecheck
npm test && npm run test:integration   # incluye tests de autorización (IDOR, 403/404)
```

La auditoría adversarial multi-agente se relanza con el workflow `orgtable-security-audit`.

## Reportar una vulnerabilidad

Ver [`SECURITY.md`](../SECURITY.md) en la raíz del repositorio.
