<div align="center">

# orgtable

### Tu trabajo, en columnas que respiran.

Tableros Kanban de código abierto: tableros, listas y tarjetas con arrastrar y soltar,<br>
en tiempo real. Gratis para personas y empresas en orgtable.aimar.dev, o en tu propio servidor.

[![CI](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml/badge.svg)](https://github.com/Aimarmndz/orgtable/actions/workflows/ci.yml)
[![Licencia: AGPL-3.0-or-later](https://img.shields.io/badge/licencia-AGPL--3.0--or--later-9b411e)](./LICENSE)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17-336791)](https://www.postgresql.org)
[![Docker](https://img.shields.io/badge/self--hosted-Docker-2496ed)](./docs/self-hosting.md)

🇬🇧 [English](./README.md) · 🇪🇸 **Español**

[Funciones](#qué-es) · [Instalación](#instalación) · [Privacidad](#privacidad) · [Documentación](./docs/index.md) · [Licencia](#créditos-y-licencia)

<br>

<img src="docs/screenshots/hero.gif" alt="Un tablero de la organización Northwind Studio en /northwind/website-launch: se arrastra la tarjeta «Team photos» de la lista In progress a Review y después se abre el detalle de «Build the home page» (la interfaz de las capturas está en inglés), con etiquetas, asignados, descripción, vencimiento y checklist" width="960">

<sub>Sin montaje: la app real con datos de ejemplo, grabada en el navegador.</sub>

</div>

> La documentación técnica de [`docs/`](./docs/index.md) está en inglés. Este archivo es la
> versión en español del README principal.

## Qué es

orgtable es una aplicación de tableros Kanban, gratis para personas y empresas. Úsala en
**[orgtable.aimar.dev](https://orgtable.aimar.dev)**: regístrate tú o registra tu
organización, crea las cuentas de tus empleados y comparte tableros en direcciones como
`orgtable.aimar.dev/tu-empresa/hoja-de-ruta`. O levanta tu propia copia en cualquier servidor
con Docker, con un solo comando.

- 🗂️ **Tableros, listas y tarjetas** con arrastrar y soltar, con ratón y con teclado.
  Cada tarjeta tiene etiquetas, vencimiento, checklists, adjuntos, asignados y comentarios.
- ⚡ **Tiempo real.** Lo que mueve una persona lo ven las demás al instante, sin recargar.
- 👥 **Equipos.** Roles por tablero (propietario, editor y lector), notificaciones y
  recordatorios de vencimiento.
- 🏢 **Organizaciones, gratis.** Registra tu empresa, crea las cuentas de tus empleados y dale a
  cada tablero una dirección: `/<espacio>/<tablero>`. Roles de propietario, administrador y
  miembro más **roles personalizados** con 13 permisos, y **equipos** que comparten tableros.
  Ver [`docs/workspaces.md`](./docs/workspaces.md) y [`docs/roles.md`](./docs/roles.md).
- 🛡️ **Seguridad para empresas.** Verificación en dos pasos (TOTP) para todas las cuentas y,
  por organización: 2FA obligatoria, dominios de correo permitidos, las sesiones de sus
  empleados y un **registro de actividad** exportable a CSV.
- 🔗 **Webhooks e integraciones.** Webhooks salientes firmados por organización o por tablero,
  Slack, Discord y Teams, y webhooks entrantes que crean tarjetas. Ver
  [`docs/webhooks.md`](./docs/webhooks.md).
- 💾 **Copias de seguridad desde la app.** Programadas, en tu servidor o en tu propio S3,
  cifradas y restaurables; exportación e importación en un `.zip` portable; y copias de toda la
  instancia para la administración. Ver [`docs/backups.md`](./docs/backups.md).
- 🔎 **Búsqueda, filtros y calendario**, este último con arrastre para cambiar fechas.
- 🔌 **API REST** con tokens personales y claves de organización, de solo lectura o de
  escritura, con caducidad opcional.
- 🔐 **Registro abierto opcional y RGPD de serie.** Páginas legales que se adaptan a cada
  instancia. Cada persona descarga o borra sus datos desde los ajustes.
- 🌍 **En inglés y en español.** La interfaz sigue el idioma del navegador y se puede
  cambiar desde el pie de página o en *Ajustes › Apariencia*. Las traducciones son
  bienvenidas: mira [`locales/README.md`](./locales/README.md).
- 🌗 **Claro y oscuro**, accesible con teclado y lector de pantalla, cómodo en el móvil.
- 🐳 **Autoalojable.** El instalador levanta Docker, genera los secretos y un asistente
  crea la cuenta de administrador.

## La app

<table>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/landing-light.webp" alt="La landing pública en estilo retro: «Your boards. Your server.», un tablero de ejemplo en una ventana y botones para crear una cuenta gratis, registrar una empresa o instalarlo" width="100%"><br><sub><b>Landing</b>. Gratis en la web, o en tu propio servidor.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/register-light.webp" alt="Formulario de registro con la opción «Para mí» o «Para mi organización», y el nombre y la dirección de la organización" width="100%"><br><sub><b>Regístrate</b> tú o tu organización, gratis.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/org-members-light.webp" alt="Miembros de la organización Northwind Studio: tarjetas con el resumen de roles, una tabla con el rol de cada persona y botones para cambiar el rol, poner una contraseña nueva o expulsar, y el formulario para crear una cuenta de empleado" width="100%"><br><sub><b>Tu organización</b>. Empleados, roles y quién puede hacer qué.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/workspace-light.webp" alt="La página de la organización Northwind Studio en /northwind con sus tableros" width="100%"><br><sub><b>Cada organización tiene su dirección</b>: <code>/northwind/website-launch</code>.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/org-general-light.webp" alt="Ajustes de la organización: nombre y dirección, salir de la organización y una zona de peligro para borrarla" width="100%"><br><sub><b>Ajustes de la organización</b>, con zona de peligro.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/admin-light.webp" alt="El resumen de la administración de la instancia: cifras del servicio y cada organización con sus propietarios, miembros, tableros y estado, y botones para suspender o borrar" width="100%"><br><sub><b>Administración</b>. Cifras y todos los espacios, nunca su contenido.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/realtime.gif" alt="Dos navegadores con el mismo tablero: en el de la izquierda Lucía mueve la tarjeta «Monthly newsletter» a To do y en el de la derecha Marcos la ve aparecer al momento" width="100%"><br><sub><b>Tiempo real</b>. Lucía mueve una tarjeta y Marcos la ve al instante.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/card-dark.webp" alt="Detalle de una tarjeta en tema oscuro con etiquetas, asignados, descripción, vencimiento y una checklist a la mitad" width="100%"><br><sub><b>Detalle de tarjeta</b>, en tema oscuro.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/calendar-light.webp" alt="Vista de calendario de octubre con las tarjetas colocadas en su día de vencimiento" width="100%"><br><sub><b>Calendario</b>. Arrastra para cambiar el vencimiento.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/boards-light.webp" alt="Tus tableros agrupados por espacio: los personales y los de la organización Northwind Studio" width="100%"><br><sub><b>Tus tableros</b>, agrupados por espacio.</sub></td>
  </tr>
  <tr>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/settings-light.webp" alt="Página de ajustes con navegación lateral: perfil con tu dirección personal, contraseña y sesiones, tokens de API, apariencia, privacidad y datos" width="100%"><br><sub><b>Ajustes</b>. Perfil, tu dirección, sesiones y tus datos.</sub></td>
    <td width="50%" align="center" valign="top"><img src="docs/screenshots/board-dark.webp" alt="El mismo tablero en tema oscuro" width="100%"><br><sub><b>Tema oscuro</b>, en carbón cálido.</sub></td>
  </tr>
</table>

<details>
<summary>En el móvil</summary>
<br>
<p align="center">
  <img src="docs/screenshots/board-mobile.webp" alt="El tablero en un móvil de 390 px de ancho, con las columnas que se desplazan en horizontal" width="300">
  &nbsp;
  <img src="docs/screenshots/landing-mobile-dark.webp" alt="La landing en un móvil de 390 px de ancho en tema oscuro" width="300">
</p>
</details>

## Requisitos

**Para alojarlo en un servidor:**

- Linux con acceso a internet.
- Docker y Docker Compose v2 (`docker compose`). Si falta Docker, el instalador lo
  instala.
- Un puerto libre, por defecto el `3000`.
- Para un uso real: un dominio y un proxy inverso con HTTPS (Caddy o nginx).

**Para desarrollar:**

- Node.js 22, la versión que usan la CI y la imagen Docker.
- pnpm 11, activado con `corepack enable`. La versión exacta está en `packageManager` de
  `package.json`. No uses npm ni yarn.
- Docker, para la base de datos PostgreSQL de desarrollo.

## Instalación

### En un servidor

```bash
curl -sSL https://raw.githubusercontent.com/Aimarmndz/orgtable/main/install.sh | bash
```

El instalador detecta o instala Docker, genera los secretos (`.env` con permisos `600`)
y levanta la app. Después abre `http://<IP-de-tu-servidor>:3000` y completa el asistente
inicial, que crea la cuenta de administrador.

Por HTTP, la contraseña y la sesión viajan sin cifrar. Para un uso real, pon HTTPS delante
siguiendo [`docs/self-hosting.md`](./docs/self-hosting.md#https-and-domain-reverse-proxy).
La guía completa y la instalación manual están en
[`docs/installation.md`](./docs/installation.md).

### En local, para desarrollar

```bash
git clone https://github.com/Aimarmndz/orgtable.git && cd orgtable
corepack enable
pnpm install

# PostgreSQL de desarrollo en el puerto 5433
docker run -d --name orgtable-dev-pg \
  -e POSTGRES_USER=orgtable -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=orgtable \
  -p 5433:5432 postgres:17-alpine

# .env mínimo: la app exige SESSION_SECRET (16 caracteres como mínimo)
printf 'DATABASE_URL=postgresql://orgtable:devpass@localhost:5433/orgtable\nSESSION_SECRET=%s\n' \
  "$(openssl rand -hex 32)" > .env

pnpm exec prisma migrate dev     # aplica las migraciones
pnpm exec prisma generate        # genera el cliente de Prisma
pnpm dev                         # http://localhost:3000
```

Más detalles en [`docs/contributing.md`](./docs/contributing.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Servidor de desarrollo con recarga en caliente. |
| `pnpm build` / `pnpm start` | Compila para producción y sirve la build. |
| `pnpm lint` | ESLint. |
| `pnpm typecheck` | Comprobación de tipos (`tsc --noEmit`). |
| `pnpm test` | Tests unitarios (sin base de datos). |
| `pnpm test:integration` | Tests de integración contra una PostgreSQL real cuyo nombre acabe en `_test` (ver [`docs/testing.md`](./docs/testing.md)). |
| `pnpm exec prisma migrate dev` | Crea y aplica migraciones en desarrollo. |
| `pnpm exec prisma migrate deploy` | Aplica las migraciones pendientes. El contenedor lo hace solo al arrancar. |
| `scripts/backup.sh` · `scripts/restore.sh` · `scripts/update.sh` | Copia de seguridad, restauración y actualización de una instalación con Docker (ver [`docs/operations.md`](./docs/operations.md)). |
| `POST /api/cron/reminders` · `POST /api/cron/maintenance` | Recordatorios de vencimiento y limpieza de datos caducados. Los dispara un cron externo con `CRON_SECRET` (ver [`docs/operations.md`](./docs/operations.md#scheduled-tasks)). |

## Variables de entorno

La referencia de cada variable está en
[`docs/installation.md`](./docs/installation.md#environment-variables) y la plantilla
comentada, en [`.env.example`](./.env.example).

- **Obligatorias:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`,
  `SESSION_SECRET`.
- **Opcionales:** `APP_PORT`, `CRON_SECRET`, `TRUSTED_PROXY_HOPS` y los ajustes
  `ORGTABLE_*`: `ORGTABLE_TIMEZONE`, `ORGTABLE_UPLOAD_DIR`, `ORGTABLE_REALTIME_PG_NOTIFY`,
  `ORGTABLE_AUDIT_RETENTION_DAYS`, `ORGTABLE_SOURCE_URL`, `ORGTABLE_LANDING` y
  `ORGTABLE_INSTALL_URL`.

## Despliegue

La imagen se construye en el propio servidor con Docker Compose: app y PostgreSQL, sin
exponer puertos de la base de datos. Al arrancar aplica las migraciones.

- Operar en producción, HTTPS y proxy inverso: [`docs/self-hosting.md`](./docs/self-hosting.md).
- Copias de seguridad, restauración, actualizaciones y cron:
  [`docs/operations.md`](./docs/operations.md).
- La imagen y la orquestación: [`docs/docker.md`](./docs/docker.md).
- Abrir la instancia al público con registro gratuito: la lista de comprobación está en
  [`docs/privacy.md`](./docs/privacy.md#checklist-for-opening-a-public-instance).

## Privacidad

orgtable guarda lo necesario para que tengas una cuenta y tus tableros funcionen. No tiene
analíticas, ni anuncios, ni cookies de seguimiento: solo una cookie de sesión (y otra de
idioma si eliges uno).

- **El responsable de los datos es quien opera cada instancia.** Rellena sus datos en
  *Administración › Instancia* y las páginas `/legal/privacidad`, `/legal/condiciones`,
  `/legal/cookies` y `/legal/aviso-legal` los muestran. Lo que falte aparece como «sin
  indicar», nunca inventado.
- **Cada persona ejerce sus derechos sola**, desde *Ajustes › Privacidad y datos*: descarga
  todos sus datos en JSON o borra su cuenta con sus tableros y adjuntos.
- **Plazos cortos y automáticos.** Las sesiones caducan a los 7 días, las notificaciones
  se borran a los 180 y el registro de seguridad a los 90 (configurable).

Detalle técnico y base legal en [`docs/privacy.md`](./docs/privacy.md).

## Documentación

Toda la documentación está en [`docs/`](./docs/), con índice en
[`docs/index.md`](./docs/index.md): arquitectura, base de datos, autenticación y
autorización, [API pública](./docs/api/public-api.md),
[registro de decisiones](./docs/DECISIONES.md) y [cómo contribuir](./docs/contributing.md).
Está en inglés, igual que el código.

## Contribuir

Las aportaciones son bienvenidas. Lee antes [`docs/contributing.md`](./docs/contributing.md).
El código, los comentarios, la documentación y los commits van en inglés. Cada commit
lleva `Signed-off-by` ([DCO](https://developercertificate.org/), con `git commit -s`).

Las traducciones son especialmente bienvenidas: añadir un idioma consiste en copiar una
carpeta y traducir archivos JSON, sin tocar código. Mira
[`locales/README.md`](./locales/README.md).

Los problemas de seguridad van por [`SECURITY.md`](./SECURITY.md), nunca en issues
públicas.

## Créditos y licencia

Creado por **Aimar** ([github.com/Aimarmndz](https://github.com/Aimarmndz)). Hecho con
[Next.js](https://nextjs.org), [React](https://react.dev),
[Prisma](https://www.prisma.io), [PostgreSQL](https://www.postgresql.org),
[dnd-kit](https://dndkit.com) y [Tailwind CSS](https://tailwindcss.com). Usa las
tipografías [Bricolage Grotesque](https://fonts.google.com/specimen/Bricolage+Grotesque),
[Figtree](https://fonts.google.com/specimen/Figtree) y
[Geist Mono](https://fonts.google.com/specimen/Geist+Mono), todas con licencia SIL OFL 1.1.

Licencia **GNU AGPL-3.0-or-later** con un término adicional de la sección 7(b): las
versiones modificadas tienen que conservar la atribución «Created by Aimar
(github.com/Aimarmndz)» en el pie de las páginas públicas y en «Acerca de» de los ajustes.
Puedes usarlo, modificarlo y alojarlo, también con fines comerciales. Si lo ofreces como
servicio, tienes que publicar tu código bajo la misma licencia. Ver [`LICENSE`](./LICENSE).
