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

Idea central: el JWT es **stateless** (no hay tabla de sesiones en la base de datos). El token se firma con un secreto, se guarda en una cookie `httpOnly` y se valida criptográficamente en el Data Access Layer (DAL).

## Sesiones JWT stateless con `jose`

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
| `secure` | `process.env.NODE_ENV === "production"` | Solo se envía por HTTPS en producción (en desarrollo se permite HTTP). |
| `sameSite` | `"lax"` | Mitiga CSRF permitiendo navegación top-level. |
| `expires` | `Date.now() + 7 días` | Coincide con la expiración del JWT. |
| `path` | `"/"` | Disponible en toda la aplicación. |

```ts
export async function createSession(userId: string): Promise<void> {
  const token = await encrypt({ userId });
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(Date.now() + MAX_AGE_MS),
    path: "/",
  });
}
```

`deleteSession` simplemente borra esa cookie:

```ts
export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
```

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

1. **Valida** el `email` y la `password` del `FormData` con `loginSchema` (zod, en `app/lib/validators`). Si falla, devuelve un error genérico.
2. **Busca** al usuario por email (normalizado a minúsculas).
3. **Verifica la contraseña siempre**, incluso si el usuario no existe.
4. Si el usuario no existe o la contraseña no es válida, devuelve `"Credenciales incorrectas."`.
5. Si todo es correcto, crea la sesión (`createSession`) y **redirige a `/boards`**.

```ts
const user = await prisma.user.findUnique({
  where: { email: parsed.data.email.toLowerCase() },
});
// Verificamos siempre la contraseña (aunque el usuario no exista usamos un hash
// ficticio) para no filtrar por tiempo si un email está registrado.
const hash = user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";
const valid = await verifyPassword(parsed.data.password, hash);

if (!user || !valid) {
  return { error: "Credenciales incorrectas." };
}

await createSession(user.id);
redirect("/boards");
```

> **Protección contra timing attacks:** cuando el usuario no existe, se verifica la contraseña contra un **hash ficticio** en lugar de retornar antes. Así el tiempo de respuesta es similar exista o no la cuenta, evitando que un atacante deduzca **por tiempo** si un email está registrado. El mensaje de error también es genérico por el mismo motivo.

### `logout`

Borra la sesión y redirige a `/login`.

```ts
export async function logout(): Promise<void> {
  await deleteSession();
  redirect("/login");
}
```

## Límites conocidos del MVP

Al ser **JWT stateless sin tabla de sesiones**, hay un compromiso importante:

- **No hay revocación inmediata.** `logout` borra la cookie del navegador actual, pero **no invalida** los tokens ya emitidos en otros dispositivos. Esos tokens siguen siendo válidos hasta que **expiran** (7 días). No existe forma de "cerrar todas las sesiones" ni de revocar un token concreto al instante.
- No hay rotación de tokens ni lista de revocación.

Esta decisión es intencional para el MVP y está documentada en [`docs/decisions/0004-no-redis-mvp.md`](./decisions/0004-no-redis-mvp.md). La revocación de sesiones se abordará junto con el hito de tiempo real descrito en [`docs/roadmap.md`](./roadmap.md), que introducirá la infraestructura de estado necesaria.

---

**Resumen:** orgtable autentica con sesiones JWT stateless (`jose` + cookie `httpOnly`) y bcryptjs, protegidas por un chequeo optimista en `proxy.ts` y la verificación segura y autoritativa del DAL, a costa de no poder revocar tokens al instante hasta el hito de tiempo real.
