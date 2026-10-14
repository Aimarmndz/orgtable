# Política de seguridad

## Versiones con soporte

orgtable se desarrolla en la rama `main` y no publica versiones numeradas: las
correcciones de seguridad llegan a `main`. Mantén tu instalación al día con
`scripts/update.sh`, que hace una copia de seguridad y actualiza a lo último de `main`
(ver [`docs/operations.md`](./docs/operations.md#actualizaciones)).

## Informar de una vulnerabilidad

**No** abras un issue público para un problema de seguridad.

Usa el reporte privado de GitHub: pestaña **Security** del repositorio →
**Report a vulnerability** ([enlace directo](https://github.com/Aimarmndz/orgtable/security/advisories/new)).
Solo funciona cuando el repositorio es público; mientras sea privado, escribe al autor
desde su perfil, [github.com/Aimarmndz](https://github.com/Aimarmndz).

<!-- TODO: plazo de respuesta comprometido. Lo decide Aimar; mientras tanto no se
promete ninguno. -->

Incluye, si puedes: la versión o el commit afectado, una descripción, los pasos para
reproducirlo y el impacto.

## Postura y endurecimiento

La postura de seguridad del proyecto, el resultado de la última auditoría y las
recomendaciones de endurecimiento están en [`docs/security.md`](./docs/security.md).
La guía de operación (TLS/proxy inverso, copias de seguridad, secretos) está en
[`docs/self-hosting.md`](./docs/self-hosting.md) y
[`docs/operations.md`](./docs/operations.md).
