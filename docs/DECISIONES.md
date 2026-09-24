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
