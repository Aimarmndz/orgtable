# Cambios

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y versiones
[SemVer](https://semver.org/lang/es/). Mientras sea `0.x`, una versión menor puede traer
cambios incompatibles; se avisa en «Cambiado». El porqué de cada decisión está en
[`docs/DECISIONES.md`](./docs/DECISIONES.md).

## [0.2.0] — 2026-10-14

### Añadido

- Registro abierto opcional por instancia (`/register`), con consentimiento y límites
  anti-abuso. Cerrado por defecto.
- Datos legales del operador en *Administración › Instancia* y páginas públicas de
  privacidad, condiciones, cookies y aviso legal.
- Ajustes rediseñados: perfil, cambio de contraseña, sesiones abiertas, apariencia,
  descarga de los datos personales y borrado de la cuenta.
- Limpieza programada `POST /api/cron/maintenance` y variable
  `ORGTABLE_AUDIT_RETENTION_DAYS`.
- Menú de la cuenta en la barra superior. Los tableros muestran sus tarjetas y miembros.
- `robots.txt` según la instancia, Open Graph e icono propio.
- README con capturas y GIF, README en inglés y `docs/privacy.md`.

### Cambiado

- **Licencia: AGPL-3.0-or-later** con un término de atribución (sección 7(b)). Sustituye
  a la licencia propietaria anterior.
- Tipografías Bricolage Grotesque y Figtree (OFL) en lugar de Cabinet Grotesk y Satoshi.
- `ORGTABLE_SOURCE_URL` decide el enlace «Código fuente». Si despliegas una versión
  modificada, apúntalo a tu fork.
- La migración `20261014171630_registration_and_legal` se aplica sola al arrancar.

## [0.1.0]

Hitos 0–13: tableros, listas y tarjetas con arrastrar y soltar, multiusuario con roles,
tiempo real, adjuntos, búsqueda, calendario, notificaciones, API pública con tokens,
colaboración en la tarjeta, recordatorios y filtros. Detalle en
[`docs/roadmap.md`](./docs/roadmap.md).
