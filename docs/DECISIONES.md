# Registro de decisiones

Decisiones técnicas del proyecto, las más recientes arriba. Cada entrada lleva fecha,
contexto, decisión, alternativas descartadas y consecuencias. Las decisiones de
arquitectura anteriores a este registro (ADR 0001–0015) siguen en
[`docs/decisions/`](./decisions/); este archivo es el registro vivo a partir de
2026-09-24.

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
