# Recordatorios de vencimiento

El Hito 11 avisa a quien tiene una tarjeta asignada cuando **vence pronto** (en las
próximas 24 h) o **ya venció**. La decisión técnica está en
[ADR 0015](./decisions/0015-reminders-cron.md).

## Cómo funciona

- Un endpoint `POST /api/cron/reminders` ejecuta la pasada. Genera notificaciones in-app
  (`due.reminder`) para cada asignado de cada tarjeta en ventana, con **deep-link** a la
  tarjeta. Es **idempotente por día**: no repite el mismo aviso a la misma persona aunque
  se invoque varias veces.
- La lógica vive en `app/lib/services/reminders.ts` (`generateDueReminders`).

## Activación

1. Define un secreto en el entorno (desactivado si no existe):

   ```bash
   CRON_SECRET=$(openssl rand -hex 32)
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

Respuestas: `200 {"created":N,"scanned":M}` si todo va bien; `401` si el secreto no casa;
`503` si `CRON_SECRET` no está definido.

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
