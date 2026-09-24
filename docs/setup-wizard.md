# Asistente de configuración inicial (Setup Wizard)

Esta guía está dirigida a **auto-hospedadores** y **contribuidores** de orgtable.
Explica qué es el asistente de configuración inicial, cómo decide si debe
mostrarse y por qué su lógica es segura frente a envíos duplicados.

Relacionado: [`docs/installation.md`](./installation.md) ·
[`docs/authentication.md`](./authentication.md) ·
[`docs/decisions/0003-db-creds-in-env.md`](./decisions/0003-db-creds-in-env.md)

## Qué es

El **setup wizard** es el asistente que aparece **la primera vez** que se abre
una instancia recién instalada de orgtable. Vive en la ruta `/setup` y su único
propósito es dejar la instancia lista para usarse creando la primera cuenta de
administrador.

Te pide cuatro datos:

1. **Nombre de la instancia** — una etiqueta para tu equipo o servidor
   (p. ej. "Mi equipo"). Máximo 60 caracteres.
2. **Tu nombre** — máximo 60 caracteres.
3. **Tu email** — será el usuario del administrador.
4. **Una contraseña** — entre 8 y 200 caracteres.

El formulario es minimalista a propósito:

> Este asistente solo aparece una vez. Crea tu cuenta de administrador.

### Lo que el wizard NO pide

El asistente **no pide credenciales de base de datos**. La conexión a PostgreSQL
no se configura aquí: la genera el script `install.sh` y se inyecta por variables
de entorno en tiempo de arranque. El razonamiento detrás de esta decisión está
documentado en
[`docs/decisions/0003-db-creds-in-env.md`](./decisions/0003-db-creds-in-env.md).
Para el proceso de instalación completo, consulta
[`docs/installation.md`](./installation.md).

Cuando el wizard se ejecuta, la base de datos **ya está conectada y migrada**;
de hecho, el wizard necesita la base de datos para poder consultar y escribir su
fuente de verdad.

## Fuente de verdad: `InstanceConfig.setupCompletedAt`

Toda la lógica del asistente gira en torno a un único campo de la base de datos.
La configuración global de la instancia se guarda en una **fila única** del
modelo `InstanceConfig` (su `id` es siempre el valor fijo `"singleton"`):

```prisma
// prisma/schema.prisma
model InstanceConfig {
  id               String    @id @default("singleton")
  instanceName     String
  setupCompletedAt DateTime?
  createdAt        DateTime  @default(now())
}
```

El campo clave es `setupCompletedAt`:

- Mientras es **`null`**, la instancia se considera **sin configurar** y el
  wizard (`/setup`) está **activo**.
- En cuanto tiene una **fecha**, la instancia está configurada y el wizard queda
  **bloqueado para siempre**.

Esa pregunta — "¿está la instancia ya configurada?" — se centraliza en una sola
función del Data Access Layer, `isSetupComplete()`:

```ts
// app/lib/dal.ts
export const getInstanceConfig = cache(async () => {
  return prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
});

/** true si el setup wizard ya se completó. */
export const isSetupComplete = cache(async () => {
  const config = await getInstanceConfig();
  return Boolean(config?.setupCompletedAt);
});
```

`isSetupComplete()` simplemente comprueba si `setupCompletedAt` tiene valor.
Está envuelta en `cache()` de React, así que dentro de una misma petición la
consulta solo se ejecuta una vez aunque se llame desde varios sitios.

## Flujo de gating (control de acceso)

El estado de `setupCompletedAt` determina a dónde se redirige al visitante,
formando un control cruzado entre el wizard y el resto de la app:

- **`/setup`** redirige a **`/login`** si el setup **ya está completo** (no tiene
  sentido reconfigurar una instancia ya inicializada).
- Las páginas de **login** y todo el **área autenticada** redirigen a
  **`/setup`** si el setup **NO está completo** (no tiene sentido iniciar sesión
  en una instancia sin administrador).

La parte del lado de `/setup` se ve en su propia página:

```tsx
// app/setup/page.tsx
export default async function SetupPage() {
  // Si ya se completó el setup, el wizard queda bloqueado para siempre.
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SetupForm />
    </main>
  );
}
```

El resultado es que solo existe exactamente **un** estado válido por instancia: o
bien estás en el wizard (sin configurar), o bien estás en login / la app
(configurada). Nunca ambos a la vez.

## La acción `completeSetup`

Cuando envías el formulario, se ejecuta la Server Action `completeSetup`
(`app/lib/actions/setup.ts`). Sus pasos son:

### 1. Corte temprano

Si `isSetupComplete()` ya es cierto, la acción hace `redirect("/login")` antes de
validar nada y de gastar el hash de bcrypt. Hace falta aunque `/setup` ya redirija:
el ID de la acción sigue en el bundle de la página y se puede invocar a mano. No
sustituye a la comprobación dentro de la transacción, que es la definitiva.

### 2. Validación con zod

Los cuatro campos se validan con `setupSchema` antes de tocar la base de datos.
Si la validación falla, la acción devuelve un error legible y no hace nada más:

```ts
const parsed = setupSchema.safeParse({
  instanceName: formData.get("instanceName"),
  name: formData.get("name"),
  email: formData.get("email"),
  password: formData.get("password"),
});
if (!parsed.success) {
  return { error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
}
```

La contraseña se hashea (`hashPassword`) **antes** de abrir la transacción.

### 3. Transacción serializada

El núcleo es `completeInstanceSetup` (`app/lib/services/setup.ts`), una transacción
de Prisma (`prisma.$transaction`) que hace, en este orden:

1. **Toma un advisory lock de transacción**:
   `pg_advisory_xact_lock(hashtext('orgtable:setup'))`. Un segundo envío simultáneo
   espera aquí hasta que el primero confirme o aborte.
2. **Recomprueba `setupCompletedAt`.** Si ya tiene fecha, devuelve
   `{ ok: false, reason: "ALREADY_SETUP" }` (no lanza) y no escribe nada.
3. **Crea el usuario administrador** con la contraseña ya hasheada, el email en
   minúsculas y el rol `ADMIN`.
4. **Marca `setupCompletedAt`** con la fecha actual y guarda el `instanceName`
   (mediante `upsert`, por si la fila `InstanceConfig` ya existía sin completar), y
   devuelve `{ ok: true, userId }`.

La recomprobación del paso 2 **solo protege porque el lock del paso 1 serializa los
envíos**. Con el aislamiento por defecto de PostgreSQL (READ COMMITTED), sin el lock
dos envíos casi simultáneos leerían los dos «sin configurar» y crearían dos
administradores. No quites el lock: el porqué completo y las alternativas descartadas
están en [`DECISIONES.md`](./DECISIONES.md) («Setup: advisory lock, corte temprano y
causa en el log»), y `test/integration/setup.int.test.ts` lo comprueba con envíos
simultáneos.

Como todo ocurre en una transacción, si algo falla a mitad no se queda un estado
inconsistente: o se crean el administrador y la marca de configuración juntos, o
no se crea nada.

### 4. Auto-login y redirección

Tras la transacción, la acción crea la sesión (auto-login con `createSession`) y
redirige a `/boards`:

```ts
await createSession(outcome.userId);
redirect("/boards");
```

### Por qué `redirect()` se llama FUERA del try/catch

Esto es deliberado y conviene entenderlo si vas a modificar la acción:

```ts
// app/lib/actions/setup.ts
try {
  // ... la transacción ...
} catch (e) {
  outcome = /* ... clasifica el error ... */;
}

// redirect() se llama FUERA del try/catch: lanza una excepción interna de Next
// (NEXT_REDIRECT) que no debe ser capturada por el catch de arriba.
if (!outcome.ok) {
  if (outcome.reason === "ALREADY_SETUP") redirect("/login");
  return { error: "No se pudo completar la configuración. Inténtalo de nuevo." };
}

await createSession(outcome.userId);
redirect("/boards");
```

En Next.js, `redirect()` **no devuelve** un valor: funciona **lanzando una
excepción interna** (`NEXT_REDIRECT`) que el framework intercepta para realizar
la navegación. Si llamáramos a `redirect()` dentro del `try`, el `catch` de la
transacción **capturaría esa excepción de control** y la confundiría con un error
real, rompiendo la redirección.

Por eso la transacción solo produce un **`outcome`** (un dato plano:
`{ ok: true, userId }` o `{ ok: false, reason }`), y todas las llamadas a
`redirect()` quedan **después** del `try/catch`, donde nada las va a capturar.

## Bloqueo post-setup: triple defensa

Una vez completado el setup, reabrirlo se evita por **tres** mecanismos
independientes:

1. **El campo en base de datos** (`InstanceConfig.setupCompletedAt`): la fuente
   de verdad persistente. Mientras tenga fecha, la instancia se considera
   configurada.
2. **La recomprobación en la transacción, serializada por el advisory lock**: aunque
   dos formularios se envíen a la vez, el lock hace que el segundo espere al
   primero y, al recomprobar, vea el setup hecho; devuelve `ALREADY_SETUP`, que
   redirige a `/login`. Sin el lock, la recomprobación sola no basta (ver
   [paso 3](#3-transacción-serializada)).
3. **Las comprobaciones previas con `isSetupComplete()`**: el redirect de la página
   (`/setup` → `/login`) evita mostrar el formulario, y el corte temprano de la
   acción evita validar y hashear si alguien la invoca a mano.

Estas tres capas se solapan a propósito: las comprobaciones previas son la primera
línea (UX y coste), y la transacción con el lock es la red de seguridad real contra
condiciones de carrera.

### Caso límite: borrar la fila `InstanceConfig`

Como el estado vive en la base de datos, si alguien **elimina manualmente** la
fila `InstanceConfig` (o pone su `setupCompletedAt` a `null`), `isSetupComplete()`
volverá a devolver `false` y **el wizard reaparecerá**.

Esto es **aceptable**: es tu servidor y tu base de datos. orgtable no intenta
protegerse de quien ya tiene acceso directo a PostgreSQL. Lo que hay que tener en
cuenta al hacerlo (exposición mientras el asistente está abierto, email nuevo) está en
[self-hosting.md](./self-hosting.md#restablecer-el-asistente-de-configuración).

El asistente siempre crea un administrador **nuevo**; no sirve para recuperar uno
existente.

### Recuperar el acceso de un administrador

Si un administrador olvida su contraseña:

- **Si hay otro administrador**, que la restablezca desde `/admin/users` (ver
  [admin.md](./admin.md)).
- **Si no hay ninguno con acceso**, cambia el hash directamente en la base de datos.
  Desde el directorio de instalación, genera el hash con la misma librería y coste que
  usa la app y guárdalo:

  ```bash
  HASH=$(docker compose exec -T app node -e \
    'require("bcryptjs").hash(process.argv[1], 12).then((h) => process.stdout.write(h))' \
    'la-contraseña-nueva')
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' <<SQL
  UPDATE "User" SET "passwordHash" = '$HASH' WHERE email = 'admin@ejemplo.com';
  SQL
  ```

  Sustituye la contraseña y el email (en minúsculas). La contraseña queda en el
  historial de la shell: bórrala de él después (`history -d` o editando
  `~/.bash_history`).

---

**Resumen:** el setup wizard de `/setup` solo se muestra mientras
`InstanceConfig.setupCompletedAt` es null, crea el administrador en una
transacción atómica protegida por triple defensa y hace auto-login a `/boards`.
