# Registro de decisiones

Decisiones técnicas del proyecto, las más recientes arriba. Cada entrada lleva fecha,
contexto, decisión, alternativas descartadas y consecuencias. Las decisiones de
arquitectura anteriores a este registro (ADR 0001–0015) siguen en
[`docs/decisions/`](./decisions/); este archivo es el registro vivo a partir de
2026-09-24.

---

## 2026-09-24 — Collation "C" en las columnas de posición

**Contexto.** Las claves de fractional indexing (base62 `0-9A-Za-z`) solo se ordenan
bien byte a byte. `ORDER BY position` usaba la collation de la BD: en postgres alpine
(musl, la BD de desarrollo) es byte a byte, pero en glibc (imagen Debian del CI, Ubuntu,
servicios gestionados) `en_US.utf8` deja `Zz` después de `a0l`. Resultado: la tarjeta
arrastrada al principio reaparece al final al refrescar, y `createCard`/`createList`/
`addChecklist`/`addChecklistItem` (que buscan el último con `ORDER BY position DESC`)
generan claves repetidas. Pasa también solo con altas al final: tras `aZ` viene `aa`, que
esa collation ordena antes de `aB`…`aZ`, así que desde el elemento 38 se repite `aa`.

**Decisión.**
- Migración `20260924000000_position_collate_c` (creada con `migrate dev --create-only`
  y escrita a mano): `ALTER COLUMN "position" TYPE TEXT COLLATE "C"` en `List`, `Card`,
  `Checklist` y `ChecklistItem`. Reconstruye `Card_listId_position_idx`.
- Comentario en la migración y en `schema.prisma` (`List.position`), porque Prisma no
  modela la collation; `prisma migrate diff` no muestra deriva.
- ADR 0002 ampliado en «Consecuencias» (fuente única del porqué y de cómo detectar
  claves ya repetidas).
- Test `test/integration/position-collation.int.test.ts`: comprueba la collation de las
  cuatro columnas (falla sin el arreglo en cualquier servidor) y el orden/no repetición
  de tarjetas y listas con `a0`, `a0V`, `a0l`, `Zz`, y el de checklists e ítems con 37
  altas al final (`a0`…`aa`) (fallan sin el arreglo en BD glibc/ICU; verificado con una
  BD temporal ICU y con `ORDER BY ... COLLATE "en-US-x-icu"`).

**Alternativas descartadas.**
- Ordenar en JS o con `localeCompare`: dispersa la regla por todas las consultas y no
  arregla el `findFirst ... DESC` de las altas.
- Crear la BD con `LC_COLLATE=C`: no sirve para instalaciones existentes ni para BD
  gestionadas donde no se controla la creación.
- Reasignar en la migración las claves ya repetidas: toca datos de producción; queda
  como decisión del propietario, con copia previa (consulta de detección de las cuatro
  tablas en el ADR 0002).

**Consecuencias.** Toda columna de posición nueva debe crearse con `COLLATE "C"` a mano
en su migración. Las instalaciones glibc que ya tengan claves repetidas las conservan
hasta que se reasignen; el orden entre dos claves iguales sigue sin estar definido.

---
## 2026-09-24 — CSP fija para los .svg

**Contexto.** El matcher de `proxy.ts` excluye `.*\.svg$`, así que los SVG no reciben
la CSP con nonce, y `next.config.ts` solo ponía CSP a `/api/**`. Los SVG de `public/`
se servían sin `Content-Security-Policy`: abierto directamente, un SVG es un documento
que puede ejecutar scripts en el origen de la app.

**Decisión.** Regla `/:file(.*\\.svg)` en `headers()` de `next.config.ts` con
`default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'` (sus estilos en
línea funcionan; scripts, recursos externos y el embebido en marcos no).
`test/next-config.test.ts` resuelve las reglas con `buildCustomRoute` del router de Next
(el mismo compilador que usa en runtime) en vez de comparar prefijos, para entender los
parámetros con regex, y comprueba `/file.svg` e `/icons/logo.svg`.

**Alternativas descartadas.**
- Quitar la exclusión de `.svg` del matcher de `proxy.ts`: el proxy añadiría a cada SVG
  la CSP de página (con nonce) y el coste de ejecutarse en cada petición de imagen.
- Borrar los SVG de `public/` (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`,
  `window.svg`): son restos de la plantilla de Next y nada de `app/` los usa, pero
  borrarlos lo decide el propietario. La regla cubre también cualquier SVG futuro.

**Consecuencias.** Un SVG servido desde la app no puede cargar fuentes ni imágenes
externas ni ejecutar scripts cuando se abre directamente. Cargado con `<img>` un SVG
nunca ejecuta scripts y su CSP no interviene, así que no afecta a su uso normal.

## 2026-09-24 — Timeout del pool de pg y singleton de Prisma también en producción

**Contexto.** `PrismaPg` creaba el `pg.Pool` con los valores por defecto:
`connectionTimeoutMillis: 0`, así que con el pool agotado (10 conexiones) la petición
siguiente esperaba para siempre; Prisma 7 ya no aplica el `connect_timeout` de 5 s de
Prisma 6. Además, el cliente solo se guardaba en `globalThis` fuera de producción, y
Turbopack evalúa el módulo una vez por capa (route handlers y RSC/SSR): dos pools.

**Decisión.**
- `buildPoolConfig()` exportada en `app/lib/prisma.ts`: `connectionTimeoutMillis`
  5 s e `idleTimeoutMillis` 10 s (el valor por defecto de pg-pool, explícito para que
  no cambie sin querer). `onPoolError` registra solo el mensaje del error (nunca la
  cadena de conexión). El adapter ya escuchaba el evento `error` del pool, así que el
  proceso no se caía: el manejador sirve para que el fallo de una conexión inactiva
  quede en el log y no solo en el de depuración del adapter.
- `globalForPrisma.prisma = prisma` siempre, como `bus.ts` y `rate-limit.ts`.
- `test/integration/prisma-pool.int.test.ts`: el cliente exportado se crea con
  `buildPoolConfig()` y `onPoolError` (se envuelve `PrismaPg` con `vi.doMock`); con
  `max: 1` y 200 ms, una consulta mientras una transacción ocupa la conexión falla por
  timeout; en producción dos evaluaciones del módulo devuelven el mismo cliente.

**Alternativas descartadas.**
- `max` configurable por variable de entorno: no hace falta todavía.
- `statement_timeout`: cortaría exportaciones o importaciones grandes sin un valor
  medido.
- `idleTimeoutMillis` de 30 s: no hay medida que justifique mantener abiertas las
  conexiones inactivas más tiempo que el valor de pg.
- Probar el timeout con los 5 s reales: cada ejecución de la suite tardaría 5 s más; el
  cableado ya lo comprueba el test del cliente exportado.

**Consecuencias.** Con el pool saturado, una petición falla a los 5 s con un error de
timeout en vez de colgarse. Un solo pool por proceso.

## 2026-09-24 — Títulos por página y login sin mención a la licencia

**Contexto.** Todas las rutas tenían el mismo `<title>` «orgtable» (WCAG 2.4.2). Además,
la pantalla de login («Open source · AGPL-3.0», «open-source y self-hosted») y la meta
description decían que la app es open source con AGPL, pero la licencia vigente es la
propietaria de `LICENSE` (decisión del propietario, commit 27c1ba9).

**Decisión.**
- `app/layout.tsx`: `title: { template: "%s · orgtable", default: "orgtable" }`.
  `/login` exporta «Iniciar sesión» y `/setup` «Configuración inicial»; el resto de
  páginas las cubren otros lotes.
- Meta description: «Tableros Kanban self-hosted, una alternativa a Trello».
- Login: el párrafo dice «Tableros Kanban self-hosted…» y el pie pasa a «Kanban ·
  Self-hosted», sin mencionar licencia.
- `test/metadata.test.ts` comprueba los títulos resueltos, la description y que el HTML
  del login no diga open source ni AGPL.

**Alternativas descartadas.**
- Quitar el pie del panel de marca: cambiaba la composición (`justify-between` con tres
  bloques).
- Poner un aviso de copyright en el pie: el texto legal lo aporta el propietario.

**Consecuencias.** Cada página nueva debe exportar su `title`; sin él hereda «orgtable».

## 2026-09-24 — Límite de 11 MB para el cuerpo de las Server Actions

**Contexto.** Next 16 corta el cuerpo de una Server Action en 1 MB antes de ejecutarla.
`uploadAttachment` admite 10 MB (`MAX_ATTACHMENT_BYTES`) e `importBoard` 5 MB, así que
cualquier adjunto o importación de más de 1 MB fallaba con un error genérico. Además,
`proxy.ts` pasa por las rutas de página y Next solo guarda 10 MB de su cuerpo: lo que
exceda llega truncado a la acción, sin error.

**Decisión.** `experimental.serverActions.bodySizeLimit` y
`experimental.proxyClientMaxBodySize` a 11 MB (en bytes) en `next.config.ts`. El
megabyte extra cubre la sobrecarga de multipart y deja que un archivo algo mayor de
10 MB llegue a la acción y reciba su mensaje propio en vez de un 413.
`test/next-config.test.ts` comprueba que el límite supera `MAX_ATTACHMENT_BYTES` más la
sobrecarga y que el del proxy coincide.

**Alternativas descartadas.**
- Subir los adjuntos por un route handler en `/api` que autentique antes de leer el
  cuerpo: es la solución de fondo, pero cambia la arquitectura de la subida; la decide
  el propietario (anotada en el backlog de `docs/security.md`).
- Importar `MAX_ATTACHMENT_BYTES` en `next.config.ts`: `storage.ts` es `server-only` y
  arrastra `node:fs`; se deja el número con comentario y lo vigila el test.

**Consecuencias.** El límite es global y se aplica antes de autenticar: cualquiera puede
mandar 11 MB a una acción. Si cambia el máximo de adjuntos hay que subir este número (el
test falla si se queda corto).
## 2026-09-24 — Borrado de tableros con segundo clic y solo para el dueño

**Contexto.** En `/boards`, el ✕ de cada tablero era un `<form action={deleteBoard}>`
de un solo clic que borraba en cascada listas, tarjetas y adjuntos. Tenía `opacity-0`
y solo aparecía al pasar el ratón, así que en táctil era invisible pero un toque en la
esquina lo disparaba. Además se pintaba en tableros donde el usuario era solo miembro,
y ahí `deleteBoard` no hacía nada ni avisaba.

**Decisión.**
- Componente cliente `app/(app)/boards/delete-board-button.tsx`: el ✕ es un
  `type="button"` que cambia a «¿Borrar? Sí / No» en línea; solo «Sí» envía el
  formulario. El foco va a «No» y Escape cancela.
- Se pinta solo si `board.ownerId === user.id`, la misma regla que aplica
  `deleteBoard` en el servidor.
- Exportar y borrar se ven siempre en pantallas sin hover
  (`[@media(hover:none)]:opacity-100`) y al llegar con el teclado
  (`group-focus-within`).

**Alternativas descartadas.**
- `window.confirm` (el patrón de `user-row-actions.tsx`): no se puede estilar ni
  traducir el botón, y la norma del proyecto pide confirmación en línea.
- Mostrar el ✕ a los miembros con un aviso de error: ofrecería una acción imposible.

**Consecuencias.** Un tablero ya no se puede perder con un toque. Las acciones de
esquina ocupan sitio fijo en móvil. El comportamiento del segundo clic no tiene test de
interacción (no hay jsdom ni e2e); `test/delete-board-button.test.ts` comprueba que el
estado inicial no puede enviar nada.

## 2026-09-24 — Content-Security-Policy con nonce y HSTS

**Contexto.** La norma de seguridad exige CSP, HSTS, X-Content-Type-Options y
Referrer-Policy. Solo había las dos últimas (más `X-Frame-Options` y
`Permissions-Policy`, que además incluía `interest-cohort`, una directiva que los
navegadores ya no reconocen y que ensuciaba la consola).

**Decisión.**
- CSP generada en `proxy.ts` con un nonce aleatorio por petición (`app/lib/csp.ts`,
  patrón de la guía de CSP de Next 16). Todas las páginas ya eran dinámicas (sesión),
  así que el nonce no cambia el renderizado.
- `style-src-attr 'unsafe-inline'`: React pinta atributos `style` desde el servidor
  (fondo del tablero, dnd-kit) y el nonce no cubre atributos. Los `<style>` sí exigen
  nonce en producción.
- En desarrollo, `'unsafe-eval'` y estilos inline sin nonce (Turbopack y el overlay
  inyectan `<style>` sin él).
- `/api/**` recibe `default-src 'none'; frame-ancestors 'none'` desde `next.config.ts`.
- HSTS `max-age=31536000` sin `includeSubDomains` ni `preload`.
- Se quita `interest-cohort` de `Permissions-Policy`.

**Alternativas descartadas.**
- CSP estática con `'unsafe-inline'` en scripts: no protege contra XSS.
- Hashes en lugar de nonce: los scripts de hidratación de Next cambian en cada
  respuesta.
- `upgrade-insecure-requests`: rompe las instalaciones por `http://IP:3000`, que es
  como se documenta el primer arranque.
- HSTS con `includeSubDomains`/`preload`: impondría HTTPS a dominios hermanos del
  instalador.

**Consecuencias.** Verificado con Playwright contra `pnpm build && pnpm start`: cero
violaciones de CSP en tablero, calendario, ajustes, administración y búsqueda; el script
del tema se ejecuta (clase `dark` aplicada) y el tiempo real por SSE sigue funcionando.
Cualquier script de terceros futuro necesitará el nonce (`x-nonce`).

---

## 2026-09-24 — Tablero: doble envío, hidratación y arrastre con teclado

**Contexto.** Probando en el navegador se crearon dos listas iguales con 48 ms de
diferencia (Enter repetido), la consola mostraba un error de hidratación de dnd-kit
(`aria-describedby` distinto entre servidor y cliente) y las tarjetas solo se podían
mover con el ratón.

**Decisión.**
- `AddListForm`/`AddCardForm`: una ref `pending` descarta los envíos mientras la acción
  anterior no ha terminado (`preventDefault` en `onSubmit`; React no lanza la acción
  de un formulario cuyo evento está cancelado).
- `DndContext` recibe `id={useId()}`, estable entre servidor y cliente.
- Se añade `KeyboardSensor` con `sortableKeyboardCoordinates`.

**Alternativas descartadas.**
- `useActionState`/`useFormStatus` para deshabilitar el campo: el estado pendiente
  llega en el siguiente render y un segundo Enter en el mismo tick se cuela; además,
  deshabilitar el input le quita el foco.
- Deduplicar en el servidor por título: dos listas con el mismo nombre son legítimas.

**Consecuencias.** Verificado con Playwright: tres Enter seguidos crean una sola lista y
la consola queda sin errores. Con teclado: Tab hasta una tarjeta, Espacio para cogerla,
flechas para moverla y Espacio para soltarla (Escape cancela).

---

## 2026-09-24 — Interfaz: móvil a 375 px y contraste del conmutador

**Contexto.** A 375 px todas las páginas del área autenticada desbordaban 76 px en
horizontal (la barra superior no cabía) y la cabecera del tablero dejaba «Miembros»
fuera de pantalla. En modo oscuro la opción activa del conmutador Tablero/Calendario
era texto claro sobre fondo blanco. El fondo del tablero no llegaba al final de la
pantalla y el calendario mostraba «Septiembre De 2026».

**Decisión.**
- Barra superior: en móvil «Administración» pasa a icono con `aria-label`, el nombre de
  la instancia se trunca y los huecos se reducen.
- Cabecera del tablero con `flex-wrap`.
- La opción activa usa `bg-surface text-ink` (tokens del tema) en lugar de blanco fijo.
- El contenedor del área autenticada usa `flex-1` (el `min-h-full` no se resolvía
  dentro del `body` flex).
- El mes del calendario usa `first-letter:uppercase` en vez de `capitalize`, que ponía
  en mayúscula cada palabra.

**Alternativas descartadas.** Un menú hamburguesa en móvil: con pasar a iconos basta
y no añade un componente nuevo.

**Consecuencias.** Verificado con Playwright a 375 px (desbordamiento 0 en `/boards`,
tablero, `/settings`, `/admin/users`, `/admin/audit` y `/search`) y a 1440 px en modo
oscuro.

---

## 2026-09-24 — Actualización de dependencias por seguridad

**Contexto.** Tras pasar a pnpm, `pnpm audit` daba 63 avisos (2 críticos y 30 altos),
la mayoría en `next` 16.2.7 y en dependencias transitivas de Prisma, ESLint y Vitest.

**Decisión.**
- Subir todo dentro de su versión mayor: `next`/`eslint-config-next` 16.3.6, Prisma
  7.10.0, React 19.3.0, zod 4.6.5, pg 8.23.0, jose 6.2.12, Tailwind 4.3.3, Vitest
  4.1.11 y tipos. Los rangos de `package.json` pasan a exigir esas versiones mínimas.
- `overrides` en `pnpm-workspace.yaml` para transitivas con parche en la misma mayor:
  `brace-expansion` 5.0.12, `browserslist` 4.28.7 y `mysql2` 3.23.1.
- Se ignora `GHSA-ggr8-5vv4-36mx` (`deepmerge-ts` <8 dentro de `@prisma/config`): solo
  fusiona la configuración local de `prisma.config.ts`, no entrada de usuario, y el
  parche exige una versión mayor que Prisma 7.10 no admite.

**Alternativas descartadas.**
- Subidas mayores (TypeScript 7, ESLint 10, Vitest 5, Prisma 8, `@types/node` 26,
  `fractional-indexing` 4): van en commits aparte y tras leer sus changelogs; no
  corrigen ninguno de los avisos.
- Forzar `deepmerge-ts` 8 con un override: cambiaría una mayor dentro del CLI que
  aplica las migraciones en cada arranque del contenedor, para un riesgo sin vector
  de ataque real.

**Consecuencias.** `pnpm audit` queda sin avisos (1 ignorado y documentado). Al subir
`next`, `prisma` o `eslint-config-next` hay que revisar si los overrides siguen
haciendo falta.

---

## 2026-09-24 — Migración de npm a pnpm

**Contexto.** El estándar de los proyectos pasa a ser pnpm (lockfile siempre versionado,
nunca `package-lock.json`). El repo usaba npm en local, en CI y en el `Dockerfile`.

**Decisión.**
- `pnpm import` generó `pnpm-lock.yaml` a partir de `package-lock.json`, así que las
  versiones resueltas no cambian en este paso. `package-lock.json` se borra.
- `packageManager: pnpm@11.24.0` en `package.json`: Corepack (Docker) y
  `pnpm/action-setup` (CI) instalan exactamente esa versión.
- pnpm 11 no ejecuta scripts de instalación salvo los permitidos. `pnpm-workspace.yaml`
  lleva `allowBuilds` con `@prisma/engines` y `prisma` en `true` (descargan el
  schema-engine que usa `migrate deploy`) y `sharp` y `unrs-resolver` en `false` (traen
  binarios precompilados por dependencias opcionales; su script solo es un respaldo).
- CI pasa a Node 22 (igual que la imagen Docker) y añade `pnpm audit --prod
  --audit-level high`.
- El `Dockerfile` añade un stage `base` con `corepack enable`; el resto de stages no
  cambia de estructura.

**Alternativas descartadas.**
- `node-linker=hoisted` para imitar el árbol plano de npm: no hizo falta; el build
  standalone y el CLI de Prisma funcionan con el layout aislado de pnpm.
- Instalar pnpm con `npm i -g` en la imagen: Corepack ya viene en `node:22` y respeta
  la versión fijada.
- Aprobar todos los scripts de build (`--all`): amplía la superficie de ataque de la
  cadena de suministro sin necesidad.

**Consecuencias.** Hay que usar `pnpm` en lugar de `npm`/`npx` (documentación
actualizada). Una dependencia nueva con script de instalación necesita entrar en
`allowBuilds` o pnpm avisará con `ERR_PNPM_IGNORED_BUILDS`.
