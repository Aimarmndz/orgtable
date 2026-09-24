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
## 2026-09-24 — Recrear el EventSource cuando el navegador deja de reintentar

**Contexto.** Detrás de un proxy TLS (nginx, Caddy), un reinicio con
`scripts/update.sh` hace que el proxy responda 502 al stream SSE. Ante una respuesta
que no es 200, el navegador deja el `EventSource` en `CLOSED` y no reintenta. El
cliente solo hacía `router.refresh()`: como la sesión seguía siendo válida la página no
redirigía y el tablero y la campana se quedaban sin tiempo real hasta recargar.

**Decisión.** `keepEventSourceOpen` (`app/lib/realtime/reconnect.ts`) gestiona el
ciclo de vida del `EventSource` en `BoardRealtime` y `NotificationsBell`: registra los
manejadores, refresca en cada apertura salvo la primera (también en fuentes recreadas)
y, si la fuente queda `CLOSED`, hace `router.refresh()`, la cierra y crea otra tras un
backoff exponencial de 3 s a 30 s que se reinicia al abrir. La limpieza del efecto
cierra la fuente y cancela el reintento pendiente. Si el acceso se revocó, el refresh
redirige y el desmontaje corta los reintentos. Se prueba con un doble de
`EventSource` en `test/realtime-reconnect.test.ts` (no hay jsdom).

**Alternativas descartadas.**
- Recrear la fuente dentro de cada componente: duplica la lógica del temporizador en
  dos sitios y no se puede probar sin navegador.
- Reintentar sin backoff o con intervalo fijo corto: martillea al servidor mientras
  arranca.
- Solo documentar el límite: el reinicio con `update.sh` es la operación habitual.

**Consecuencias.** Si el servidor rechaza con 401/403 y por lo que sea la página no
redirige, se reintenta cada 30 s como máximo (petición barata que el servidor vuelve a
rechazar). Cada reapertura tras `CLOSED` provoca dos refresh (el de `CLOSED` y el de
la reapertura); se acepta por simplicidad.

## 2026-09-24 — Hora de las notificaciones solo tras montar

**Contexto.** El tiempo relativo de la campana depende de la hora y la zona del
navegador. Hoy la lista solo se pinta al abrir el desplegable (ya en cliente), pero
nada impedía que un cambio futuro la renderizara en el SSR con otro texto.

**Decisión.** Mismo patrón que los comentarios: `useSyncExternalStore` (servidor
`false`, cliente `true`) y el texto relativo solo con el componente montado, dentro de
un `<time dateTime>`. La fecha absoluta usa `Intl.DateTimeFormat("es-ES")` en la zona
del navegador.

**Alternativas descartadas.** `suppressHydrationWarning`: oculta el aviso pero deja el
texto del servidor.

**Consecuencias.** Durante la hidratación la hora aparece vacía un instante.

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
vida máxima del stream). El caso `CLOSED` por un 5xx del proxy se resuelve en la
entrada «Recrear el EventSource cuando el navegador deja de reintentar».

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
## 2026-09-24 — El token de API queda fuera de la región viva

**Contexto.** En `/settings`, el `role="status"` siempre montado envolvía todo el panel
del token recién creado: el texto, el `<code>` con el token en claro y el botón Copiar,
y dentro había además el `role="alert"` del fallo de copia. El lector de pantalla podía
leer el token entero cada vez que la región cambiaba (también al pasar a «Copiado») y
anunciar dos veces el aviso de fallo.

**Decisión.** El `role="status"` solo contiene «Token «nombre» creado» y «Cópialo ahora:
por seguridad no se volverá a mostrar.». El `<code>`, el botón y el `role="alert"` son
hermanos de la región, no hijos. El recuadro verde pasa a ser el contenedor siempre
montado (sin estilo hasta que hay token), así el aspecto no cambia.

**Alternativas descartadas.** `aria-live="off"` en el `<code>` dentro de la región: el
cambio de texto del botón seguiría disparando el anuncio de la región completa en
algunos lectores.

**Consecuencias.** Test en `test/admin-forms-a11y.test.ts`: con un token creado, la
región no contiene el token ni el botón (se sustituye `useActionState` en el propio test
porque el render de servidor siempre da el estado inicial). La lectura real con un
lector de pantalla queda pendiente de verificación manual.

## 2026-09-24 — Restablecer contraseña valida el userId; alcance del test del borrado

**Contexto.** `resetUserPassword` validaba `userId` dentro de `resetPasswordSchema`: sin
`userId` redirigía a `?error=password` («La contraseña debe tener al menos 8
caracteres.»), que no era el problema. Además, el test del propietario de tableros
pasaba también con el código anterior (comprobación previa + DELETE), así que no
demostraba la condición atómica del servicio.

**Decisión.**
- `resetUserPassword` llama a `readUserId` antes de validar la contraseña, como el resto
  de acciones por fila: sin `userId` responde `?error=invalid`.
- Test directo de `deleteUserAccount` (sin pasar por la acción): un propietario de
  tableros devuelve `owns_boards` y su tablero y su adjunto siguen en BD; un id
  inexistente devuelve `not_found`.

**Alternativas descartadas.** Distinguir por `issues[0].path` del esquema: reparte la
validación del id entre dos sitios. Reproducir la carrera intercalando dos transacciones
(bloqueo de la fila `User` por el INSERT del tablero): depende del orden de bloqueos de
Postgres y sería un test frágil.

**Consecuencias.** La carrera en sí (un tablero creado entre una comprobación y el
DELETE) NO está probada; los tests fijan el contrato del servicio (la salvaguarda está
en el propio DELETE, la acción no comprueba nada antes). Tests en
`test/integration/admin-users.int.test.ts`.

---

## 2026-09-24 — Administración y ajustes: avisos anunciados, móvil y copia del token

**Contexto.** Los errores y avisos de `/admin/users` y `/settings` no se anunciaban al
lector de pantalla; el campo de nueva contraseña no tenía etiqueta; las tablas de
usuarios y auditoría se recortaban a 375 px (`overflow-hidden`) y dejaban la columna
Acciones fuera de alcance; si fallaba copiar el token (por `http://IP`, contexto no
seguro) no se avisaba, y el token solo se muestra una vez.

**Decisión.**
- Errores con `role="alert"`; éxitos dentro de un `role="status"` siempre montado. El
  email duplicado marca el campo con `aria-invalid` + `aria-describedby`.
- `aria-label="Nueva contraseña para <nombre>"` en el campo de restablecer.
- `overflow-x-auto` en las tablas (mantiene el recorte de las esquinas).
- Copiar el token guarda el resultado ligado al token (`copied`/`error`); si falla,
  muestra «No se pudo copiar automáticamente: selecciona el token y cópialo a mano.» y
  deja el token seleccionado (`select-all` + `selectAllChildren`).

**Alternativas descartadas.** Pasar las tablas a tarjetas en móvil: cambio de diseño que
decide el propietario. `document.execCommand("copy")` como respaldo: API obsoleta.

**Consecuencias.** Test unitario `test/admin-forms-a11y.test.ts` (render en servidor:
las regiones `role="status"` existen desde el primer render). El resto (lector de
pantalla, 375 px, copia por http) queda pendiente de verificación manual.

---

## 2026-09-24 — Crear usuario y crear token conservan lo escrito tras un error

**Contexto.** Con `action={fn}` React restablece el formulario al terminar la acción,
así que un email duplicado o un dato no válido borraban todo lo tecleado.

**Decisión.** `createUser` y `createApiToken` devuelven `values` en cada error (nunca la
contraseña) y los campos usan `defaultValue`. Los `<select>` llevan además `key` con el
valor devuelto: React no actualiza el `defaultValue` de un `<select>` ya montado y el
reset lo devolvería al valor inicial (p. ej. «Administrador» → «Miembro»).
`createUser` indica `field: "email"` para marcar el campo del email duplicado.

**Alternativas descartadas.** Campos controlados con `useState`: más código por campo
para el mismo resultado. Enviar con `onSubmit` + `startTransition` para evitar el reset:
cambia el flujo de envío de los dos formularios.

**Consecuencias.** Tests en `admin-users.int.test.ts` y `tokens.int.test.ts` (los
valores vuelven y la contraseña no).

---

## 2026-09-24 — Fechas del servidor en la zona de la instancia (ORGTABLE_TIMEZONE)

**Contexto.** `/admin/audit`, `/admin/users` y `/settings` son Server Components que
formateaban con `Intl.DateTimeFormat("es")` sin `timeZone`: salían en la zona del
proceso (UTC en el contenedor). Un login fallido a las 10:15 en Canarias aparecía a las
9:15, y las fechas cercanas a medianoche cambiaban de día.

**Decisión.**
- Helper único `app/lib/format-date.ts` (`formatDateTime`, `formatDate`) con locale
  `es-ES` y la zona de la variable `ORGTABLE_TIMEZONE` (IANA; por defecto
  `Atlantic/Canary`). Se valida con `Intl`: una zona desconocida lanza un error claro
  en vez de caer a un valor por defecto.
- La auditoría muestra la abreviatura de la zona (`timeZoneName: "short"`).
- Los vencimientos (`dueDate`, fechas de calendario a medianoche UTC) NO usan este
  helper: se formatean con `timeZone: "UTC"`.

**Alternativas descartadas.**
- Formatear en el cliente con la zona del navegador: obliga a convertir tres páginas de
  servidor en componentes cliente y da horas distintas a cada administrador.
- Fijar `Atlantic/Canary` en el código: es una app self-hosted, cada instancia tiene la
  suya.

**Consecuencias.** Variable de entorno nueva `ORGTABLE_TIMEZONE` (su documentación en
`.env.example` y README la hace el lote de despliegue). Test unitario
`test/format-date.test.ts` con `TZ=UTC`.

---

## 2026-09-24 — Acciones de administración: usuario inexistente y borrado atómico

**Contexto.** `updateUserRole`, `resetUserPassword`, `revokeUserSessions` y `deleteUser`
no miraban si el usuario existía: auditaban y mostraban éxito con un id inexistente.
`deleteUser` comprobaba los tableros propios en una consulta previa; si el usuario
creaba un tablero entre medias, la cascada por `ownerId` borraba sus filas `Attachment`
y dejaba los ficheros huérfanos en el volumen de adjuntos.

**Decisión.**
- El id se valida como cadena no vacía (`String(null)` daba `"null"`).
- Se usa el `count` de `updateMany`/`deleteMany` (y un `findUnique` en «Cerrar
  sesiones», donde 0 sesiones es válido) y se redirige a `?error=not-found` antes de
  auditar. Mensaje: «Ese usuario ya no existe.».
- `deleteUserAccount` (servicio) borra con `where: { id, boards: { none: {} } }`: la
  condición va en el mismo DELETE, así que la cascada nunca alcanza adjuntos.

**Alternativas descartadas.** Leer los `storedName` y borrar los ficheros tras el
DELETE: con la condición atómica no hay adjuntos que borrar, y no tendría forma de
probarse sin saltarse la salvaguarda de tableros propios.

**Consecuencias.** Tests en `test/integration/admin-users.int.test.ts` (sin auditoría
con id inexistente; un propietario de tableros no se borra y su adjunto sigue en BD).
Esos tests no reproducen la carrera: ver la entrada «Restablecer contraseña valida el
userId; alcance del test del borrado».

---

## 2026-09-24 — Crear un token de API valida permisos y caducidad

**Contexto.** `createApiToken` convertía un `scope` o `expiry` no reconocidos en
«escritura» y «no caduca», el valor más permisivo, con un comentario que hablaba de
«valores por defecto seguros».

**Decisión.** Nombre, permisos y caducidad se validan con un único `z.object` que
reutiliza los esquemas de `validators.ts`; si algo falla, se devuelve `{ error }` sin
crear nada («Permisos no válidos.» / «Caducidad no válida.»). Los valores por defecto
del formulario (escritura, nunca caduca) no cambian: los decide el propietario.

**Alternativas descartadas.** Caer a «solo lectura» y caducidad finita: seguiría
siendo un valor por defecto silencioso que tapa un formulario manipulado o roto.

**Consecuencias.** Test en `test/integration/tokens.int.test.ts`.

---

## 2026-09-24 — Restablecer la contraseña también revoca los tokens de API

**Contexto.** `resetUserPassword` solo revocaba sesiones. `authenticateApiToken` no mira
la tabla `Session`, así que quien hubiera creado un token `full` sin caducidad con una
cuenta comprometida seguía entrando por `/api/v1` después del reset. El comentario de la
acción prometía lo contrario.

**Decisión.**
- Nuevo servicio `resetPasswordAndRevokeAccess` en `app/lib/services/users.ts`: en una
  sola `$transaction` cambia el hash, revoca las sesiones y **borra** los tokens del
  usuario (borrar es la revocación del ADR 0013). Comprueba que el usuario existe antes
  de hashear.
- La auditoría `user.password_reset` guarda cuántos tokens se revocaron.
- «Cerrar sesiones» no cambia de semántica (solo sesiones) y no se añade un botón nuevo
  de revocar tokens; queda documentado que no toca los tokens.

**Alternativas descartadas.**
- Invalidar tokens por fecha (`tokensValidAfter` en `User`): exige migración y deja
  filas muertas en `/settings`.
- Revocar tokens también en «Cerrar sesiones»: cambia una acción que se usa para cerrar
  el navegador de alguien sin romper sus scripts.

**Consecuencias.** Tras un reset el usuario tiene que crear tokens nuevos. Test en
`test/integration/admin-revocation.int.test.ts` (el mismo Bearer pasa de 200 a 401; los
tokens de otros usuarios no se tocan).
## 2026-09-24 — Stub de next/headers: vaciar cookies y cabeceras por separado

**Contexto.** `loginAs` llamaba a `__clearCookies`, que vaciaba también las cabeceras
inyectadas. Un test que hiciera `__setHeaders({ "x-forwarded-proto": "https" })` y luego
`loginAs` perdía la cabecera sin aviso: la cookie salía sin `Secure` y el rate limit no
veía la IP. Además, el test de `resetDb` también pasaba con la lista fija de tablas
anterior (CardAssignee y Comment caen por el CASCADE), así que no demostraba que las
tablas se leyeran del catálogo.

**Decisión.**
- `__clearCookies` vacía solo las cookies y `__clearHeaders` solo las cabeceras.
  `loginAs` llama a la primera; `resetDb`, a las dos. Orden documentado en
  `docs/testing.md`: las cabeceras se ponen después de `resetDb`, antes o después de
  `loginAs`.
- `helpers.int.test.ts` crea una tabla temporal sin FK, le mete una fila y exige que
  `resetDb` la vacíe (con la lista fija falla); y comprueba que `loginAs` conserva
  `X-Forwarded-Proto`/`X-Forwarded-For`.
- `audit.int.test.ts` exige que el log del fallo por FK no lleve el `userId`. Pasa con el
  `describeError` actual (el mensaje de Prisma P2003 nombra la restricción, no el
  valor), así que no se toca `app/lib/audit.ts`.

**Alternativas descartadas.**
- Mantener un único `__clearCookies` con un parámetro para conservar cabeceras:
  parámetro booleano que cambia el comportamiento.
- Comparar `pg_tables` con los modelos de Prisma: depende de `@@map` y no prueba que
  `resetDb` use el catálogo, solo que el esquema coincide.
- Registrar solo nombre y código de todo `PrismaClientKnownRequestError`: el test no
  muestra fuga y se perdería la restricción que falla, útil para diagnosticar.

**Consecuencias.** Los tests de cookie `Secure` y de IP pueden usar `loginAs` sin
reinyectar cabeceras. La tabla temporal `zz_reset_probe` se borra en un `finally` y,
por si quedara de una ejecución interrumpida, también antes de crearla.

## 2026-09-24 — Login y setup: conservar lo tecleado y anunciar los errores

**Contexto.** React 19 resetea los formularios no controlados después de una acción:
tras «Credenciales incorrectas» se borraba el email, y tras un error de validación del
setup, los cuatro campos. Además el mensaje de error era un `<p>` sin `role="alert"`
que el lector de pantalla no anunciaba.

**Decisión.**
- `AuthState.values` y `SetupState.values` devuelven lo enviado en cada error (email;
  nombre de instancia, nombre y email), nunca la contraseña. El cliente lo pinta con
  `defaultValue`. En el éxito no se devuelven.
- El `<p>` de error lleva `role="alert"` y se retira mientras `pending`, para que un
  segundo error idéntico se vuelva a insertar y se anuncie otra vez.

**Alternativas descartadas.**
- Campos controlados con `useState`: más código en dos formularios para el mismo efecto.
- `key` con un contador de intentos: obliga a añadir estado solo para eso.

**Consecuencias.** La verificación con VoiceOver es manual: no hay infraestructura de
tests de componentes. Los tests de integración comprueban que `values` llega sin la
contraseña.

---

## 2026-09-24 — Setup: advisory lock, corte temprano y causa en el log

**Contexto.** `completeSetup` comprobaba `setupCompletedAt` dentro de la transacción y
el comentario lo daba por atómico, pero con READ COMMITTED dos envíos simultáneos leían
«sin configurar» a la vez y creaban dos administradores (reproducido con un test: sin
bloqueo salen dos ADMIN). Además, con el setup ya hecho la acción seguía validando y
gastando bcrypt antes de descubrirlo, y cualquier fallo acababa en «Inténtalo de nuevo»
sin dejar la causa.

**Decisión.**
- Lógica en `app/lib/services/setup.ts` (`completeInstanceSetup`), cuya primera
  sentencia es `pg_advisory_xact_lock(hashtext('orgtable:setup'))`.
- La acción corta con `redirect("/login")` si `isSetupComplete()` antes de validar y de
  hacer el hash; la comprobación dentro de la transacción se mantiene.
- En error, `console.error` con nombre, código y campos de Prisma y mensaje, sin
  FormData ni email. El texto visible no cambia.

**Alternativas descartadas.**
- `SELECT … FOR UPDATE` o `updateMany` condicional: la fila de `InstanceConfig` no existe
  antes del primer setup y no hay nada que bloquear.
- Crear primero `InstanceConfig` y tratar el P2002 de su PK como «ya configurado»:
  obliga a distinguirlo del P2002 del email duplicado.
- Nivel SERIALIZABLE: exigiría reintentos ante fallos de serialización.
- Mensaje específico para email duplicado: era opcional y añadía un texto visible nuevo.

**Consecuencias.** El segundo envío espera al primero y recibe `ALREADY_SETUP`
(redirección a `/login`). Test de 20 iteraciones con dos llamadas simultáneas en
`test/integration/setup.int.test.ts`.

---

## 2026-09-24 — La auditoría registra sus propios fallos

**Contexto.** `recordAudit` tenía un `catch {}` vacío: si fallaba la escritura en
`AuditLog`, los eventos de seguridad (`auth.login_failed`, `user.deleted`…) se perdían
sin rastro.

**Decisión.** Se sigue sin relanzar (best-effort), pero se escribe `console.error` con
`action`, `targetType`, `targetId` y un resumen del error (tipo, código de Prisma y
mensaje). Nunca `detail`, `ip` ni `userId`. Para `PrismaClientValidationError` solo se
registra el tipo, porque su mensaje reproduce los argumentos de la consulta.

**Alternativas descartadas.**
- Relanzar el error: haría fallar el login o el borrado por un problema de la tabla de
  auditoría.
- Registrar el error completo: el mensaje de validación de Prisma incluye `detail` e
  `ip`.

**Consecuencias.** Un fallo de auditoría aparece en los logs del contenedor
(`docker compose logs app`) con la acción afectada.

---

## 2026-09-24 — Login: IP de confianza, límite por cuenta y hash ficticio válido

**Contexto.** Cuatro fallos del login: (1) el límite por IP tomaba el primer valor de
`X-Forwarded-For`, que escribe el cliente, y cambiándolo en cada intento la fuerza bruta
no tenía límite; tampoco había límite por cuenta. (2) El hash ficticio para emails
inexistentes medía 59 caracteres, `bcrypt.compare` devolvía `false` al instante y el
tiempo de respuesta revelaba qué emails tienen cuenta. (3) Cada fallo guardaba en
`AuditLog.detail` el email tecleado, exista o no la cuenta. (4) Cada intento rechazado
por el límite escribía una fila de auditoría.

**Decisión.**
- `TRUSTED_PROXY_HOPS` (entero >= 0, por defecto 0, validado): con 0 se ignoran
  `X-Forwarded-For` y `X-Real-IP`; con N se toma el N-ésimo valor desde la derecha
  (`app/lib/client-ip.ts`). Sin IP no se aplica límite por IP ni un contador común.
- Límite por cuenta: 20 intentos fallidos cada 15 minutos por email normalizado, también
  para emails inexistentes; se reinicia tras un login correcto. Se cuenta antes de
  verificar y se borra con el éxito, para no tener carreras entre peticiones simultáneas.
- `DUMMY_PASSWORD_HASH`: hash bcrypt real de 60 caracteres y coste 12, como literal, y
  `verifyPasswordOrDummy` en `app/lib/auth.ts`.
- `auth.login_failed` guarda solo el `userId` si la cuenta existe; nunca el email.
- `RateLimitResult.firstBlock`: se audita solo el primer rechazo de cada ventana, con
  `detail` «límite por IP» o «límite por cuenta».
- ADR 0009 actualizado.

**Alternativas descartadas.**
- Seguir con el primer valor de `X-Forwarded-For` o con `X-Real-IP`: los controla el
  cliente cuando la app está expuesta sin proxy.
- Contador global `login:unknown` cuando no hay IP: un atacante bloquearía el login de
  todo el mundo.
- Guardar un HMAC del email inexistente para correlacionar ataques: sigue siendo un dato
  seudónimo de un tercero y no hacía falta.
- `bcrypt.hashSync` al importar el módulo: añade ~200 ms a cada arranque en frío.

**Consecuencias.** Con el valor por defecto `AuditLog.ip` queda vacío y solo rige el
límite por cuenta. Quien conozca un email puede bloquear esa cuenta hasta 15 minutos
(riesgo aceptado, documentado en el ADR 0009). Las filas antiguas de `auth.login_failed`
con email siguen en producción: borrarlas es una operación masiva que decide el
propietario. `.env.example`, README y `docs/operations.md` los actualiza el lote de
despliegue.

---

## 2026-09-24 — Cookie de sesión Secure según el esquema real y SESSION_SECRET ruidoso

**Contexto.** La cookie `session` llevaba `Secure` cuando `NODE_ENV=production`. El
primer arranque documentado es por `http://IP:3000`, y el navegador descarta una cookie
`Secure` recibida por HTTP en un origen que no es localhost: tras el asistente la
instancia no dejaba entrar. Por otro lado, `decrypt` llamaba a `getKey()` dentro del
`try`, así que un `SESSION_SECRET` ausente se convertía en «sin sesión» y redirigía a
`/login` sin dejar rastro.

**Decisión.**
- `secure` = la petición llegó por HTTPS: primer valor de `X-Forwarded-Proto` igual a
  `https`. Next rellena esa cabecera con el esquema real del socket cuando no la trae
  un proxy (`??=` en `base-server`), y un proxy TLS la fija a `https`.
- `decrypt`: sin token devuelve `null` antes de pedir la clave; con token, `getKey()` va
  fuera del `try` y solo `jwtVerify` queda dentro.
- `createSession` valida la clave antes de crear la fila `Session`.

**Alternativas descartadas.**
- Variable `SESSION_COOKIE_SECURE` para desactivarlo en LAN: otra opción de
  configuración que rebaja la seguridad si se deja puesta tras poner TLS.
- Seguir con `NODE_ENV`: deja inservible la instalación por HTTP.

**Consecuencias.** Por HTTP la cookie viaja sin `Secure` (lo que ya pasaba en la
práctica al no poder entrar); detrás de un proxy TLS que envíe `X-Forwarded-Proto` sí
lo lleva. Falsear esa cabecera solo afecta al propio cliente. La documentación del
despliegue (TLS delante) la actualiza el lote de despliegue.

---

## 2026-09-24 — Tests de integración con sesión: stub mutable de cookies

**Contexto.** El stub de `next/headers` devolvía siempre `undefined` en `cookies().get`,
así que `verifySession`, `requireUser` y `requireBoardAccess` nunca autenticaban en los
tests: no había forma de probar las Server Actions ni la revocación de sesiones (ADR
0008). Además `resetDb` usaba una lista fija de tablas a la que le faltaban
`CardAssignee` y `Comment`.

**Decisión.**
- `test/stubs/next-headers.ts` guarda cookies y cabeceras en un almacén mutable de
  módulo, con `__setHeaders`, `__clearCookies` y `__getCookieOptions` para los tests.
- `loginAs(userId)` en `test/integration/helpers.ts` llama a la `createSession` real;
  `resetDb` limpia además el stub y los contadores del rate limit.
- `SESSION_SECRET` fijo de test en `vitest.integration.config.ts`.
- `resetDb` lee las tablas de `pg_tables` (esquema actual, sin `_prisma_migrations`) y
  valida cada nombre antes de interpolarlo en el `TRUNCATE`.
- Se confirma con un test que `cache()` de React no memoiza fuera de RSC (cambiar de
  usuario con `loginAs` se ve al instante).

**Alternativas descartadas.**
- `vi.mock("next/headers")` en cada archivo: repetiría el mismo almacén en todos los
  tests.
- Mantener la lista de tablas a mano añadiendo las dos que faltaban: se volvería a
  desfasar con la siguiente tabla.
- Estimar filas con `reltuples` para decidir qué vaciar: no es exacto.

**Consecuencias.** Los tests pueden ejecutar Server Actions con sesión real (fila
`Session` + JWT firmado). Quitar una comprobación de `verifySession` hace fallar
`session.int.test.ts` (comprobado quitando `revokedAt` y el control de `userId`).
## 2026-09-24 — Adjuntos: bloquear las filas padre antes de leer qué ficheros borrar

**Contexto.** El comentario de `services/attachments.ts` decía que «lo leído es
exactamente lo que se borra», pero con READ COMMITTED no era así: si `uploadAttachment`
insertaba su fila entre el `findMany` y el `delete`, el borrado esperaba a esa
inserción y la eliminaba en cascada; su fichero no estaba en la lista leída y quedaba
huérfano, con la subida respondida como correcta.

**Decisión.** Dentro de la transacción, `SELECT … FOR UPDATE` de arriba abajo antes del
`findMany`: la tarjeta (`deleteCardWithAttachments`); la lista y sus tarjetas
(`deleteListWithAttachments`); el tablero, sus listas y sus tarjetas
(`deleteBoardWithAttachments`). Insertar un `Attachment` toma `FOR KEY SHARE` sobre su
`Card`, que choca con `FOR UPDATE`; bloquear también los padres frena las altas de
tarjetas y listas mientras se leen las hijas. Test de integración que reproduce la
carrera con una transacción sin confirmar y falla sin los bloqueos.

**Alternativas descartadas.**
- Nivel SERIALIZABLE: obliga a reintentar ante fallos de serialización en cada llamada.
- Solo corregir el comentario: el fichero seguiría quedando huérfano.
- Barrido periódico de huérfanos: infraestructura nueva para un caso que el bloqueo
  evita.

**Consecuencias.** Un borrado grande de tablero bloquea sus listas y tarjetas durante la
transacción; las ediciones concurrentes de esas filas esperan unos milisegundos. Una
subida que llegue durante el borrado falla y `uploadAttachment` borra su fichero.

---

## 2026-09-24 — Orden: tope de 1024 caracteres para las claves de posición

**Contexto.** `isValidPositionKey` limitaba las claves a 64 caracteres. Medido con un
script sobre `fractional-indexing`: soltar tarjetas siempre en el mismo hueco (p. ej.
siempre en la segunda posición) supera los 64 caracteres a las 373 inserciones. Desde
ahí `moveCard`/`reorderList` devolvían `{ ok: false }` para ese hueco y, como
`BoardView` ignora el resultado, el arrastre parecía funcionar y se deshacía al
refrescar.

**Decisión.** `POSITION_KEY_MAX = 1024` (unas 6000 inserciones seguidas en el mismo
hueco). Sigue impidiendo cadenas de megabytes y queda muy por debajo del máximo de una
entrada del índice btree `(listId, position)` de `Card` (≈2700 bytes). Documentado en
`docs/drag-and-drop.md` junto con su consecuencia.

**Alternativas descartadas.**
- Mantener 64 y solo documentarlo: el límite se alcanza con un uso normal.
- Quitar el tope: una clave de megabytes llegaría a la BD y rompería el índice.
- Rebalancear las posiciones de la lista al pasar de cierta longitud: más código y
  escrituras en varias filas por un caso que 1024 ya cubre de sobra.

**Consecuencias.** El fallo silencioso de `BoardView` ante `{ ok: false }` sigue ahí
(fuera de este lote); con 1024 solo aparece en un uso extremo.

---

## 2026-09-24 — Contraseñas de 72 bytes como máximo

**Contexto.** `setupSchema` y `passwordSchema` admitían 200 caracteres, pero bcryptjs
solo usa los primeros 72 bytes UTF-8: dos contraseñas con el mismo prefijo de 72 bytes
eran equivalentes sin que nadie lo supiera.

**Decisión.** `passwordSchema` rechaza más de 72 bytes UTF-8 (mensaje «Máximo 72 bytes
(unos 72 caracteres sin tildes ni emojis)») y `setupSchema.password` lo reutiliza, así
que el criterio vive en un solo sitio (setup, alta y reset por el administrador).
`loginSchema` no cambia.

**Alternativas descartadas.**
- Prehash (SHA-256 antes de bcrypt): invalidaría los hashes existentes o exigiría
  migrarlos.
- Aplicar el límite también al login: bloquearía a quien ya tenga guardada una
  contraseña más larga (que sigue funcionando con sus primeros 72 bytes).

**Consecuencias.** Una contraseña nueva de más de 72 bytes se rechaza con un error
visible. El `maxLength` de los formularios no se toca aquí.

---

## 2026-09-24 — Tiempo real: borrar un tablero avisa por el bus en vivo

**Contexto.** `deleteBoard` (acción y `DELETE` de la API) no publicaba nada: las
pestañas que tenían el tablero abierto seguían mostrándolo hasta recargar.

**Decisión.** Tras borrar, se llama a `revalidateBoard(boardId)` como en el resto de
mutaciones; la Server Action solo lo hace si de verdad se borró (dueño).

**Alternativas descartadas.** Un evento específico `board.deleted` en el bus: el cliente
ya refresca con cualquier aviso del tablero y la página, sin membresía, redirige a
`/boards`.

**Consecuencias.** Ninguna para instalaciones existentes.

---

## 2026-09-24 — Adjuntos: borrar los ficheros al borrar tarjetas, listas y tableros

**Contexto.** El `onDelete: Cascade` borraba las filas `Attachment` al borrar una
tarjeta, lista o tablero, pero los binarios se quedaban en el volumen para siempre. Una
subida cuya fila fallaba al crearse también dejaba el fichero.

**Decisión.** `services/attachments.ts` lee los nombres en disco y borra en BD en una
transacción y, tras el commit, borra los ficheros con `Promise.allSettled`. Lo usan
`deleteCard`, `deleteList`, `deleteBoard` y los `DELETE` de la API. `uploadAttachment`
borra el fichero si falla el alta de la fila y relanza el error.

**Alternativas descartadas.**
- Borrar ficheros antes del commit: si la transacción fallara, la fila quedaría sin su
  binario.

**Consecuencias.** Los ficheros huérfanos que ya existan en una instalación no se
limpian (decisión del propietario; un barrido necesitaría script con dry-run).

---

## 2026-09-24 — Tarjetas: vencimiento y descripción validados en acciones y API

**Contexto.** Una fecha no parseable se guardaba como `null` y borraba el vencimiento
sin avisar (en la API, con 200/201), y la descripción no tenía límite en la UI.

**Decisión.**
- En la UI, `dueDateSchema` (`""`, `null` o `YYYY-MM-DD` real con `z.iso.date()`); en
  la API, `apiDueDateSchema` (`YYYY-MM-DD` o ISO 8601 con zona). En la API **la cadena
  vacía da 422**, no es sinónimo de `null`: `null` ya existe para quitar la fecha y un
  `""` suele ser un error del cliente. Si algo no valida en `updateCard`, no se guarda
  nada (tampoco la descripción); `setCardDueDate` devuelve `ok:false`.
- `CARD_DESCRIPTION_MAX = 5000` compartido por UI, API e import.

**Alternativas descartadas.**
- `Date.parse` o solo `z.iso.datetime()` para la API: el primero acepta formatos
  ambiguos y el segundo rompería el `YYYY-MM-DD` documentado.

**Consecuencias.** Un cliente de la API que enviara `dueDate: ""` para borrar la fecha
ahora recibe 422 y debe enviar `null`.

---

## 2026-09-24 — Orden: claves de posición validadas y altas al final serializadas

**Contexto.** `moveCard`/`reorderList` guardaban cualquier cadena como posición y una
clave inválida dejaba la lista o el tablero sin poder crear nada (`positionAtEnd`
lanzaba). Además, leer la última posición y crear eran dos pasos, así que dos altas
simultáneas guardaban la misma clave y el arrastre se rompía en esa lista.

**Decisión.**
- `isValidPositionKey` (`ordering.ts`): regex base62 con tope de longitud + la propia
  validación de `fractional-indexing` (la librería sola acepta `'a0 '`). Se valida antes
  de cualquier consulta.
- Altas al final (`createCardAtEnd`, `createListAtEnd`, `createChecklistAtEnd`,
  `createChecklistItemAtEnd`) en una transacción interactiva con `SELECT … FOR UPDATE`
  sobre la fila padre (lista, tablero, tarjeta, checklist). Funciona con el adapter
  `@prisma/adapter-pg`; probado con 10 POST en paralelo.

**Alternativas descartadas.**
- Índice único `(listId, position)`: los movimientos concurrentes también colisionan y
  fallarían en vez de ordenarse.
- Cambiar el contrato de arrastre a `beforeId/afterId`: cambio de API que decide el
  propietario.

**Consecuencias.** Las posiciones inválidas o repetidas que ya existan no se limpian.

---

## 2026-09-24 — Etiquetas: IDOR de toggleCardLabel y colores validados contra la paleta

**Contexto.** `toggleCardLabel` autorizaba por el tablero de la tarjeta, pero aceptaba
una etiqueta de otro tablero (IDOR): un editor de A podía vincular una etiqueta de B
conociendo su id. Además, el operador `in` sobre las paletas aceptaba claves del
prototipo como `'constructor'`, que acababan pintadas como color.

**Decisión.**
- `labelBelongsToBoard` (`services/labels.ts`) tras autorizar; entrada validada con zod.
- Colores validados con `z.enum` de la paleta y `.catch` (etiqueta → `"blue"`, fondo →
  `null`) para seguir siendo tolerantes con el import y los formularios; en lectura,
  `Object.hasOwn` en vez de `in`.

**Alternativas descartadas.**
- Rechazar el import con un color desconocido: un export de otra versión con un color
  que ya no existe dejaría de importarse por un detalle cosmético.

**Consecuencias.** Los `CardLabel` cruzados que ya existan en una instalación no se
limpian (decisión del propietario; un barrido necesitaría script con dry-run).

---

## 2026-09-24 — Adjuntos: errores de disco visibles y 404 uniforme en la descarga

**Contexto.** `deleteAttachmentFile` tenía un `catch` vacío que se tragaba también
`EACCES`/`EROFS` (la fila se borraba y el binario quedaba en disco sin rastro). La
descarga respondía 404 a un id inexistente y 403 a uno de un tablero ajeno (revelaba qué
ids existen) y convertía cualquier error de lectura en 404. Además,
`path.join(process.cwd(), "uploads")` hacía que Turbopack trazara el proyecto entero
hacia `.next/standalone`.

**Decisión.**
- `deleteAttachmentFile` ignora solo `ENOENT`; el resto se registra con `console.error`
  (nombre en disco y código, sin el nombre original) y **no se relanza**: la fila ya está
  borrada y un throw rompería la acción antes de revalidar.
- La descarga busca el adjunto con una sola consulta acotada por membresía; sin
  resultado, `404 Not found` con el mismo cuerpo en ambos casos. `ENOENT` al leer → 404 +
  `console.warn`; cualquier otro código → 500 + `console.error`.
- `/* turbopackIgnore: true */` en el `path.join` del directorio de subida.
- Los tests de integración que invocan Server Actions crean una sesión real (fila
  `Session` + JWT firmado, `test/integration/action-session.ts`) y solo sustituyen la
  lectura de la cookie con un `vi.mock("next/headers")` local, para ejercer de verdad el
  DAL y las guardas de rol sin tocar el stub compartido.

**Alternativas descartadas.**
- Relanzar el error de `unlink`: dejaría la acción a medias tras borrar la fila.
- Mantener el 403 en la descarga: la API v1 ya evita distinguirlos a propósito.
- Mockear el DAL en los tests: no probaría la autorización real.

**Consecuencias.** Un volumen sin permisos de escritura se ve en los logs. La reducción
del trazado NFT no se ha podido comprobar aquí (el build lo ejecuta el integrador): tras
`pnpm build`, `api/attachments/[id]/route.js.nft.json` debería bajar a unas 200 entradas
y `.next/standalone` no debería contener `docs/` ni `test/`.
## 2026-09-24 — Log del cron de copias fuera de `backups/` y URL del instalador según `APP_PORT`

**Contexto.** La revisión de la primera pasada de este lote encontró que el ejemplo de
cron de `docs/operations.md` redirigía el log a `backups/backup.log`. En una instalación
nueva `backups/` no existe (lo crea `backup.sh`), cron abre la redirección antes de
lanzar el script y la copia no se ejecutaba nunca, sin dejar rastro en ningún log.
Además, `install.sh` descartaba la IP de `APP_PORT` y mandaba a `http://<IP>:3000`
aunque la app escuchara solo en `127.0.0.1`, y con `set -o pipefail` un `.env` sin
`APP_PORT` hacía fallar el instalador en el último paso. La documentación decía que la
app «no arranca» sin `SESSION_SECRET`, pero el secreto se comprueba al crear la sesión.
Y el consejo para proteger el asistente reseteado (`APP_PORT=127.0.0.1:3000`) no
protege nada detrás de un proxy, porque `/setup` sigue abierto por el dominio.

**Decisión.**
- El ejemplo de cron escribe en `/home/usuario/orgtable-backup.log`, fuera del repo.
- `install.sh`: con `APP_PORT` de loopback explica cómo llegar por el proxy o por un
  túnel SSH; con otra IP concreta muestra esa IP; con el puerto solo o `0.0.0.0`, la
  IP del servidor. Sin `APP_PORT` usa el 3000 en vez de abortar. Tests en
  `test/ops-scripts.test.ts` con `docker`, `git` y `hostname` falsos.
- `.env.example` e `installation.md` describen lo que pasa de verdad sin
  `SESSION_SECRET`: la app arranca, pero el login y el asistente fallan.
- Reseteo del asistente: cortar el acceso público a `/setup` (parar el proxy o
  bloquear la ruta) y completarlo por túnel SSH, o completarlo justo después.

**Alternativas descartadas.**
- Log dentro de `backups/` pidiendo un `mkdir` previo: es un paso más que se olvida y
  el fallo vuelve a ser silencioso.
- Log en la raíz del repo: aparece como fichero sin seguimiento en `git status` y
  entra en el contexto de build de Docker.
- Hacer que la app se niegue a arrancar sin `SESSION_SECRET`: cambia el
  comportamiento y queda fuera de este lote, que es de documentación y operación.

**Consecuencias.** Quien ya copió el cron anterior debe cambiar la ruta del log (o
crear `backups/` una vez con `mkdir -m 700 backups`). El mensaje final del instalador
depende de `APP_PORT`.

## 2026-09-24 — La documentación se alinea con la licencia propietaria

**Contexto.** `LICENSE` es propietaria (MARA-KASSA SL) desde el commit `27c1ba9`, pero
el ADR 0005, `docs/index.md`, `docs/roadmap.md`, `docs/design-system.md`,
`docs/contributing.md`, `PRODUCT.md`, `CLAUDE.md` y `package.json` seguían diciendo
AGPL u open source.

**Decisión.** Detalle en [ADR 0016](./decisions/0016-licencia-propietaria.md): la
vigente es `LICENSE`, que no se toca. ADR 0005 marcado «sustituida por ADR 0016»;
documentación sin «open source»; `contributing.md` remite a la cláusula de cesión de
`LICENSE` sin copiarla; `package.json` con `"license": "UNLICENSED"`; el CI falla si
reaparece AGPL u «open source» fuera del ADR 0005, el 0016 y este registro.

**Alternativas descartadas.** Restaurar la AGPL (decisión del propietario) y licencia
dual (no se planteó).

**Consecuencias.** Los textos visibles de la app (`app/layout.tsx`, pantalla de login)
los cambia otro lote de esta revisión; hasta que se integre, el paso de licencia del CI
falla por ellos. La cesión de derechos sin firma es dudosa según la ley española: si
entran colaboradores externos, conviene revisarla con un abogado o usar un CLA.

---

## 2026-09-24 — README con estructura fija y documentación de recuperación

**Contexto.** El README no tenía requisitos, comandos, variables ni despliegue, y
seguía diciendo que la interfaz estaba «en construcción» con los hitos 0–13 hechos.
`SECURITY.md` estaba en inglés y remitía al reporte privado de GitHub, que no existe
en repositorios privados. El reseteo del asistente abría `/setup` a cualquiera sin
avisar y se presentaba como forma de «rehacer el administrador», lo que falla con un
email ya existente. `docs/setup-wizard.md` decía «tres cosas» y listaba dos, y
`docs/database.md` enseñaba un `createPrismaClient` sin la guarda de `DATABASE_URL`.

**Decisión.**
- README en seis secciones (qué es, requisitos, instalación, comandos, variables,
  despliegue) más documentación y licencia, remitiendo a `docs/` sin duplicar. La
  instalación en local escribe un `.env` mínimo con `SESSION_SECRET` generado por
  `openssl`, lista para copiar y pegar.
- `SECURITY.md` en español; el canal de reporte queda como `TODO` (email y plazo) que
  desbloquea el propietario. «Última release» pasa a «seguir `main` con
  `scripts/update.sh`».
- Reseteo del asistente: aviso de exposición, email nuevo y comando con
  `$POSTGRES_USER`/`$POSTGRES_DB` del contenedor. Recuperación de un administrador:
  otro ADMIN desde `/admin/users` o `UPDATE` del hash generado con `bcryptjs` coste 12
  dentro del contenedor.

**Alternativas descartadas.**
- Script de recuperación de contraseña: es un caso raro y el procedimiento de dos
  comandos basta; un script más es más superficie que mantener.
- Mantener el badge y la URL del repositorio corregidos: la URL oficial la decide el
  propietario, así que no se cambian (ver consecuencias).

**Consecuencias.** El procedimiento de recuperación y el reseteo se probaron contra un
stack Docker real (el hash generado valida con `bcrypt.compare`). Las URLs de
`install.sh`, README (`aimarmndzz`, badge `Aimarmndz`) y `docs/installation.md`
(`<owner>`) siguen sin apuntar al remoto real; si el repositorio es privado, el
instalador con `curl` anónimo no funciona. Pendiente de decisión del propietario.

---

## 2026-09-24 — Imagen Docker: código de solo lectura y contexto de build sin datos

**Contexto.** El `Dockerfile` terminaba con `chown -R nextjs:nodejs /app`: una capa
nueva que duplicaba `node_modules` (cientos de MB) y dejaba `server.js`, `.next` y
`node_modules` escribibles por el proceso de la app. `.dockerignore` no excluía
`backups/` ni `uploads/`, así que `COPY . .` metía volcados con datos personales en el
builder y en su caché.

**Decisión.**
- Sin `chown -R`: `/app` queda de root. El entrypoint entra con `COPY --chmod=755` y
  solo `.next/cache` se cede a `nextjs` (además de `/data/uploads`, que ya lo estaba).
- `.dockerignore` excluye `backups`, `**/*.sql.gz`, `**/*.tar.gz`, `uploads`, `data`,
  `**/*.pem`, `coverage`, `test`, `scripts` e `install.sh`.

**Alternativas descartadas.**
- `COPY --chown` en cada `COPY`: deja igualmente el código escribible.
- Stage `prod-deps` para reducir `node_modules`: mejora aparte, ya anotada en
  `docs/docker.md`.

**Consecuencias.** Verificado construyendo la imagen: `docker history` ya no tiene la
capa del `chown`; dentro del contenedor `touch server.js` y `node_modules/x` fallan con
`Permission denied` y `.next/cache` y `/data/uploads` son escribibles; el stack arranca
`healthy`, aplica migraciones y sin `EACCES`. El builder no contiene `backups`,
`uploads`, `test`, `scripts` ni `.env`.

---

## 2026-09-24 — Variables del contenedor, CRON_SECRET, proxies de confianza y HTTPS

**Contexto.** El servicio `app` de `docker-compose.yml` solo recibe las variables de
`environment:`, y `CRON_SECRET` no estaba: en Docker los recordatorios respondían
siempre 503. Las variables nuevas de otros cambios (`TRUSTED_PROXY_HOPS`,
`ORGTABLE_TIMEZONE`) tampoco llegarían. La documentación daba por buena
`X-Forwarded-For` para el límite de login, mandaba completar el asistente por
`http://IP:3000` sin advertir de nada y dejaba `SESSION_SECRET=changeme` (8
caracteres, por debajo del mínimo de 16).

**Decisión.**
- `docker-compose.yml` pasa `CRON_SECRET` (vacío por defecto = 503),
  `TRUSTED_PROXY_HOPS` (0 por defecto) y `ORGTABLE_TIMEZONE` (`Atlantic/Canary`). El
  CI comprueba con `docker compose config` que llegan.
- `install.sh` genera `CRON_SECRET` en instalaciones nuevas y lo añade al `.env` de
  las existentes si falta; al terminar avisa de que por HTTP todo viaja sin cifrar.
- El puerto sigue publicado en todas las interfaces por defecto. Para publicarlo solo
  en local se documenta `APP_PORT=127.0.0.1:3000`, que la interpolación del compose ya
  admite, sin variable nueva.
- Se documenta HTTPS como recomendación (no requisito): la cookie de sesión es `Secure`
  cuando la petición llega por HTTPS o con `X-Forwarded-Proto: https`. Ejemplos de
  Caddy y nginx (`X-Forwarded-For $remote_addr`), `TRUSTED_PROXY_HOPS=1` y aviso de
  que Docker se salta `ufw`.
- `docs/installation.md` es la referencia única de variables; `.env.example`,
  `docs/docker.md` y el README remiten a ella.

**Alternativas descartadas.**
- `env_file: .env` en el servicio: metería en el contenedor todas las variables,
  incluidas `POSTGRES_PASSWORD` y las que no necesita.
- Publicar la app en `127.0.0.1` por defecto (o una variable `APP_BIND`): rompe a
  quien entra hoy por `IP:3000`; lo decidió el propietario.
- `SESSION_COOKIE_SECURE`: descartada por el propietario a favor de detectar HTTPS.

**Consecuencias.** Tras actualizar hay que recrear el contenedor
(`docker compose up -d`) para que vea las variables nuevas. Quien tenga `CRON_SECRET`
en el `.env` empieza a recibir recordatorios en cuanto programe el cron. Los
comportamientos de `TRUSTED_PROXY_HOPS`, `ORGTABLE_TIMEZONE` y la cookie `Secure`
dependen del código de otros cambios de esta misma revisión.

---

## 2026-09-24 — Copias de seguridad, restauración y actualización fiables

**Contexto.** `scripts/backup.sh` usaba `sh` sin `pipefail`: si `pg_dump` fallaba
quedaba un `.sql.gz` vacío y el script anunciaba «✓ Backup completado». Desde cron
(directorio `$HOME`) fallaba cada noche sin que nadie lo notara, omitía los adjuntos en
silencio y dejaba las copias legibles por todos (644). `restore.sh` cargaba el volcado
sin `--clean` ni `ON_ERROR_STOP` sobre un esquema ya migrado: mezclaba datos y decía
«✓». `update.sh` migraba producción sin copia previa.

**Decisión.**
- Los tres scripts pasan a `bash` con `set -euo pipefail` y se sitúan en la raíz del
  repositorio, así que funcionan desde cualquier directorio.
- `backup.sh`: `umask 077` (ficheros 600, directorio por defecto 700); escribe en
  `.partial` y solo renombra si el gzip es válido, no está vacío y contiene la marca
  final de `pg_dump`. `pg_dump --clean --if-exists`. Los adjuntos se leen con `exec` si
  la app está en marcha o con un contenedor efímero (`run --rm --no-deps`) si no; solo
  se omiten si no existe `/data/uploads` (código 3), cualquier otro fallo aborta.
- `restore.sh`: valida el fichero antes de preguntar, hace copia previa con
  `backup.sh` en `backups/pre-restore-<fecha>`, para la app y carga
  `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` + volcado en una sola
  transacción con `ON_ERROR_STOP`. Sirve también para volcados antiguos sin `--clean`.
- `update.sh`: `docker compose up -d --wait postgres` y `backup.sh` antes del
  `git pull`; si la copia falla, no actualiza.
- Tests en `test/ops-scripts.test.ts` con un `docker` falso en el `PATH`, y
  `shellcheck` en el CI.

**Alternativas descartadas.**
- Dejar `sh` POSIX: no tiene `pipefail`, que es justo lo que faltaba.
- Restaurar solo con `--clean`: no arregla los volcados ya hechos sin él.
- `chmod 700` sobre cualquier destino que pase el usuario: con `/tmp` (o cron como
  root) rompería el sistema. Solo se fuerza en el directorio por defecto; uno nuevo ya
  nace en 700 por el umask.
- Omitir los adjuntos si la app está parada: es el fallo silencioso que se quería
  quitar.

**Consecuencias.** Verificado con Docker real (proyecto compose desechable): copia
desde `$HOME` con umask 022 da 700/600; con Postgres parado sale con código 1 y sin
ficheros; restaurar devuelve los datos y quita tablas ajenas; fichero inexistente o
corrupto sale con 1 sin tocar nada; el procedimiento de restaurar adjuntos de
`docs/operations.md` funciona. Las copias antiguas siguen con 644: la documentación da
el `chmod` para cerrarlas. `update.sh` no se probó contra un remoto real (solo con los
falsos del test).

---

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
