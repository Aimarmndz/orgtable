# Política de seguridad

## Versiones con soporte

orgtable se desarrolla en la rama `main` y no publica versiones numeradas: las
correcciones de seguridad llegan a `main`. Mantén tu instalación al día con
`scripts/update.sh`, que hace una copia de seguridad y actualiza a lo último de `main`
(ver [`docs/operations.md`](./docs/operations.md#actualizaciones)).

## Informar de una vulnerabilidad

**No** abras un issue público para un problema de seguridad.

<!-- TODO: falta el canal privado de reporte: un email de seguridad y el plazo de
respuesta. El reporte privado de GitHub solo existe en repositorios públicos, así que
no sirve si el repositorio es privado. Lo desbloquea el propietario (MARA-KASSA SL)
decidiendo el email y el plazo. -->

Mientras no haya un canal publicado, contacta directamente con el propietario del
repositorio.

Incluye, si puedes: la versión o el commit afectado, una descripción, los pasos para
reproducirlo y el impacto.

## Postura y endurecimiento

La postura de seguridad del proyecto, el resultado de la última auditoría y las
recomendaciones de endurecimiento están en [`docs/security.md`](./docs/security.md).
La guía de operación (TLS/proxy inverso, copias de seguridad, secretos) está en
[`docs/self-hosting.md`](./docs/self-hosting.md) y
[`docs/operations.md`](./docs/operations.md).
