# Setup wizard

This guide is for **self-hosters** and **contributors** of orgtable. It explains what the
setup wizard is, how it decides whether to show up, and why its logic is safe against
duplicate submissions.

Related: [`docs/installation.md`](./installation.md) ·
[`docs/authentication.md`](./authentication.md) ·
[`docs/decisions/0003-db-creds-in-env.md`](./decisions/0003-db-creds-in-env.md)

## What it is

The **setup wizard** is the screen shown **the first time** a freshly installed orgtable
instance is opened. It lives at `/setup`, and its only purpose is to make the instance
ready to use by creating the first admin account.

It asks for four things:

1. **Instance name**: a label for your team or server (e.g. "My team"). At most 60
   characters.
2. **Your name**: at most 60 characters.
3. **Your email**: the admin's sign-in.
4. **A password**: between 8 and 200 characters.

The form is deliberately minimal:

> This wizard only appears once. Create your admin account.

### What the wizard does NOT ask for

The wizard **does not ask for database credentials**. The PostgreSQL connection is not
configured here: the `install.sh` script generates it and it is injected through
environment variables at start-up. The reasoning behind this decision is documented in
[`docs/decisions/0003-db-creds-in-env.md`](./decisions/0003-db-creds-in-env.md). For the
full installation process, see [`docs/installation.md`](./installation.md).

When the wizard runs, the database is **already connected and migrated**; in fact, the
wizard needs the database to read and write its source of truth.

## Source of truth: `InstanceConfig.setupCompletedAt`

All the wizard logic revolves around a single database field. The global instance
configuration is stored in a **single row** of the `InstanceConfig` model (its `id` is
always the fixed value `"singleton"`):

```prisma
// prisma/schema.prisma
model InstanceConfig {
  id               String    @id @default("singleton")
  instanceName     String
  setupCompletedAt DateTime?
  createdAt        DateTime  @default(now())
}
```

The key field is `setupCompletedAt`:

- While it is **`null`**, the instance is considered **not configured** and the wizard
  (`/setup`) is **active**.
- As soon as it holds a **date**, the instance is configured and the wizard is
  **locked for good**.

That question ("is the instance already configured?") is answered by a single Data
Access Layer function, `isSetupComplete()`:

```ts
// app/lib/dal.ts
export const getInstanceConfig = cache(async () => {
  return prisma.instanceConfig.findUnique({ where: { id: INSTANCE_ID } });
});

/** true if the setup wizard has been completed. */
export const isSetupComplete = cache(async () => {
  const config = await getInstanceConfig();
  return Boolean(config?.setupCompletedAt);
});
```

`isSetupComplete()` simply checks whether `setupCompletedAt` has a value. It is wrapped
in React's `cache()`, so within a single request the query runs only once even if it is
called from several places.

## Gating flow

The state of `setupCompletedAt` decides where the visitor is redirected, forming a
two-way check between the wizard and the rest of the app:

- **`/setup`** redirects to **`/login`** if setup is **already complete** (there is no
  point in reconfiguring an initialized instance).
- The **login** pages and the whole **authenticated area** redirect to **`/setup`** if
  setup is **NOT complete** (there is no point in signing in to an instance with no
  admin).

The `/setup` side lives in its own page:

```tsx
// app/setup/page.tsx
export default async function SetupPage() {
  // Once setup is complete, the wizard is locked for good.
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <SetupForm />
    </main>
  );
}
```

As a result there is exactly **one** valid state per instance: either you are in the
wizard (not configured) or you are on the login page / in the app (configured). Never
both.

## The `completeSetup` action

When you submit the form, the `completeSetup` Server Action
(`app/lib/actions/setup.ts`) runs. Its steps are:

### 1. Early exit

If `isSetupComplete()` is already true, the action calls `redirect("/login")` before
validating anything or spending the bcrypt hash. This is needed even though `/setup`
already redirects: the action ID is still in the page bundle and can be invoked by hand.
It does not replace the check inside the transaction, which is the authoritative one.

### 2. Validation with zod

The four fields are validated with `setupSchema` before touching the database. If
validation fails, the action returns a readable (localized) error and does nothing else:

```ts
const parsed = setupSchema.safeParse({
  instanceName: formData.get("instanceName"),
  name: formData.get("name"),
  email: formData.get("email"),
  password: formData.get("password"),
});
if (!parsed.success) {
  return { error: /* message of the first zod issue */ };
}
```

The password is hashed (`hashPassword`) **before** the transaction is opened.

### 3. Serialized transaction

The core is `completeInstanceSetup` (`app/lib/services/setup.ts`), a Prisma transaction
(`prisma.$transaction`) that does, in this order:

1. **Takes a transaction-level advisory lock**:
   `pg_advisory_xact_lock(hashtext('orgtable:setup'))`. A second simultaneous
   submission waits here until the first one commits or aborts.
2. **Re-checks `setupCompletedAt`.** If it already has a date, it returns
   `{ ok: false, reason: "ALREADY_SETUP" }` (it does not throw) and writes nothing.
3. **Creates the admin user** with the already-hashed password, the email in lowercase
   and the `ADMIN` role.
4. **Sets `setupCompletedAt`** to the current date and stores the `instanceName` (with
   `upsert`, in case the `InstanceConfig` row already existed without being completed),
   and returns `{ ok: true, userId }`.

The re-check in step 2 **only protects because the lock in step 1 serializes the
submissions**. With PostgreSQL's default isolation (READ COMMITTED), without the lock two
nearly simultaneous submissions would both read "not configured" and create two admins.
Do not remove the lock: the full reasoning and the alternatives considered are in
[`DECISIONES.md`](./DECISIONES.md) (the entry about the setup advisory lock), and
`test/integration/setup.int.test.ts` checks it with simultaneous submissions.

Because everything happens in one transaction, a failure halfway through never leaves
an inconsistent state: either the admin and the setup flag are created together, or
nothing is.

### 4. Auto sign-in and redirect

After the transaction, the action creates the session (auto sign-in with
`createSession`) and redirects to `/boards`:

```ts
await createSession(outcome.userId);
redirect("/boards");
```

### Why `redirect()` is called OUTSIDE the try/catch

This is deliberate and worth understanding if you change the action:

```ts
// app/lib/actions/setup.ts
try {
  // ... the transaction ...
} catch (e) {
  outcome = /* ... classify the error ... */;
}

// redirect() is called OUTSIDE the try/catch: it throws an internal Next exception
// (NEXT_REDIRECT) that must not be caught by the catch above.
if (!outcome.ok) {
  if (outcome.reason === "ALREADY_SETUP") redirect("/login");
  return { error: /* localized "could not complete setup, try again" message */ };
}

await createSession(outcome.userId);
redirect("/boards");
```

In Next.js, `redirect()` **does not return** a value: it works by **throwing an internal
exception** (`NEXT_REDIRECT`) that the framework intercepts to perform the navigation. If
`redirect()` were called inside the `try`, the transaction's `catch` **would catch that
control-flow exception** and mistake it for a real error, breaking the redirect.

That is why the transaction only produces an **`outcome`** (plain data:
`{ ok: true, userId }` or `{ ok: false, reason }`), and every `redirect()` call comes
**after** the `try/catch`, where nothing will catch it.

## Post-setup lock: three layers of defense

Once setup is complete, reopening it is prevented by **three** independent mechanisms:

1. **The database field** (`InstanceConfig.setupCompletedAt`): the persistent source of
   truth. While it holds a date, the instance is considered configured.
2. **The re-check inside the transaction, serialized by the advisory lock**: even if two
   forms are submitted at once, the lock makes the second wait for the first and, on
   re-checking, see that setup is done; it returns `ALREADY_SETUP`, which redirects to
   `/login`. Without the lock, the re-check alone is not enough (see
   [step 3](#3-serialized-transaction)).
3. **The prior checks with `isSetupComplete()`**: the page redirect (`/setup` →
   `/login`) avoids showing the form, and the action's early exit avoids validating and
   hashing if someone invokes it by hand.

These three layers overlap on purpose: the prior checks are the first line (UX and
cost), and the locked transaction is the real safety net against race conditions.

### Edge case: deleting the `InstanceConfig` row

Since the state lives in the database, if someone **manually deletes** the
`InstanceConfig` row (or sets its `setupCompletedAt` to `null`), `isSetupComplete()`
returns `false` again and **the wizard reappears**.

This is **acceptable**: it is your server and your database. orgtable does not try to
protect itself from someone who already has direct access to PostgreSQL. What to keep in
mind when doing it (exposure while the wizard is open, new email) is covered in
[self-hosting.md](./self-hosting.md#resetting-the-setup-wizard).

The wizard always creates a **new** admin; it cannot recover an existing one.

### Recovering access for an admin

If an admin forgets their password:

- **If there is another admin**, they can reset it from `/admin/users` (see
  [admin.md](./admin.md)).
- **If no admin has access**, change the hash directly in the database. From the
  installation directory, generate the hash with the same library and cost the app uses
  and store it:

  ```bash
  HASH=$(docker compose exec -T app node -e \
    'require("bcryptjs").hash(process.argv[1], 12).then((h) => process.stdout.write(h))' \
    'the-new-password')
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"' <<SQL
  UPDATE "User" SET "passwordHash" = '$HASH' WHERE email = 'admin@example.com';
  SQL
  ```

  Replace the password and the email (in lowercase). The password stays in the shell
  history: remove it afterwards (`history -d` or by editing `~/.bash_history`).

---

**Summary:** the setup wizard at `/setup` is only shown while
`InstanceConfig.setupCompletedAt` is null, creates the admin in an atomic transaction
protected by three layers of defense, and signs you in straight to `/boards`.
