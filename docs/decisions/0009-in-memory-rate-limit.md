# ADR 0009 — Rate limiting en memoria (sin dependencias)

**Estado:** aceptada · **Fecha:** 2026-06-05 · **Relacionada:** [ADR 0007](./0007-pg-notify-over-redis.md)

## Contexto

El login necesita protección contra fuerza bruta. Las soluciones típicas usan Redis o
un servicio dedicado para contar intentos de forma compartida entre instancias.

## Decisión

Implementar un limitador **en memoria** (ventana fija, un `Map` en `globalThis`), sin
dependencias externas. Límite: 10 intentos por IP cada 10 minutos para el login.

## Justificación

- **Cero infraestructura.** Coherente con el resto del proyecto (ADR 0004/0007): no
  añadir Redis para una app self-hosted que ya intenta minimizar piezas.
- **El caso por defecto es una sola instancia**, donde un contador en memoria es
  exacto y suficiente.
- **Degradación aceptable en multi-instancia.** Con N réplicas el límite efectivo es
  N×10 intentos: sigue cortando un ataque de fuerza bruta masivo, solo que de forma
  menos estricta. Es un compromiso razonable frente a añadir un store compartido.

## Consecuencias

- El estado se pierde al reiniciar el proceso (un atacante gana una ventana nueva tras
  un reinicio). Aceptable para el modelo de amenazas de una instancia self-hosted.
- Si en el futuro hace falta un límite global estricto, se puede sustituir la
  implementación de `app/lib/rate-limit.ts` por una respaldada en Postgres sin tocar
  los sitios que la llaman.
- Documentado en [`docs/operations.md`](../operations.md).
