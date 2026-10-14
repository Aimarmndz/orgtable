# Administración de usuarios

Por defecto, las cuentas las crea el **administrador** de la instancia desde
`/admin/users`. Si abre el **registro** en `/admin/instance`, cualquiera puede crearse una
cuenta `MEMBER` en `/register` (ver [privacy.md](./privacy.md)). El primer administrador es
quien completa el asistente de configuración inicial (ver
[`docs/setup-wizard.md`](./setup-wizard.md)).

La administración tiene tres pestañas: **Usuarios** (`/admin/users`), **Instancia**
(`/admin/instance`: nombre, registro abierto o cerrado y datos legales del operador) y
**Auditoría** (`/admin/audit`). Solo los usuarios con rol global `ADMIN` ven el enlace
**Administración** en el menú de la cuenta y pueden entrar. La ruta está protegida por
`requireAdmin()` en el servidor (ver [`docs/authorization.md`](./authorization.md)).

## Qué puede hacer el administrador

- **Crear cuentas**: nombre, email, contraseña inicial y rol global
  (`MEMBER` o `ADMIN`). El usuario podrá iniciar sesión con esa contraseña.
- **Cambiar el rol global** de cualquier otra cuenta (promover a admin o degradar).
- **Restablecer la contraseña** de cualquier cuenta (teclea una nueva). Además cierra
  todas las sesiones del usuario y **borra todos sus tokens de API**: es la acción a
  usar si una cuenta puede estar comprometida. El usuario tendrá que crear tokens
  nuevos en `/settings`.
- **Cerrar sesiones** de una cuenta: revoca sus sesiones del navegador, pero **no** sus
  tokens de API.
- **Borrar cuentas** (sus sesiones y tokens se borran en cascada).

## Salvaguardas

Para evitar dejar la instancia sin administración o perder datos por accidente:

- **No puedes cambiar tu propio rol** ni **borrar tu propia cuenta desde esta página**.
  Esto evita que el único administrador se quede sin acceso. Para traspasar la
  administración, promueve antes a otra persona a `ADMIN`. Cada persona sí puede borrar
  su propia cuenta desde *Ajustes › Privacidad y datos*, salvo la última cuenta `ADMIN`.
- **No se puede borrar un usuario que es propietario de tableros**: borrarlo
  arrastraría sus tableros (y todo su contenido) en cascada. El administrador debe
  transferir o borrar esos tableros primero. La acción se bloquea con un aviso.

## Notas de implementación

- Acciones de servidor: [`app/lib/actions/admin.ts`](../app/lib/actions/admin.ts).
- El alta de usuario usa `useActionState` para dar feedback inline y limpiar el
  formulario al crear.
- Las acciones por fila (cambiar rol, restablecer contraseña, borrar) devuelven su
  resultado mediante una redirección con query (`?ok=…` / `?error=…`) que la página
  traduce a un aviso. Así no hace falta un componente cliente con estado por cada
  fila de la tabla.
- Las contraseñas se almacenan con bcrypt (ver [`docs/authentication.md`](./authentication.md)).
