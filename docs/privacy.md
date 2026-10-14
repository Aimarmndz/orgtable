# Privacidad, registro abierto y RGPD

Cómo trata orgtable los datos personales y qué tiene que hacer quien opera una instancia,
sea la oficial o una autoalojada. Las páginas legales que ven las personas usuarias
(`/legal/*`) se generan a partir de este comportamiento y de los datos que el admin
rellena en **Administración › Instancia**. Este documento es su referencia técnica.

> Los textos legales de la app describen lo que hace el código, pero no son
> asesoramiento jurídico. Si abres el registro al público, haz que un profesional los
> revise con tus datos reales.

## Quién es el responsable

El responsable del tratamiento es **quien opera la instancia**, no el autor del software.
Cada instancia indica el suyo en `/admin/instance`:

| Campo | Obligatorio | Dónde sale |
|---|---|---|
| Responsable (nombre o razón social) | Para abrir el registro | Privacidad, condiciones, aviso legal y el formulario de registro |
| Email de contacto | Para abrir el registro | Privacidad, condiciones, aviso legal |
| NIF | No | Aviso legal (art. 10 LSSI, si aplica) |
| Dirección postal | No | Aviso legal |
| Dónde se alojan los datos | No, pero recomendado | Privacidad: el proveedor actúa como encargado del tratamiento |
| Días de copias de seguridad | No (0 = no haces copias) | Privacidad. Tiene que coincidir con tu rotación real (`scripts/backup.sh`) |

Lo que se deja vacío aparece como «sin indicar por el operador»: las páginas nunca
inventan datos. Cada vez que cambia un dato legal, `legalUpdatedAt` pasa a ser la fecha
de «última actualización» de las páginas.

## Registro abierto

Está **cerrado por defecto**: en una instancia privada las cuentas las crea el admin. Se
abre en `/admin/instance`, y solo si están el responsable y el email de contacto. El
servidor lo vuelve a comprobar en cada alta (`isRegistrationOpen()`): si alguien vacía
esos datos, el registro se cierra solo.

En `/register`:

- **Consentimiento informado.** Checkbox obligatorio, sin marcar por defecto, con enlaces
  a la política y a las condiciones. Se guarda la fecha en `User.termsAcceptedAt`. Junto
  al botón va una primera capa informativa: responsable, finalidad y derechos.
- **Las cuentas nuevas son MEMBER.** Nadie puede registrarse como admin.
- **Antiabuso, sin terceros**:
  - Campo trampa invisible (honeypot).
  - 5 altas por hora y por IP, solo con `TRUSTED_PROXY_HOPS > 0`.
  - 30 altas por hora en toda la instancia. Durante una oleada de bots, la gente real
    tampoco puede registrarse hasta que pase la hora; se ve en la auditoría como
    `auth.register_rate_limited`.
- **Sin verificación por email.** Necesita SMTP, que sigue en el
  [backlog](./roadmap.md). Por eso el formulario dice si un email ya tiene cuenta. El
  límite de altas frena la enumeración masiva.

## Qué se guarda y cuánto tiempo

| Dato | Base legal | Conservación |
|---|---|---|
| Cuenta: nombre, email, hash bcrypt, rol, `termsAcceptedAt` | Contrato (6.1.b). La fecha de aceptación, interés legítimo en acreditarla (6.1.f) | Hasta que se borra la cuenta |
| Contenido: tableros, listas, tarjetas, comentarios, asignaciones, adjuntos | Contrato (6.1.b) | Hasta que se borra |
| Sesiones: user-agent, fechas | Contrato (6.1.b) | 7 días de validez; cerradas o caducadas, 30 días más |
| Notificaciones | Contrato (6.1.b) | 180 días |
| Tokens de API: nombre, prefijo, hash | Contrato (6.1.b) | Hasta que se revocan o se borra la cuenta |
| Auditoría: eventos de seguridad, con IP si `TRUSTED_PROXY_HOPS > 0` | Interés legítimo en la seguridad (6.1.f) | `ORGTABLE_AUDIT_RETENTION_DAYS`, 90 días por defecto |

Los plazos salen de constantes del código (`app/lib/services/maintenance.ts` y
`SESSION_MAX_AGE_DAYS` en `app/lib/session.ts`). La política de privacidad los lee de ahí,
así que no puede desincronizarse.

### Limpieza periódica

La borra `POST /api/cron/maintenance`, protegido con el mismo `CRON_SECRET` que los
recordatorios. **Prográmalo una vez al día**; sin él, los plazos de arriba no se cumplen:

```bash
# crontab del host, a las 04:15
15 4 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://tu-instancia/api/cron/maintenance
```

Responde con lo que ha borrado (`auditLogsDeleted`, `sessionsDeleted`,
`notificationsDeleted`). Más detalles de operación en [operations.md](./operations.md).

## Derechos de las personas usuarias

Todos se ejercen solos, desde **Ajustes**:

- **Acceso y portabilidad** (arts. 15 y 20). *Privacidad y datos › Descargar .json*
  (`GET /api/account/export`, solo con sesión de navegador, no con tokens). Incluye:
  - la cuenta;
  - los tableros propios completos, con los metadatos de los adjuntos;
  - la pertenencia a tableros ajenos;
  - los comentarios propios y las asignaciones;
  - las notificaciones, las sesiones y los tokens (sin hash);
  - sus entradas de auditoría.

  Nunca incluye hashes ni datos de otras personas.
- **Rectificación** (art. 16). *Perfil*. Cambiar el email pide la contraseña actual.
- **Supresión** (art. 17). *Privacidad y datos › Borrar mi cuenta*, con contraseña. Borra:
  - los tableros que la persona creó, con sus listas, tarjetas y los ficheros de sus
    adjuntos en disco;
  - en cascada, sus sesiones, tokens, membresías, asignaciones, comentarios y
    notificaciones;
  - el `detail` de las filas de auditoría que la tenían como objetivo; esas filas quedan
    sin usuario.

  La última cuenta ADMIN no puede borrarse. Las notificaciones de **otras** personas
  pueden conservar su nombre hasta que caducan (180 días).
- **Oposición y limitación**: por el email de contacto del responsable.

## Cookies

Solo almacenamiento técnico imprescindible (art. 22.2 LSSI), así que no hay banner:

- Cookie `session`: HttpOnly, SameSite=Lax y Secure si llega por HTTPS. Dura 7 días.
- `localStorage.theme`: preferencia de tema; no sale del navegador.

Si añades analítica o cualquier otro script de terceros, necesitarás un banner de
consentimiento **antes** de cargarlo y ampliar la política.

## Lista para abrir una instancia pública

1. HTTPS delante de la app ([self-hosting.md](./self-hosting.md)) y `TRUSTED_PROXY_HOPS`
   ajustado, para que el límite de altas por IP funcione.
2. `CRON_SECRET` y los dos cron programados: recordatorios y mantenimiento.
3. Copias de seguridad con una rotación que coincida con el campo «Días de copias».
4. Datos legales completos en `/admin/instance` y los textos revisados por un
   profesional.
5. Si has modificado el código, `ORGTABLE_SOURCE_URL` apuntando a tu fork: la AGPL obliga a
   ofrecérselo a quien usa la app.
6. Abre el registro en `/admin/instance`.
