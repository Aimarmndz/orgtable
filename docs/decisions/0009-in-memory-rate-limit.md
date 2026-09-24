# ADR 0009 — Rate limiting en memoria (sin dependencias)

**Estado:** aceptada · **Fecha:** 2026-06-05 · **Relacionada:** [ADR 0007](./0007-pg-notify-over-redis.md)

## Contexto

El login necesita protección contra fuerza bruta. Las soluciones típicas usan Redis o
un servicio dedicado para contar intentos de forma compartida entre instancias.

## Decisión

Implementar un limitador **en memoria** (ventana fija, un `Map` en `globalThis`), sin
dependencias externas. Dos límites para el login (`app/lib/actions/auth.ts`):

- **Por IP**: 10 intentos cada 10 minutos. Solo se aplica si hay una IP fiable.
- **Por cuenta** (email normalizado): 20 intentos fallidos cada 15 minutos, cuente o no
  el email con una cuenta real. Se reinicia tras un login correcto.

### IP del cliente y `TRUSTED_PROXY_HOPS` (revisión 2026-09-24)

`X-Forwarded-For` la escribe el cliente: cada proxy **añade** al final la IP que ve,
pero lo anterior viene de la petición, y Next solo rellena la cabecera si no llega
(`??=`). La versión inicial tomaba el **primer** valor, así que bastaba con enviar una
cabecera distinta en cada intento para que cada uno cayera en un contador nuevo.

Ahora la IP sale de `app/lib/client-ip.ts` con la variable `TRUSTED_PROXY_HOPS` (entero
>= 0, por defecto 0):

- `0`: se ignoran `X-Forwarded-For` y `X-Real-IP`. No hay IP (desde una Server Action no
  se lee la del socket), así que solo rige el límite por cuenta. No se usa un contador
  común `unknown`, que bloquearía el login de todo el mundo a la vez.
- `N > 0`: se toma el N-ésimo valor **contando desde la derecha**, el que añadió el
  proxy de confianza más externo. Con un nginx delante (`$proxy_add_x_forwarded_for`),
  `N = 1`. Solo es seguro si la app **no** es accesible saltándose ese proxy; si lo es,
  el cliente vuelve a elegir su IP.

La misma IP es la que se guarda en `AuditLog.ip`: con `0` queda vacía.

Un intento rechazado solo escribe `auth.login_rate_limited` la **primera** vez en cada
ventana (`firstBlock`), para que un ataque sostenido no llene la tabla de auditoría.

## Justificación

- **Cero infraestructura.** Coherente con el resto del proyecto (ADR 0004/0007): no
  añadir Redis para una app self-hosted que ya intenta minimizar piezas.
- **El caso por defecto es una sola instancia**, donde un contador en memoria es
  exacto y suficiente.
- **Degradación aceptable en multi-instancia.** Con N réplicas el límite efectivo es
  N×10 intentos (y N×20 por cuenta): sigue cortando un ataque de fuerza bruta masivo, solo que de forma
  menos estricta. Es un compromiso razonable frente a añadir un store compartido.

## Consecuencias

- **Bloqueo de cuentas ajenas**: quien conozca un email puede agotar sus 20 intentos y
  dejar a esa persona sin poder entrar hasta 15 minutos. Se acepta a cambio de frenar
  los ataques repartidos entre muchas IPs; un umbral más bajo empeoraría este riesgo.
- Sin IP fiable (`TRUSTED_PROXY_HOPS=0`) no hay límite global: probar una contraseña
  contra muchos emails distintos solo lo frena el coste de bcrypt.
- El estado se pierde al reiniciar el proceso (un atacante gana una ventana nueva tras
  un reinicio). Aceptable para el modelo de amenazas de una instancia self-hosted.
- Si en el futuro hace falta un límite global estricto, se puede sustituir la
  implementación de `app/lib/rate-limit.ts` por una respaldada en Postgres sin tocar
  los sitios que la llaman.
- Documentado en [`docs/operations.md`](../operations.md).
