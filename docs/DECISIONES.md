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
## 2026-09-24 — Devolver el foco al ✕ al cancelar el borrado de un tablero

**Contexto.** Al cancelar «¿Borrar? Sí / No» (con «No» o con Escape) el formulario se
desmontaba con el foco dentro y el ✕ se volvía a pintar sin él: el foco caía al
`<body>` y quien usa teclado o lector de pantalla perdía su sitio en la rejilla de
`/boards`. Además el ✕ quedaba invisible (`opacity-0`), porque ya no había foco dentro
de la tarjeta.

**Decisión.** `DeleteBoardButton` guarda una ref al ✕ y un indicador `restoreFocus`
que solo pone a `true` la cancelación; un `useEffect` sobre `confirming` lo consume y
llama a `focus()`. El segundo clic («Sí» envía) no cambia.

**Alternativas descartadas.**
- `autoFocus` en el ✕: todos los tableros de la rejilla lo llevarían y el último
  robaría el foco al cargar la página.
- Dejar el ✕ montado y ocultar la confirmación con CSS: cambia la maquetación de la
  esquina y seguiría haciendo falta mover el foco a mano.

**Consecuencias.** Tras cancelar, el foco vuelve al ✕ y `group-focus-within` lo
mantiene visible. `test/delete-board-button-focus.test.ts` lo cubre con un arnés local
de hooks (sin jsdom): falla con la versión anterior y comprueba que el montaje inicial
no roba el foco. No se ha probado en navegador ni con lector de pantalla.

## 2026-09-24 — Título por página en /boards, /board/[id] y /search

**Contexto.** Todas las rutas compartían el `<title>` «orgtable», así que las pestañas
y el historial no se distinguían. La plantilla raíz (`%s · …`) es del lote de la
maquetación raíz; aquí solo van los títulos de estas páginas.

**Decisión.**
- `export const metadata` con «Tus tableros» en `/boards` y «Búsqueda» en `/search`.
  La consulta de búsqueda no va en el título: acabaría en el historial y en las
  pestañas.
- `/board/[id]` usa `generateMetadata`, que lee el nombre con `getBoardTitleForUser`
  (`app/lib/queries.ts`, envuelta en `React.cache`). Comparte con `getBoardWithLists`
  el filtro `boardAccessWhere` (dueño o miembro), la misma guarda que la página. Sin
  acceso o si el tablero no existe, título genérico «Tablero».

**Alternativas descartadas.**
- Leer el título con `prisma.board.findUnique` sin filtro: el `<title>` se resuelve
  aparte de la página y filtraría el nombre de un tablero ajeno aunque la página dé 404.
- Reutilizar `getBoardWithLists` en `generateMetadata`: carga el tablero completo solo
  para leer el título.

**Consecuencias.** Una consulta ligera más por visita al tablero.
`test/integration/board-metadata.int.test.ts` fija que el dueño y los miembros ven el
nombre, y que un no miembro o un id inexistente reciben «Tablero».

## 2026-09-24 — Contraste AA de --danger/--success y campos etiquetados en /boards

**Contexto.** `--success` (oklch 0.57 0.1 145) daba 3,86:1 sobre `--bg` y 3,72:1 en
los avisos `bg-success/10 text-success`. `--danger` rozaba el límite en sus avisos
(4,48:1) y en la insignia de vencida `bg-danger/15` (4,15:1 claro, 4,45:1 oscuro). El
placeholder de `Input`/`Textarea` (`text-ink-muted/70`) quedaba en ~3,2:1. En `/boards`,
el campo de nuevo tablero y el de importar JSON no tenían etiqueta accesible, y el
error de importación no se anunciaba.

**Decisión.**
- Tokens, lo mínimo para 4,5:1 con margen: claro `--danger` 0.55→0.52 y `--success`
  0.57→0.48 (la propuesta del hallazgo); oscuro `--danger` 0.70→0.71. `--success`
  oscuro no cambia. `DESIGN.md` actualizado.
- `test/contrast.test.ts` lee los tokens de `app/globals.css`, convierte OKLCH a sRGB y
  exige 4,5:1 para ink, ink-muted, accent, danger y success sobre bg, surface,
  surface-2 y column, para los avisos al 10 % y la insignia al 15 %, y para
  accent-ink sobre accent, en los dos temas.
- Placeholder de `app/components/ui/input.tsx` a `text-ink-muted` (6,2:1).
- `aria-label` en los dos campos de `/boards` y `role="alert"` en el error de
  importar.
- `title` con el nombre completo de la instancia en la barra superior, que se trunca
  en móvil. El resto del ajuste responsive de la barra ya estaba en main.

**Alternativas descartadas.**
- Cambiar solo `--success` y dejar `--danger` justo por debajo de 4,5:1 en sus avisos.
- Etiquetas `<label>` visibles: cambian la maquetación de la cabecera de `/boards`; el
  placeholder ya describe el campo a la vista.

**Consecuencias.** Verde y rojo algo más oscuros en tema claro, también en los rellenos
`bg-success`/`bg-danger` de otros componentes (barra de checklist, casillas). El test
avisa si un cambio de tono rompe el contraste. Otros placeholders con
`text-ink-muted/70` (search-box, card-modal) quedan fuera de este lote.

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
## 2026-09-24 — Modal de tarjeta: `<dialog>` nativo, fechas y confirmación de borrado

**Contexto.** El modal de tarjeta (`app/components/card/card-modal.tsx`) no gestionaba
el foco (Tab recorría el tablero de fondo, sin nombre accesible), la hora de los
comentarios provocaba un error de hidratación al abrir por `?card=` (servidor en UTC,
navegador en su zona), el vencimiento de solo lectura salía como ISO crudo, los toggles
de etiqueta e ítem ignoraban fallos y «Borrar tarjeta» borraba al primer clic.

**Decisión.**
- `<dialog>` nativo con `showModal()` en un layout effect y `close()` en su limpieza
  (antes de que React retire el nodo, para que el navegador devuelva el foco a la
  tarjeta). Escape por `onCancel`; el clic fuera se detecta con
  `e.target === dialog`, porque el `<dialog>` ocupa la ventana y hace de scroll.
- Hora de comentarios: solo tras hidratar (`useSyncExternalStore`), en la zona del
  navegador y `es-ES`; antes, `<time dateTime>` sin texto.
- Vencimiento: `Intl` `es-ES` con `timeZone: "UTC"` (es medianoche UTC).
- Toggles: `runToggle` devuelve un mensaje para un `role="alert"` que sale junto a lo
  que falló (bajo las etiquetas, o bajo los ítems de cada checklist), no arriba del
  modal, que tiene scroll; relanza los errores internos de Next con `unstable_rethrow`
  (API pública, no `isRedirectError` interno).
- Borrado: confirmación en línea con un segundo clic («¿Borrar la tarjeta?» Sí,
  borrar / No), con el foco movido al control nuevo en cada paso.
- Etiquetas no seleccionadas: solo se quita `opacity-55` (texto a ~2,2:1) y se mantiene
  el relleno de color; el estado se distingue por el ✓, el anillo y `aria-pressed`.
  `aria-pressed` también en los colores; colores nombrados en español.
- El fundido del fondo va en `::backdrop` con `motion-safe:`: la regla global de
  movimiento reducido de `globals.css` no cubre `::backdrop`.
- Lógica pura en `app/components/card/card-modal-helpers.ts` para probarla en node.

**Alternativas descartadas.**
- Atrapar el foco a mano o con una librería: `showModal()` ya vuelve inerte el fondo.
- `suppressHydrationWarning` en la hora: calla el aviso pero deja el texto incorrecto.
- Fijar `Atlantic/Canary` en el cliente: es self-hosted y cada usuario tiene su zona.
- `window.confirm`: bloquea y no sigue el estilo de la app.
- Etiqueta no seleccionada en contorno con un punto de color: es un cambio de diseño
  que no se pidió; basta con quitar la opacidad.
- Añadir `*::backdrop` a la regla de `globals.css`: `motion-safe:` lo resuelve sin
  tocar un archivo compartido.

**Consecuencias.** Con `?card=` el `<dialog>` llega cerrado en el HTML del servidor y
se abre al hidratar (un instante sin modal). El comportamiento del diálogo (foco, Tab,
Escape, clic fuera) no tiene test automático: no hay jsdom ni e2e en el proyecto;
queda pendiente de verificación manual. El selector de etiquetas de `filter-bar.tsx`
debe usar el mismo estilo que este (relleno sin opacidad).
## 2026-09-24 — Panel de miembros con `<dialog>` nativo

**Contexto.** El panel de miembros era un `div role="dialog"` sin foco inicial, sin foco
atrapado, sin devolver el foco al cerrar y sin nombre accesible. Los errores y
confirmaciones de la invitación no se anunciaban y el email se vaciaba al fallar.

**Decisión.**
- `<dialog>` abierto con `showModal()`: el navegador pone el foco dentro y deja inerte el
  resto. Escape (`cancel`) y el clic en el fondo llaman a `onClose`; el cierre real lo hace
  el padre al desmontarlo. Al desmontar se cierra y se devuelve el foco a quien lo tenía,
  a mano, porque el navegador no lo restaura si el `<dialog>` sale del DOM.
- `aria-labelledby`/`aria-describedby` con `useId`.
- Error con `role="alert"`; éxito en una región `role="status"` siempre montada.
- El formulario usa `defaultValue` con los `values` que devuelve la acción al fallar.

**Alternativas descartadas.**
- Trampa de foco en JavaScript o una librería de diálogos: el `<dialog>` modal ya lo da
  sin dependencias.
- Escuchar el evento `close` del `<dialog>`: en desarrollo, el doble montaje de Strict
  Mode lo dispara al limpiar el efecto y cerraría el panel recién abierto.

**Consecuencias.** Sin textos visibles nuevos. Falta verificarlo a mano con teclado y
lector de pantalla (no hay infraestructura e2e). El modal de tarjeta sigue con el patrón
antiguo (otro lote).

---

## 2026-09-24 — Recordatorios: día UTC, ventana de 7 días y un único aviso de vencida

**Contexto.** Las tarjetas vencidas se avisaban cada día para siempre y la pasada
crecía sin tope. El inicio del día se calculaba con la zona del servidor aunque `dueDate`
es medianoche UTC: con una zona negativa, una tarjeta que vence hoy salía como «Tarea
vencida» y el texto mostraba el día anterior. El formato usaba el locale `es`.

**Decisión.**
- El día se cuenta en UTC y la fecha se formatea con `es-ES` y `timeZone: 'UTC'` (es una
  fecha de calendario).
- «Vence pronto»: como mucho un aviso al día. «Tarea vencida»: un solo aviso, a partir del
  día UTC siguiente al vencimiento, y solo para tarjetas vencidas en los últimos 7 días.
- Solo se avisa a asignados que siguen siendo miembros del tablero.
- `created` solo cuenta las notificaciones que `notify()` guardó de verdad.
- Se añaden tests del endpoint cron (503/401/200) sin modificar `route.ts`.

**Alternativas descartadas.**
- Usar `ORGTABLE_TIMEZONE` para el día de vencimiento: `dueDate` no tiene hora ni zona;
  cualquier otra zona desplazaría la fecha elegida.
- Avisar de vencidas sin límite de antigüedad: avisos diarios infinitos.
- Fake timers en los tests: no afectan al `createdAt` que pone la BD.

**Consecuencias.** Las tarjetas vencidas hace más de 7 días dejan de generar avisos. Una
tarjeta vencida produce un único aviso de vencida. Tests en
`test/integration/reminders.int.test.ts` y `cron-reminders.int.test.ts`.

---

## 2026-09-24 — Expulsar a un miembro borra sus asignaciones; sin avisos a no miembros

**Contexto.** `removeBoardMember` solo borraba la fila `BoardMember`. Las asignaciones
(`CardAssignee`) se quedaban, y `addComment` y los recordatorios avisaban a todos los
asignados: el expulsado seguía recibiendo el título de las tarjetas y hasta 140
caracteres de cada comentario. Además, `updateBoardMemberRole` y `removeBoardMember` no
miraban cuántas filas cambiaban: con un `userId` ajeno se auditaba y notificaba un cambio
inexistente (revelando el título del tablero). Tampoco publicaban en el bus de tiempo
real.

**Decisión.**
- `removeMemberFromBoard` (`app/lib/services/members.ts`) borra membresía y asignaciones
  del tablero en una transacción y devuelve cuántas membresías borró.
- Las acciones de rol y expulsión no auditan ni notifican si no cambió nada (0 filas; en
  el rol, tampoco si ya tenía ese rol).
- Defensa en profundidad: `addComment` solo avisa a asignados que siguen siendo miembros,
  lo que cubre las asignaciones huérfanas ya existentes (los recordatorios, en su propia
  entrada).
- Las tres acciones de miembros usan `revalidateBoard` (revalida y publica en el bus).
- `addBoardMember` devuelve `values` con lo enviado cuando hay error, para que el
  formulario no se vacíe.
- Los tests de acciones sustituyen `requireBoardAccess` con `vi.mock` solo en su archivo,
  sin tocar el stub global de `next/headers`.

**Alternativas descartadas.**
- Limpiar ya las asignaciones huérfanas en producción: es una operación sobre datos
  reales que decide el propietario (con copia y prueba en seco). El filtro por membresía
  las neutraliza mientras tanto.
- Borrarlas con un trigger o un `onDelete` en BD: no hay relación directa entre
  `CardAssignee` y `BoardMember`; exigiría una migración para algo que resuelve una
  transacción.

**Consecuencias.** Las filas huérfanas previas siguen en la BD (sin efecto en avisos,
pero aún visibles como avatares en la tarjeta) hasta que se limpien. Tests en
`test/integration/members.int.test.ts` y `collaboration.int.test.ts`.

---

## 2026-09-24 — `notify` informa de si guardó la notificación

**Contexto.** `notify()` tenía un `catch` vacío: si la inserción fallaba no quedaba
rastro, y el cron de recordatorios contaba el aviso como creado igualmente, así que
`POST /api/cron/reminders` devolvía un `created` falso.

**Decisión.** `notify()` sigue siendo best-effort (nunca lanza), pero devuelve
`Promise<boolean>`: `true` en cuanto la fila se guarda (aunque después falle la
publicación en el bus, que va en su propio `try`) y `false` si no. El fallo se registra
con `console.error` con tipo, ids y código de error, sin título ni cuerpo (llevan texto
del usuario).

**Alternativas descartadas.**
- Relanzar el error: rompería la mutación que origina el aviso (comentar, invitar…).
- Registrar el mensaje completo del error: puede incluir valores de la consulta.

**Consecuencias.** Los llamadores que no miran el resultado no cambian. El cron solo
suma los avisos guardados. Test en `test/integration/notifications.int.test.ts`.

---
## 2026-09-24 — Refrescar el contador de notificaciones desde la Server Action

**Contexto.** Al abrir una notificación con tablero no se llamaba a `router.refresh()`
y `markNotificationRead` no revalidaba nada: el layout compartido no se volvía a
renderizar y el contador de no leídas se quedaba igual.

**Decisión.** `markNotificationRead` y `markAllNotificationsRead` llaman a
`refresh()` de `next/cache` (Next 16, solo en Server Actions) tras el `updateMany`, y
se quitan los `router.refresh()` del cliente. `test/stubs/next-cache.ts` exporta
`refresh` como no-op.

**Alternativas descartadas.**
- `router.refresh()` también cuando hay tablero: compite con el `router.push` y
  depende de que el cliente se acuerde en cada llamada.
- `revalidatePath("/", "layout")`: invalida más de lo necesario.

**Consecuencias.** El refresco lo decide el servidor. El badge solo se puede comprobar
en el navegador; el test de integración (`notifications-read.int.test.ts`) comprueba
el dato y que se pide `refresh()`.

## 2026-09-24 — Resincronizar el tablero y la campana al reconectar el EventSource

**Contexto.** El servidor no reenvía los eventos perdidos (no hay `Last-Event-ID`), y
el cliente no hacía nada al reconectar: tras suspender el portátil o reiniciar el
servidor, el tablero y el contador de notificaciones mostraban datos viejos.

**Decisión.** `createReconnectRefresher` (`app/lib/realtime/reconnect.ts`): en cada
`open` del EventSource salvo el primero se lanza el mismo refresh con debounce que
un evento. Si el EventSource queda en `CLOSED` (el servidor respondió 401/403), se
hace `router.refresh()` para que la página redirija.

**Alternativas descartadas.**
- `Last-Event-ID` con historial de eventos en el servidor: exige guardar eventos por
  canal (memoria o tabla) para un beneficio que un refresh ya cubre.
- Refrescar en cada `open`, incluido el primero: un render extra al cargar la página.

**Consecuencias.** Un `router.refresh()` por reconexión (también cada 15 min por la
vida máxima del stream). Si un proxy responde 5xx durante un reinicio, el EventSource
queda `CLOSED` y el tiempo real no vuelve hasta recargar; se deja como mejora.

## 2026-09-24 — Puente LISTEN/NOTIFY: cierre, reconexión y validación del payload

**Contexto.** Si `LISTEN` fallaba o la conexión daba `error`, el cliente `pg` no se
cerraba y cada suscripción SSE abría otra conexión, sin registrar nada. Mientras el
puente estaba arrancando, los eventos publicados se perdían. El payload de `NOTIFY` se
parseaba con un cast: uno sin `id` se reemitía en `board:undefined`. Los `.catch` de
publicación estaban vacíos.

**Decisión.**
- La conexión fallida o caída se cierra siempre (`end()`) y se registra con
  `console.error` (sin `DATABASE_URL`). El estado global solo se limpia si el cliente
  que falla es el activo.
- La promesa de arranque se guarda en `globalThis` y `publishCrossInstance` la espera.
- Reconexión con backoff exponencial de 1 s a 30 s, un único temporizador en
  `globalThis` y solo mientras quedan suscriptores.
- `parseBridgePayload` valida con zod (`kind` board/user, `id` y `origin` no vacíos);
  lo inválido se descarta con `console.warn` indicando solo la longitud.

**Alternativas descartadas.**
- Reintentar en cada suscripción (lo de antes): sin backoff, una caída de la BD
  multiplicaba las conexiones.
- Volcar el payload inválido al log: puede venir de cualquiera con acceso a la BD.

**Consecuencias.** Solo afecta con `ORGTABLE_REALTIME_PG_NOTIFY=1`. Tests unitarios en
`test/realtime-bus.test.ts` con un `pg` simulado. No se ha probado con una caída real
de Postgres (`pg_terminate_backend`).

## 2026-09-24 — Ciclo de vida y revalidación del acceso en los streams SSE

**Contexto.** Los dos streams SSE (`/api/boards/[id]/stream` y
`/api/notifications/stream`) dejaban la suscripción al bus y el latido colgados si la
petición se abortaba durante la autorización o si `enqueue` fallaba (el flag `closed`
hacía que `close()` saliera sin limpiar), y no tenían `cancel()`. Además la
autorización solo se comprobaba al conectar: una sesión revocada o una persona
expulsada seguían recibiendo eventos, en contra del ADR 0008.

**Decisión.**
- Helper común `app/lib/realtime/sse.ts` (`createSseResponse`) con una limpieza
  idempotente llamada desde el abort (`{ once: true }`), `cancel()`, un `enqueue`
  fallido, la revalidación y la vida máxima. Si la petición llega ya abortada se
  responde 204 sin suscribirse.
- En cada latido (25 s) se revalida con la BD: sesión no revocada ni caducada
  (`isSessionActive`) y, en el tablero, que siga siendo miembro. Un flag evita
  consultas solapadas; si la consulta falla, se registra y se cierra.
- Vida máxima de 15 min: al cerrar, EventSource reconecta y la ruta reautoriza desde
  la cookie.

**Alternativas descartadas.**
- `verifySession` en el latido: depende de `cookies()`, que solo existe dentro de la
  petición inicial.
- Evento de control para cortar al instante al revocar: más invasivo (publicar desde
  cada acción de revocación o expulsión); 25 s de margen es aceptable.
- Mantener una copia de la lógica en cada ruta: las dos copias tenían el mismo fallo.

**Consecuencias.** Una consulta ligera por conexión cada 25 s. Cada 15 min el cliente
reconecta. Tests en `test/integration/realtime.int.test.ts` (401/403, abort, cancel,
revocación, expulsión, vida máxima; sin listeners ni temporizadores tras cerrar).

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
