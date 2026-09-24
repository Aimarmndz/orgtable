# Recordatorios de vencimiento

El Hito 11 avisa a quien tiene una tarjeta asignada cuando **vence pronto** (en las
próximas 24 h) o **acaba de vencer**. La decisión técnica está en
[ADR 0015](./decisions/0015-reminders-cron.md).

## Cómo funciona

- Un endpoint `POST /api/cron/reminders` ejecuta la pasada. Genera notificaciones in-app
  (`due.reminder`) para cada asignado de cada tarjeta en ventana, con **deep-link** a la
  tarjeta. Se puede invocar varias veces sin duplicar avisos:
  - **Vence pronto** (vence hoy o en las próximas 24 h): como mucho un aviso al día por
    tarjeta y persona.
  - **Tarea vencida**: un **único** aviso tras vencer, y solo si venció en los **últimos 7
    días**. Una tarjeta olvidada hace meses no avisa cada día ni engorda la pasada.
- Solo se avisa a los asignados que **siguen siendo miembros** del tablero (expulsar a
  alguien borra sus asignaciones; ver [docs/card-collaboration.md](./card-collaboration.md)).
- **Los días se cuentan en UTC**, no en la zona del servidor: `dueDate` es una fecha de
  calendario (`YYYY-MM-DD`) guardada a medianoche UTC. Una tarjeta pasa a «vencida» al
  empezar el día UTC siguiente al de su vencimiento, y la fecha del aviso se formatea en
  UTC (`es-ES`) para que coincida con la elegida.
- La lógica vive en `app/lib/services/reminders.ts` (`generateDueReminders`).

## Activación

1. Define un secreto en el entorno (desactivado si no existe):

   ```bash
   CRON_SECRET=$(openssl rand -hex 32)
   ```

   En Docker, añádelo al `.env` que lee `docker compose` y recrea el contenedor para que
   lo reciba (un `restart` no relee el entorno):

   ```bash
   docker compose up -d
   ```

2. Programa una llamada periódica (p. ej. diaria) desde un **cron externo**, enviando el
   secreto como Bearer:

   ```bash
   curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" \
        https://tu-instancia/api/cron/reminders
   ```

   Ejemplo de crontab (cada día a las 8:00):

   ```cron
   0 8 * * * curl -fsS -X POST -H "Authorization: Bearer XXXX" https://tu-instancia/api/cron/reminders
   ```

Respuestas: `200 {"created":N,"scanned":M}` si todo va bien (`created` solo cuenta las
notificaciones que se guardaron de verdad; `scanned`, las tarjetas en ventana); `401` si
el secreto no casa; `503` si `CRON_SECRET` no está definido. Los tres casos están
cubiertos en `test/integration/cron-reminders.int.test.ts`.

## Seguridad

- El secreto se compara en **tiempo constante** (`crypto.timingSafeEqual`) para no filtrar
  información por el tiempo de respuesta.
- El endpoint no expone datos: solo dispara la generación de notificaciones.

## Reprogramar desde el calendario

Como complemento (mismo hito), en la **vista de calendario** puedes **arrastrar** una
tarjeta a otro día para cambiar su vencimiento (si tienes permiso de edición). Usa una
acción enfocada `setCardDueDate` que solo toca la fecha. Ver
[`docs/calendar.md`](./calendar.md).

## Límites y evolución (backlog)

- **Email / Web Push**: hoy los recordatorios son in-app. Encajarían como otro consumidor
  de `notify()` (SMTP opcional por variables de entorno), sin cambiar este diseño.
- **Preferencias por usuario** (qué avisar y por dónde): ampliación natural.
