# Administración de usuarios

orgtable no tiene registro abierto: las cuentas las crea el **administrador** de la
instancia desde `/admin/users`. El primer administrador es quien completa el
asistente de configuración inicial (ver [`docs/setup-wizard.md`](./setup-wizard.md)).

Solo los usuarios con rol global `ADMIN` ven el enlace **Administración** en la
cabecera y pueden entrar a `/admin/users`. La ruta está protegida por
`requireAdmin()` en el servidor (ver [`docs/authorization.md`](./authorization.md)).

## Qué puede hacer el administrador

- **Crear cuentas**: nombre, email, contraseña inicial y rol global
  (`MEMBER` o `ADMIN`). El usuario podrá iniciar sesión con esa contraseña.
- **Cambiar el rol global** de cualquier otra cuenta (promover a admin o degradar).
- **Restablecer la contraseña** de cualquier cuenta (teclea una nueva).
- **Borrar cuentas**.

## Salvaguardas

Para evitar dejar la instancia sin administración o perder datos por accidente:

- **No puedes cambiar tu propio rol** ni **borrar tu propia cuenta**. Esto evita que
  el único administrador se quede sin acceso. Para traspasar la administración,
  promueve antes a otra persona a `ADMIN`.
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
