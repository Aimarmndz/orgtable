# ADR 0016 — Licencia propietaria (MARA-KASSA SL)

**Estado:** sustituida el 2026-10-14 (ver [`docs/DECISIONES.md`](../DECISIONES.md#2026-10-14--licencia-agpl-30-or-later-con-atribución)) · **Fecha:** 2026-08-05 · **Sustituye a:** [ADR 0005](./0005-agpl.md)

> Esta decisión ya no está vigente: el 2026-10-14 el proyecto volvió a la AGPL
> (AGPL-3.0-or-later con un término de atribución). La licencia vigente es la de
> [`LICENSE`](../../LICENSE). Se conserva como registro histórico.

## Contexto

El proyecto se publicó al principio bajo AGPL-3.0 (ADR 0005). El 2026-08-05 el
propietario sustituyó el texto de `LICENSE` por una licencia propietaria a nombre de
MARA-KASSA SL (commit `27c1ba9`), pero la documentación, el `package.json` y algunos
textos de la app seguían diciendo AGPL u «open source». Esta ADR deja constancia de la
decisión y alinea el resto con ella.

## Decisión

- La licencia vigente es la de [`LICENSE`](../../LICENSE): todos los derechos reservados
  por MARA-KASSA SL, uso restringido a personas autorizadas y cesión a la empresa de los
  derechos sobre las aportaciones. El texto de `LICENSE` es la única fuente; el resto de
  documentos remite a él sin copiarlo.
- `package.json` declara `"license": "UNLICENSED"` (el valor que npm reserva para
  software sin licencia de uso pública).
- La documentación y los textos visibles dejan de describir el proyecto como open source.
- El CI falla si reaparecen referencias a la licencia anterior fuera de esta ADR, de la
  ADR 0005 y del registro de decisiones.

## Alternativas descartadas

- **Mantener la AGPL-3.0 y restaurar `LICENSE`.** Descartada por el propietario al
  hacer el cambio.
- **Licencia dual (AGPL + comercial).** No se planteó; exigiría volver a publicar el
  código bajo AGPL.

## Consecuencias

- Las copias que se distribuyeron mientras regía la AGPL-3.0 siguen bajo esa licencia
  para quien las recibió: el cambio no es retroactivo.
- La cesión de derechos por aportaciones que incluye `LICENSE` se acepta al contribuir,
  sin firma. Su validez frente a la ley española de propiedad intelectual es dudosa; si
  entran colaboradores externos conviene que un abogado la revise o firmar un acuerdo de
  contribución (CLA).
- `install.sh` y la documentación de instalación siguen apuntando a un repositorio
  público de GitHub; si el repositorio es privado, la instalación con `curl` anónimo no
  funciona. Lo decide el propietario.
