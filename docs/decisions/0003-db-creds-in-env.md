# ADR 0003 — Credenciales de base de datos en `.env` (no en el setup wizard)

**Estado:** aceptada · **Fecha:** 2026-06-04

## Contexto

orgtable se instala con un comando (estilo Coolify/Dokploy) y se configura por web la
primera vez. Surge la pregunta: ¿dónde se definen las credenciales de PostgreSQL?

- **Modelo Nextcloud/WordPress**: la app arranca sin base de datos y un asistente web
  pide host/usuario/contraseña de la BD, los escribe a disco y se reinicia.
- **Modelo Coolify/Dokploy**: el instalador genera las credenciales antes de levantar;
  el asistente web solo recoge datos de la aplicación (usuario admin, nombre).

## Decisión

Adoptar el **modelo Coolify**: `install.sh` genera `POSTGRES_PASSWORD` y
`SESSION_SECRET` aleatorios (`openssl rand`) en `.env` antes de `docker compose up`. La
app **siempre** arranca con la base de datos conectada. El setup wizard solo pide el
**usuario administrador** y el **nombre de la instancia**.

## Justificación

- La app Next necesita conexión a PostgreSQL para arrancar el propio wizard (que
  guarda el admin en la tabla `users`). El modelo Nextcloud implicaría arrancar sin
  DB, escribir config en el sistema de archivos del contenedor y reiniciar —frágil y
  con condiciones de carrera en un contenedor inmutable—.
- El usuario nunca teclea ni ve credenciales de infraestructura: menos errores, más
  seguridad.

## Consecuencias

- El estado "ya configurado" vive en la base de datos (`InstanceConfig.setupCompletedAt`),
  no en un archivo. Ver `docs/setup-wizard.md`.
- Si alguien borra esa fila manualmente, el wizard reaparece (aceptable: es su servidor).
