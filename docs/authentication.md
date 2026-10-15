# Authentication

This guide explains how authentication works in **orgtable**, for contributors. It covers
JWT sessions, the session store, password hashing, the two protection layers (proxy +
DAL), the `login`/`logout` actions, open sign-up and the account settings.

For the general system context, see [`docs/architecture.md`](./architecture.md).

## Overview

Authentication is split into five pieces, each with a clear responsibility:

| File | Responsibility |
| --- | --- |
| `app/lib/session.ts` | Sign/verify the JWT, manage the `Session` row and the session cookie. |
| `app/lib/auth.ts` | Hash and verify passwords with bcryptjs. |
| `proxy.ts` | **Optimistic** route-level auth check (does the cookie exist?). |
| `app/lib/dal.ts` | **Secure** check (decrypts the JWT, checks the session and loads the user). |
| `app/lib/actions/auth.ts` | `login` and `logout` Server Actions. |

Core idea: the token is signed with a secret and stored in an `httpOnly` cookie. It is
validated cryptographically in the Data Access Layer (DAL) and also against the **sessions
table** (`Session`), which makes it possible to revoke sessions immediately. See
[Session store and immediate revocation](#session-store-and-immediate-revocation).

## JWT sessions with `jose`

`app/lib/session.ts` uses the [`jose`](https://github.com/panva/jose) library to sign and
verify JWTs. The module starts with `import "server-only"`, so it can never end up in the
client bundle.

### Configuration

| Constant | Value |
| --- | --- |
| Secret | `process.env.SESSION_SECRET` (encoded with `TextEncoder`), at least 16 characters |
| Signing algorithm | `HS256` |
| Cookie name | `session` |
| Lifetime (`SESSION_MAX_AGE_DAYS`) | 7 days |

The key is derived when it is used (not when the module is imported, so the build does
not break) and it is **required**: without `SESSION_SECRET`, `TextEncoder().encode(undefined)`
would produce an empty, predictable key that could be used to forge sessions. Failing
loudly is the safe choice, so `getKey()` throws a clear error.

The token payload is minimal and typed:

```ts
export type SessionPayload = { userId: string; sid: string };
```

`sid` is the id of the session's row in the `Session` table.

### `encrypt` / `decrypt`

`encrypt` signs the payload with `SignJWT`, setting the `HS256` header, the issue date
(`setIssuedAt`) and a 7-day expiry (`setExpirationTime("7d")`):

```ts
async function encrypt(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getKey());
}
```

`decrypt` verifies the signature with `jwtVerify`, restricting the allowed algorithm to
`HS256`. It returns `null` on any error: missing token, `userId` or `sid` not strings, or
an expired or tampered token (the `catch` covers an invalid signature and expiry).
`getKey()` is called **outside** the `try`: a missing `SESSION_SECRET` is a configuration
error and must break the request with its message, not turn into "no session".

```ts
export async function decrypt(
  token: string | undefined,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const key = getKey();
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["HS256"],
    });
    if (typeof payload.userId !== "string" || typeof payload.sid !== "string") {
      return null;
    }
    return { userId: payload.userId, sid: payload.sid };
  } catch {
    // Invalid, expired or tampered token.
    return null;
  }
}
```

> Restricting `algorithms` to `["HS256"]` during verification matters: it prevents
> algorithm confusion attacks (for example, a token forged with `alg: none`).

### `createSession` / `deleteSession`

`createSession` creates a row in the `Session` table (with its expiry and the
`user-agent`), signs the JWT with that row's id (`sid`) and stores the token in the
`session` cookie with these flags:

| Flag | Value | Reason |
| --- | --- | --- |
| `httpOnly` | `true` | The cookie is not accessible from client-side JavaScript. |
| `secure` | `isHttpsRequest(requestHeaders)` | Only if the request arrived over HTTPS (first value of `X-Forwarded-Proto` equal to `https`, set by Next or by the TLS proxy). It does not depend on `NODE_ENV`: with `NODE_ENV`, an install reached at `http://IP:3000` could not sign in, because the browser drops a `Secure` cookie received over HTTP. See [self-hosting.md](./self-hosting.md#https-and-domain-reverse-proxy). |
| `sameSite` | `"lax"` | Mitigates CSRF while allowing top-level navigation. |
| `expires` | `Date.now() + 7 days` | Matches the JWT expiry. |
| `path` | `"/"` | Available across the whole application. |

The key is validated before the row is created, so a missing `SESSION_SECRET` never leaves
an orphan session in the database. The code is in
[`app/lib/session.ts`](../app/lib/session.ts); it is not copied here so it cannot drift.
The reasoning behind `secure` is recorded in [`DECISIONES.md`](./DECISIONES.md) (the entry
about the `Secure` session cookie and a noisy `SESSION_SECRET`).

`deleteSession` revokes the `Session` row of the current cookie (`revokedAt`) and deletes
the cookie.

> **Next.js 16 note:** `cookies()` and `headers()` from `next/headers` are **async**.
> Always `await` them (`const cookieStore = await cookies();`) before reading or writing.
> Forgetting the `await` is a common mistake when migrating from earlier versions.

## Password hashing with bcryptjs

`app/lib/auth.ts` (also `server-only`) handles passwords with
[`bcryptjs`](https://github.com/dcodeIO/bcrypt.js) at a cost of **12 rounds**
(`SALT_ROUNDS = 12`).

```ts
export const SALT_ROUNDS = 12;

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

| Function | What it does |
| --- | --- |
| `hashPassword` | Produces a bcrypt hash (with a built-in salt) at 12 rounds. |
| `verifyPassword` | Compares a plain-text password with an existing hash. |
| `verifyPasswordOrDummy` | Same, but if there is no hash (the account does not exist) it compares against `DUMMY_PASSWORD_HASH` and returns `false`: sign-in takes the same time whether the email exists or not. |

### Why `bcryptjs` and not `bcrypt`?

`bcryptjs` is a **pure JavaScript** implementation, with no native dependencies and no
compilation. This removes friction when building the image (no compiler toolchain needed,
which is especially convenient on Alpine images). In exchange it is somewhat slower than
the native binding, which is acceptable for this workload.

## Two layers of protection

orgtable protects private routes in **two layers** with different purposes.

```
Request
   │
   ▼
┌──────────────────────────┐   OPTIMISTIC check
│ proxy.ts                 │   does the "session" cookie exist?
│ (route level)            │── no ──► redirect /login
└────────────┬─────────────┘
             │ yes (or public route)
             ▼
┌──────────────────────────┐   SECURE check
│ DAL: app/lib/dal.ts      │   decrypts the JWT + checks the Session
│ (in layout/page)         │   + loads the user
│                          │── invalid ──► redirect /login
└────────────┬─────────────┘
             │ valid
             ▼
        Renders the page
```

### Layer 1: optimistic check in `proxy.ts`

In Next.js 16 the old *middleware* is called **`proxy`** (Node.js runtime). The check
here is **optimistic**: it only checks whether the `session` cookie **exists**, without
validating it cryptographically. The proxy also sets a per-request Content Security Policy
nonce.

```ts
const PUBLIC_PATHS = ["/login", "/setup", "/register", "/legal", "/robots.txt"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const hasSession = request.cookies.has("session");

  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.nextUrl));
  }
  // … per-request CSP nonce (app/lib/csp.ts)
}
```

- **Public routes:** `/login`, `/setup`, `/register` (which checks by itself whether
  sign-up is open), `/legal` (the privacy policy must be readable **before** creating an
  account) and `/robots.txt`, plus their subroutes.
- Any other route without a `session` cookie is redirected to `/login`.
- The `matcher` excludes `api`, `_next/static`, `_next/image`, `favicon.ico` and `.svg`
  files:

```ts
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
```

### Layer 2: secure check in the DAL

The Data Access Layer (`app/lib/dal.ts`) is the **only secure source of truth**. This is
where the JWT is actually decrypted and validated, the `Session` row is checked and the
user is loaded from the database.

### Why two layers?

| Layer | Checks | Cost | Purpose |
| --- | --- | --- | --- |
| `proxy.ts` (optimistic) | Only that the cookie **exists** | Very cheap, no DB and no crypto | Avoid starting to render private routes for someone who has clearly not signed in. |
| DAL (secure) | JWT signature + session + user in the DB | More expensive | Source of truth: decides who the user really is. |

The proxy is a fast, cheap filter. **It is not a security guarantee** (the cookie could
exist but be tampered with, expired or revoked). The real authorization decision is always
made by the DAL inside the layout or page.

## The Data Access Layer (`dal.ts`)

All DAL functions are memoized with React's `cache()`, so calling them several times
during the same render **does not repeat the query**. The module is `server-only`.

```ts
const INSTANCE_ID = "singleton";
```

### `verifySession`

Reads the `session` cookie, decrypts it with `decrypt` and checks the `Session` row it
points to. It returns `{ userId, sessionId }` or `null`.

```ts
export const verifySession = cache(async () => {
  const token = (await cookies()).get("session")?.value;
  const payload = await decrypt(token);
  if (!payload?.userId || !payload.sid) return null;

  const session = await prisma.session.findUnique({
    where: { id: payload.sid },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (!session) return null;
  if (session.userId !== payload.userId) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;

  return { userId: payload.userId, sessionId: payload.sid };
});
```

### `getCurrentUser`

Resolves the session and, if there is one, loads the user from the database. Returns
`null` if there is no session.

```ts
export const getCurrentUser = cache(async () => {
  const session = await verifySession();
  if (!session) return null;
  return prisma.user.findUnique({ where: { id: session.userId } });
});
```

### `requireUser`

Like `getCurrentUser`, but **redirects to `/login`** if there is no user. This is the
function to use in protected layouts and pages.

```ts
export const requireUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
});
```

### `getInstanceConfig` and `isSetupComplete`

`getInstanceConfig` reads the singleton instance configuration (`id: "singleton"`).
`isSetupComplete` returns `true` if the initial setup wizard has been completed
(`setupCompletedAt` is set).

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

**Per-board** authorization. It first requires a valid user (`requireUser`) and then
checks that they are a member of the board by querying `board_members`. Without a
membership it redirects to `/boards`. It returns the user and their `role`. Every mutation
on a board (lists, cards, etc.) must go through it; what the role allows is checked with
the helpers in `app/lib/roles.ts` (see [authorization.md](./authorization.md)).

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

### `requireAdmin`

Requires the current user to be a **global** instance administrator (`User.role = ADMIN`),
for the admin area (`/admin`). Redirects to `/boards` if not, and to `/login` if there is
no session (through `requireUser`).

| Function | Returns | On failure |
| --- | --- | --- |
| `verifySession` | `{ userId, sessionId }` or `null` | Returns `null` |
| `getCurrentUser` | `User` or `null` | Returns `null` |
| `requireUser` | `User` | Redirects to `/login` |
| `getInstanceConfig` | `InstanceConfig` or `null` | Returns `null` |
| `isSetupComplete` | `boolean` | — |
| `requireBoardAccess` | `{ user, role }` | Redirects to `/boards` |
| `requireAdmin` | `User` | Redirects to `/boards` (or `/login`) |

## Login and logout (`actions/auth.ts`)

The Server Actions (`"use server"`) live in `app/lib/actions/auth.ts`.

### `login`

The code is in [`app/lib/actions/auth.ts`](../app/lib/actions/auth.ts); this section gives
the order of the steps and the reasoning, without copying it.

1. **Per-IP limit** (`login:<ip>`, 10 attempts every 10 minutes). It only applies when
   there is a trustworthy IP, that is, with `TRUSTED_PROXY_HOPS > 0`; with the default
   (0) there is no per-IP limit.
2. **Validates** `email` and `password` from the `FormData` with `loginSchema` (zod, in
   `app/lib/validators`). On failure it returns a generic error.
3. **Per-account limit** (`login-email:<normalized email>`, 20 attempts every 15
   minutes). It is counted before verifying, so concurrent requests cannot race past it,
   and it resets on a successful login, so in practice only failures add up. It also
   counts emails that do not exist, so it does not reveal which ones do.
4. **Looks up** the user by email (normalized to lower case).
5. **Always verifies the password** with `verifyPasswordOrDummy(password,
   user?.passwordHash ?? null)` ([`app/lib/auth.ts`](../app/lib/auth.ts)): if the account
   does not exist, it compares against `DUMMY_PASSWORD_HASH`.
6. If the user does not exist or the password is wrong, it records `auth.login_failed`
   (with the `userId` if the account exists; **never** the typed email, which could
   belong to someone else) and returns a generic "invalid credentials" error.
7. If everything is correct, it resets the per-account limit. An account with
   [two-step verification](#two-step-verification) gets no session yet: it is sent to
   `/login/verify`. Any other account gets its session (`createSession`), the language
   cookie from `User.locale` if it has one (the account's language wins over the browser's
   on any device), `auth.login` is recorded and it is **redirected to `/boards`**.

When either limit is hit, the form answers with the waiting time and
`auth.login_rate_limited` is recorded **once per window**, not on every rejected attempt.
The values and the accepted risk of each limit are in
[operations.md](./operations.md#login-rate-limiting) and in
[ADR 0009](./decisions/0009-in-memory-rate-limit.md).

Errors also return `values: { email }` (never the password) so the form keeps what was
typed.

> **Timing attack protection:** when the user does not exist, the password is verified
> against a **dummy hash** instead of returning early, so the response time is similar
> whether or not the account exists. That hash must be a **valid bcrypt hash with the
> same cost** (12): with a malformed literal, `bcrypt.compare` returns `false`
> immediately and the response time reveals which emails have an account. This happened
> with the previous 59-character literal; see [`DECISIONES.md`](./DECISIONES.md) (the
> entry about trusted IPs, the per-account limit and a valid dummy hash). Never compare
> against a made-up literal: use `verifyPasswordOrDummy`. The error message is generic
> for the same reason.

### `logout`

Revokes the session, records `auth.logout` and redirects to `/login`.

## Two-step verification

Anyone can add a second step to their account at **Settings › Password and sessions**: a
6-digit code from an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 s; the parameters
every app supports). It needs `ORGTABLE_SECRET_KEY` on the server; without it the option says
so instead of appearing. An organization can make it mandatory for its members (see
[workspaces](./workspaces.md)).

**Setup** (`/settings/security/two-factor`, `app/lib/services/two-factor.ts`):

1. A POST creates a random 160-bit secret and keeps it **encrypted** in `totpPendingEnc`
   (AES-256-GCM, `app/lib/crypto/secrets.ts`, bound to the account with the context
   `totp:<userId>`). Opening the page never creates one.
2. The page shows it as a QR code (drawn on the server as SVG, `qrcode`) and as text.
3. The first valid code moves it to `totpSecretEnc`, sets `totpEnabledAt` and returns ten
   **recovery codes**, shown once. Only their SHA-256 is stored.

**Sign-in.** After a correct password, `login` sets a `pending_2fa` cookie instead of a
session: a JWT signed with `SESSION_SECRET`, valid 10 minutes, marked `purpose: "2fa"` and
carrying a fingerprint of the password hash, so a password change voids it. `/login/verify`
asks for a code (or a recovery code) and only then `verifyLoginCode` opens the session. Five
wrong codes in ten minutes throw the person back to the password.

**Every code works once.** `totpLastStep` only moves forward (`UPDATE … WHERE totpLastStep <
step`), so the same code cannot open two sessions; a recovery code is removed from the array
by the same `UPDATE` that checks it. One step of clock drift either way is accepted.

**Turning it off** needs the password **and** a code. New recovery codes need the password.
Someone who lost both their phone and their codes asks the instance administrator, who can
**reset** it from `/admin/users` (their sessions are closed too).

API tokens are a separate credential and are not affected by two-step verification.

```ts
export async function logout(): Promise<void> {
  const session = await verifySession();
  await deleteSession();
  if (session) {
    await recordAudit({ action: "auth.logout", userId: session.userId });
  }
  redirect("/login");
}
```

## Open sign-up (`actions/register.ts`)

If the instance allows it (`isRegistrationOpen()`: sign-up open **and** the operator and
privacy contact filled in), `/register` creates a `MEMBER` account with the date the
policy was accepted (`User.termsAcceptedAt`) and signs the person in. Before creating it,
it applies:

- a honeypot field;
- 5 sign-ups per hour per IP, if there is a trustworthy IP;
- 30 sign-ups per hour across the whole instance.

Details and reasons in [privacy.md](./privacy.md#open-sign-up).

## Your own account (`actions/account.ts`)

From `/settings`, each person can:

- change their name and email (changing the email asks for the current password);
- change their password, which **closes their other sessions** and keeps the current one;
- close specific sessions, or all except the current one;
- choose the theme and the interface language in Settings › Appearance (the language is
  saved by `actions/locale.ts`);
- download their data (`GET /api/account/export`) or delete their account.

The logic lives in `app/lib/services/account.ts`, without request context. The id of the
current session comes from `verifySession().sessionId`.

## Session store and immediate revocation

The cookie is a signed JWT that **carries the id of a row in the `Session` table** (`sid`).
The DAL validates the JWT **and** checks that row:

```
verifySession()  →  decrypts the JWT  →  looks up the Session by sid
                 →  null if: missing · revokedAt ≠ null · expiresAt in the past
```

An earlier design used stateless JWTs with no sessions table, which made it impossible to
revoke a token before it expired. The session store gives **immediate revocation** (it
takes effect on the next request, not after 7 days):

- **`logout`** revokes the current session's row (`revokedAt`) and deletes the cookie.
- **Resetting the password** (by the administrator) revokes **all** the user's sessions
  and **deletes their API tokens**, in a single transaction: any open session and any
  token stop working immediately (see [ADR 0013](./decisions/0013-api-tokens.md)).
- The administrator can **force a user to sign out** from `/admin/users` (the
  `revokeUserSessions` action). It only affects browser sessions: API tokens remain
  valid.
- **Deleting a user** deletes their sessions in cascade.

The cost is **one more query per request** (the session lookup), memoized per request with
React's `cache()`, so it runs once per render. The decision and its reasoning are in
[`docs/decisions/0008-session-store.md`](./decisions/0008-session-store.md).

**Role** changes do not need to revoke sessions: the role is read fresh from the database
on every request, so a role change takes effect immediately.

---

**Summary:** orgtable authenticates with a signed JWT (`jose` + `httpOnly` cookie) whose
`sid` points to a row in the `Session` table, validated in the DAL. Together with
bcryptjs, the optimistic check in `proxy.ts` and the authoritative check in the DAL, this
allows sessions to be revoked immediately (logout, password reset, forced sign-out).
