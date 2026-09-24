# Autenticación

Esta guía explica cómo funciona la autenticación en **orgtable** para quienes contribuyen al proyecto. Cubre las sesiones JWT, el hashing de contraseñas, la doble capa de protección (proxy + DAL), las acciones de `login`/`logout` y los límites conocidos del MVP.

Para el contexto general del sistema, consulta [`docs/architecture.md`](./architecture.md).

## Visión general

La autenticación se reparte en cinco piezas, cada una con una responsabilidad clara:

| Archivo | Responsabilidad |
| --- | --- |
| `app/lib/session.ts` | Firmar/verificar el JWT y gestionar la cookie de sesión. |
| `app/lib/auth.ts` | Hashear y verificar contraseñas con bcryptjs. |
| `proxy.ts` | Chequeo **optimista** de auth a nivel de ruta (existe la cookie). |
| `app/lib/dal.ts` | Verificación **segura** (descifra el JWT y consulta el usuario). |
| `app/lib/actions/auth.ts` | Server Actions de `login` y `logout`. |

Idea central: el token se firma con un secreto y se guarda en una cookie `httpOnly`.
Se valida criptográficamente en el Data Access Layer (DAL) y, desde el Hito 4, además
contra la **tabla de sesiones** (`Session`), lo que permite revocar sesiones al
instante. Ver [Almacén de sesiones y revocación inmediata](#almacén-de-sesiones-y-revocación-inmediata-hito-4).

## Sesiones JWT con `jose`

El archivo `app/lib/session.ts` usa la librería [`jose`](https://github.com/panva/jose) para firmar y verificar tokens JWT. El módulo empieza con `import "server-only"`, de modo que nunca puede acabar en el bundle del cliente.

### Configuración

| Constante | Valor |
| --- | --- |
| Secreto | `process.env.SESSION_SECRET` (codificado con `TextEncoder`) |
| Algoritmo de firma | `HS256` |
| Nombre de la cookie | `session` |
| Duración (`MAX_AGE_MS`) | 7 días |

El payload del token es mínimo y tipado:

```ts
type SessionPayload = { userId: string };
```

### `encrypt` / `decrypt`

`encrypt` firma el payload con `SignJWT`, estableciendo la cabecera `HS256`, la fecha de emisión (`setIssuedAt`) y una expiración de 7 días (`setExpirationTime("7d")`):

```ts
export async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(encodedKey);
}
```

`decrypt` verifica la firma con `jwtVerify`, restringiendo el algoritmo permitido a `HS256`. Devuelve `null` en cualquier caso de error: token ausente, `userId` no es un string, o el token está expirado/manipulado (el `catch` cubre firma inválida y caducidad).

```ts
export async function decrypt(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, {
      algorithms: ["HS256"],
    });
    if (typeof payload.userId !== "string") return null;
    return { userId: payload.userId };
  } catch {
    // Token inválido, expirado o manipulado.
    return null;
  }
}
```

> Restringir `algorithms` a `["HS256"]` en la verificación es importante: evita ataques de confusión de algoritmo (por ejemplo, un token forjado con `alg: none`).

### `createSession` / `deleteSession`

`createSession` cifra el `userId` y guarda el token en la cookie `session` con los siguientes flags:

| Flag | Valor | Motivo |
| --- | --- | --- |
| `httpOnly` | `true` | La cookie no es accesible desde JavaScript del cliente. |
| `secure` | `isHttpsRequest(requestHeaders)` | Solo si la petición llegó por HTTPS (primer valor de `X-Forwarded-Proto` igual a `https`, que pone Next o el proxy TLS). No depende de `NODE_ENV`: con él, la instalación por `http://IP:3000` no dejaba entrar porque el navegador descarta una cookie `Secure` recibida por HTTP. Ver [self-hosting.md](./self-hosting.md#https-y-dominio-reverse-proxy). |
| `sameSite` | `"lax"` | Mitiga CSRF permitiendo navegación top-level. |
| `expires` | `Date.now() + 7 días` | Coincide con la expiración del JWT. |
| `path` | `"/"` | Disponible en toda la aplicación. |

Antes de poner la cookie, `createSession` crea una fila en la tabla `Session` (con la
caducidad y el `user-agent`) y firma el JWT con su id (`sid`); ver
[Almacén de sesiones y revocación inmediata](#almacén-de-sesiones-y-revocación-inmediata-hito-4).
El código está en [`app/lib/session.ts`](../app/lib/session.ts); no se copia aquí para
que no se desfase. El porqué de `secure` está en [`DECISIONES.md`](./DECISIONES.md)
(«Cookie de sesión Secure según el esquema real y SESSION_SECRET ruidoso»).

`deleteSession` revoca la fila `Session` de la cookie actual (`revokedAt`) y borra la
cookie.

> **Nota sobre Next.js 16:** `cookies()` de `next/headers` es **asíncrono**. Siempre hay que hacer `const cookieStore = await cookies();` antes de leer o escribir. Olvidar el `await` es un error frecuente al migrar desde versiones anteriores.

## Hashing de contraseñas con bcryptjs

El archivo `app/lib/auth.ts` (también `server-only`) gestiona las contraseñas con [`bcryptjs`](https://github.com/dcodeIO/bcrypt.js) y un coste de **12 rounds** (`SALT_ROUNDS = 12`).

```ts
const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

| Función | Qué hace |
| --- | --- |
| `hashPassword` | Genera un hash bcrypt (con salt incorporado) a 12 rounds. |
| `verifyPassword` | Compara una contraseña en claro contra un hash existente. |
| `verifyPasswordOrDummy` | Igual, pero si no hay hash (la cuenta no existe) compara contra `DUMMY_PASSWORD_HASH` y devuelve `false`: el login tarda lo mismo exista o no el email. |

### ¿Por qué `bcryptjs` y no `bcrypt`?

`bcryptjs` es una implementación **en JavaScript puro**, sin dependencias nativas ni compilación. Esto elimina fricción al construir la imagen (no requiere toolchain de compilación, lo que es especialmente cómodo en imágenes Alpine). A cambio es algo más lento que el binding nativo, lo cual es aceptable para el MVP.

## Doble capa de protección

orgtable protege las rutas privadas en **dos capas** con propósitos distintos.

```
Petición
   │
   ▼
┌──────────────────────────┐   chequeo OPTIMISTA
│ proxy.ts                 │   ¿existe la cookie "session"?
│ (a nivel de ruta)        │── no ──► redirect /login
└────────────┬─────────────┘
             │ sí (o ruta pública)
             ▼
┌──────────────────────────┐   verificación SEGURA
│ DAL — app/lib/dal.ts     │   descifra el JWT + consulta el usuario
│ (en layout/página)       │── inválido ──► redirect /login
└────────────┬─────────────┘
             │ válido
             ▼
        Renderiza la página
```

### Capa 1: chequeo optimista en `proxy.ts`

En Next.js 16 el antiguo *middleware* se llama **`proxy`** (runtime Node.js). Aquí el chequeo es **optimista**: solo comprueba si **existe** la cookie `session`, sin validarla criptográficamente.

```ts
const PUBLIC_PATHS = ["/login", "/setup"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSession = request.cookies.has("session");

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  return NextResponse.next();
}
```

- **Rutas públicas:** `/login` y `/setup` (y sus subrutas).
- Cualquier otra ruta sin cookie `session` se redirige a `/login`.
- El `matcher` excluye `api`, `_next/static`, `_next/image`, `favicon.ico` y archivos `.svg`:

```ts
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
```

### Capa 2: verificación segura en el DAL

El Data Access Layer (`app/lib/dal.ts`) es la **única fuente de verdad segura**. Aquí sí se descifra y valida el JWT, y se consulta el usuario en la base de datos.

### ¿Por qué dos capas?

| Capa | Comprueba | Coste | Para qué sirve |
| --- | --- | --- | --- |
| `proxy.ts` (optimista) | Solo **existencia** de la cookie | Muy barato, sin BBDD ni criptografía | Evitar empezar a renderizar rutas privadas a quien claramente no ha iniciado sesión. |
| DAL (seguro) | Firma del JWT + usuario en BBDD | Más caro | Fuente de verdad: decide realmente quién es el usuario. |

El proxy es un filtro rápido y barato. **No es una garantía de seguridad** (la cookie podría existir pero estar manipulada o expirada). La decisión real de autorización siempre la toma el DAL dentro del layout o página.

## El Data Access Layer (`dal.ts`)

Todas las funciones del DAL están memoizadas con `cache()` de React, de modo que llamarlas varias veces durante el mismo render **no repite la consulta**. El módulo es `server-only`.

```ts
const INSTANCE_ID = "singleton";
```

### `verifySession`

Lee la cookie `session`, la descifra con `decrypt` y devuelve `{ userId }` o `null`. No toca la base de datos.

```ts
export const verifySession = cache(async () => {
  const token = (await cookies()).get("session")?.value;
  const session = await decrypt(token);
  if (!session?.userId) return null;
  return { userId: session.userId };
});
```

### `getCurrentUser`

Resuelve la sesión y, si existe, busca el usuario en la base de datos. Devuelve `null` si no hay sesión.

```ts
export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
});
```

### `requireUser`

Igual que `getCurrentUser`, pero **redirige a `/login`** si no hay usuario. Es la función a usar en layouts y páginas protegidas.

```ts
export const requireUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});
```

### `getInstanceConfig` e `isSetupComplete`

`getInstanceConfig` lee la configuración singleton de la instancia (`id: "singleton"`). `isSetupComplete` devuelve `true` si el asistente de configuración inicial ya se completó (existe `setupCompletedAt`).

```ts
export const getInstanceConfig = cache(async () => {
  return prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
});

export const isSetupComplete = cache(async () => {
  const config = await getInstanceConfig();
  return Boolean(config?.setupCompletedAt);
});
```

### `requireBoardAccess`

Autorización **por tablero**. Exige primero un usuario válido (`requireUser`) y luego comprueba que sea miembro del tablero consultando `board_members`. Si no hay membresía, redirige a `/boards`. Devuelve el usuario y su `role`. Toda mutación sobre un tablero (listas, tarjetas, etc.) debe pasar por aquí.

```ts
export const requireBoardAccess = cache(async (boardId: string) => {
  const user = await requireUser();
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
  });
  if (!membership) redirect("/boards");
  return { user, role: membership.role };
});
```

| Función | Devuelve | Si falla |
| --- | --- | --- |
| `verifySession` | `{ userId }` o `null` | Devuelve `null` |
| `getCurrentUser` | `User` o `null` | Devuelve `null` |
| `requireUser` | `User` | Redirige a `/login` |
| `getInstanceConfig` | `InstanceConfig` o `null` | Devuelve `null` |
| `isSetupComplete` | `boolean` | — |
| `requireBoardAccess` | `{ user, role }` | Redirige a `/boards` |

## Login y logout (`actions/auth.ts`)

Las Server Actions (`"use server"`) viven en `app/lib/actions/auth.ts`.

### `login`

El código está en [`app/lib/actions/auth.ts`](../app/lib/actions/auth.ts); aquí va el
orden de los pasos y el porqué, sin copiarlo.

1. **Límite por IP** (`login:<ip>`, 10 intentos cada 10 minutos). Solo se aplica si hay
   una IP fiable, es decir, con `TRUSTED_PROXY_HOPS > 0`; con el valor por defecto (0)
   no hay límite por IP.
2. **Valida** el `email` y la `password` del `FormData` con `loginSchema` (zod, en
   `app/lib/validators`). Si falla, devuelve un error genérico.
3. **Límite por cuenta** (`login-email:<email normalizado>`, 20 intentos cada 15
   minutos). Se cuenta antes de verificar, para que no haya carreras entre peticiones
   simultáneas, y se reinicia con un login correcto, así que en la práctica solo suman
   los fallos. Cuenta también los emails que no existen, para no revelar cuáles existen.
4. **Busca** al usuario por email (normalizado a minúsculas).
5. **Verifica la contraseña siempre** con `verifyPasswordOrDummy(password,
   user?.passwordHash ?? null)` ([`app/lib/auth.ts`](../app/lib/auth.ts)): si la cuenta
   no existe, compara contra `DUMMY_PASSWORD_HASH`.
6. Si el usuario no existe o la contraseña no es válida, registra `auth.login_failed`
   (con el `userId` si la cuenta existe; **nunca** el email tecleado, que podría ser de
   un tercero) y devuelve `"Credenciales incorrectas."`.
7. Si todo es correcto, reinicia el límite por cuenta, crea la sesión
   (`createSession`), registra `auth.login` y **redirige a `/boards`**.

Cuando salta cualquiera de los dos límites, el formulario responde con el tiempo de
espera y se registra `auth.login_rate_limited` **una sola vez por ventana**, no en cada
intento rechazado. Los valores y el riesgo aceptado de cada límite están en
[operations.md](./operations.md#límite-de-intentos-de-login-rate-limiting) y en el
[ADR 0009](./decisions/0009-in-memory-rate-limit.md).

Los errores devuelven también `values: { email }` (nunca la contraseña) para que el
formulario conserve lo tecleado.

> **Protección contra timing attacks:** cuando el usuario no existe, se verifica la
> contraseña contra un **hash ficticio** en lugar de retornar antes, para que el tiempo
> de respuesta sea similar exista o no la cuenta. Ese hash tiene que ser un **hash bcrypt
> válido del mismo coste** (12): con un literal mal formado, `bcrypt.compare` devuelve
> `false` al instante y el tiempo de respuesta revela qué emails tienen cuenta. Pasó con
> el literal anterior, de 59 caracteres; ver [`DECISIONES.md`](./DECISIONES.md) («Login:
> IP de confianza, límite por cuenta y hash ficticio válido»). No compares nunca contra
> un literal inventado: usa `verifyPasswordOrDummy`. El mensaje de error también es
> genérico por el mismo motivo.

### `logout`

Borra la sesión y redirige a `/login`.

```ts
export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
```

## Almacén de sesiones y revocación inmediata (Hito 4)

> **Actualización (Hito 4).** El MVP usaba JWT *stateless* sin tabla de sesiones, lo
> que impedía revocar un token al instante. Eso ha cambiado.

Ahora la cookie sigue siendo un JWT firmado, pero **lleva el id de una fila de la
tabla `Session`** (`sid`). El DAL valida el JWT **y además** comprueba esa fila:

```
verifySession()  →  descifra el JWT  →  busca la Session por sid
                 →  null si: no existe · revokedAt ≠ null · expiresAt pasada
```

Esto da **revocación inmediata** (toma efecto en la siguiente petición, no a los 7
días):

- **`logout`** revoca la fila de la sesión actual (`revokedAt`) y borra la cookie.
- **Restablecer la contraseña** (por el administrador) revoca **todas** las sesiones
  del usuario y **borra sus tokens de API**, en una sola transacción: cualquier sesión
  abierta y cualquier token dejan de valer al instante (ver
  [ADR 0013](./decisions/0013-api-tokens.md)).
- El administrador puede **forzar el cierre de sesión** de un usuario desde
  `/admin/users` (acción `revokeUserSessions`). Solo afecta a las sesiones del
  navegador: los tokens de API siguen vigentes.
- **Borrar un usuario** elimina sus sesiones en cascada.

El coste es **una consulta más por petición** (la búsqueda de la sesión), memoizada
por request con `cache()` de React, así que se ejecuta una sola vez por render. La
decisión y el porqué están en
[`docs/decisions/0008-session-store.md`](./decisions/0008-session-store.md).

Los cambios de **rol** no necesitan revocar sesiones: el rol se lee fresco de la base
de datos en cada petición, así que un cambio de rol surte efecto de inmediato.

---

**Resumen:** orgtable autentica con un JWT firmado (`jose` + cookie `httpOnly`) cuyo
`sid` apunta a una fila de la tabla `Session`, validada en el DAL; junto con bcryptjs,
el chequeo optimista de `proxy.ts` y la verificación autoritativa del DAL, permite
revocar sesiones al instante (logout, reset de contraseña, cierre forzado).
