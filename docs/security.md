# Security

This document summarizes orgtable's **security posture** and the results of the security
audit of the codebase. orgtable is self-hosted: the threat model assumes an instance
behind a reverse proxy with TLS, with accounts created by the administrator or, when the
operator enables it, through open sign-up (see [privacy.md](./privacy.md)).

## Audit methodology

- **`pnpm audit`** on the dependencies.
- **Adversarial multi-agent audit**: 7 reviewers in parallel, one per attack surface
  (authentication/sessions, authorization/IDOR, injection, XSS/output, file uploads,
  secrets/SSRF, web hardening), reading the **actual code**. Every finding went through a
  **skeptic** that tried to refute it against the code (84 agents in total). Of 78 raw
  findings: **13 confirmed, 64 refuted**.
- **Manual review** of the highest-value areas (cookies, headers, attachment downloads,
  raw SQL).

## Dependencies (`pnpm audit`)

- **2026-09-24**: after the move to pnpm, `pnpm audit` reported 63 advisories (2 critical
  in `next` 16.2.7). Everything was upgraded within its major version (`next` 16.3.6,
  Prisma 7.10…) and patched transitive dependencies were forced with `overrides` in
  `pnpm-workspace.yaml`. The result was **0 advisories** plus one ignored and justified
  (`deepmerge-ts`, only in the Prisma CLI). Details and reasoning are in
  [`DECISIONES.md`](./DECISIONES.md).
- CI runs `pnpm audit --prod --audit-level high` on every push and PR.

## Confirmed findings and their status

| Severity | Finding | Status |
|-----------|----------|--------|
| **High** | **IDOR in `moveCard`**: it only checked the DESTINATION board, not the SOURCE one. An editor who knew a card's id could move into their own board a card from another board they had no access to. | **Fixed**: `moveCard` requires `cardBelongsToBoard(cardId, destination)` (the card must already be on the destination board; cards are not moved between boards). Regression test in `security.int.test.ts`. |
| Medium (ops) | An unset `SESSION_SECRET` fell back to an empty/predictable key (forgeable sessions). | **Fixed**: `SESSION_SECRET` (≥16 characters) is required to sign and verify; it fails loudly. |
| Medium (ops) | `DATABASE_URL` was not validated: the adapter would fall back to libpq defaults and connect to an unintended database. | **Fixed**: `createPrismaClient` throws if it is missing (except during `next build`). |
| Low | Security headers were missing (clickjacking, sniffing, CSP, HSTS). | **Fixed**: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` and HSTS in `next.config.ts`; a nonce-based CSP in `proxy.ts` and a fixed CSP for `/api` and `.svg` files. Tests in `test/csp.test.ts` and `test/next-config.test.ts`. |
| Low | The cron 503 revealed "no CRON_SECRET". | **Fixed**: generic message ("Service unavailable."). |
| Medium (ops) | The setup wizard is **locked forever** once completed; there is no reset in the UI. | **Accepted/documented**: the lock is intentional; recovery is `UPDATE "InstanceConfig" SET "setupCompletedAt" = NULL` (see `docs/setup-wizard.md`). |

The other findings the panel "confirmed" were actually **correct controls** (see below),
not vulnerabilities.

## Verified controls

- **Authorization does not depend on the middleware**: `proxy.ts` only does an
  *optimistic* check (does the cookie exist?); the real authority is the **DAL**
  (`verifySession` validates the JWT **and** the session row: it exists, is not revoked
  and has not expired) on every page and action. This **mitigates Next middleware
  bypasses**.
- **Two-layer RBAC**: every mutation checks membership (`requireBoardAccess`/
  `apiBoardRole`) **and** role (`canEditBoard`/`canManageBoard`). Reads are scoped to
  owner-or-member in the `WHERE` clause.
- **Attachments**: downloads are **authorized by membership** and sent with
  `Content-Disposition: attachment` (forces a download instead of rendering → mitigates
  stored XSS via SVG/HTML); uploading requires editor rights; the file name on disk is
  random (no path traversal).
- **Injection**: Prisma **parameterizes** every query; the only raw SQL (`pg_notify` in
  the bus, `TRUNCATE` in the tests) uses **parameters/constants**, never user input.
  Search uses `ILIKE` through Prisma (parameterized).
- **XSS**: React **escapes** user content (titles, comments, notifications). The only
  `dangerouslySetInnerHTML` is the theme script, a **constant** with no input.
- **Secrets**: passwords with **bcrypt** (cost 12); API tokens stored **hashed** (SHA-256)
  and shown only once; the cron secret is compared in **constant time**.
- **Sessions**: `httpOnly` cookie, `Secure` when the request arrives over HTTPS (directly
  or with `X-Forwarded-Proto: https` from the TLS proxy; it does not depend on `NODE_ENV`,
  so over `http://IP:3000` it is sent without `Secure`), `sameSite=lax`, expiry;
  **immediate revocation** (logout, password reset, forced sign-out). Behind a proxy, the
  proxy must send `X-Forwarded-Proto` (see
  [self-hosting.md](./self-hosting.md#https-and-domain-reverse-proxy)).
- **Mass-assignment protection**: every action validates with **zod** (field whitelist).
- **Login**: the per-account (email) limit always applies; the per-IP limit **only** with
  `TRUSTED_PROXY_HOPS > 0` (default 0: no per-IP limit). Attempts and lockouts are also
  audited. Values and configuration in
  [operations.md](./operations.md#login-rate-limiting) and
  [ADR 0009](./decisions/0009-in-memory-rate-limit.md).
- **Headers** (`next.config.ts` + `proxy.ts`):
  - Pages: **per-request nonce CSP** (`app/lib/csp.ts`): `script-src` only own scripts
    with a nonce and `'strict-dynamic'`, no `eval` in production, `frame-ancestors 'none'`,
    `object-src 'none'`, `base-uri`/`form-action 'self'`. The root layout reads the nonce
    from `x-nonce` for the inline theme script.
  - `/api/**`: `default-src 'none'` (JSON, SSE and downloads only).
  - `*.svg` (outside the `proxy.ts` matcher): `default-src 'none'; style-src
    'unsafe-inline'`, so an SVG opened directly cannot run scripts.
  - `Strict-Transport-Security: max-age=31536000` (without `includeSubDomains`),
    `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
    `Permissions-Policy`.
  - No `upgrade-insecure-requests`: it would break installations served over
    `http://IP:3000`. The reasoning behind each exception is in
    [`DECISIONES.md`](./DECISIONES.md).
- **Server Action request size**: `serverActions.bodySizeLimit` and
  `proxyClientMaxBodySize` are set to 11 MB (`next.config.ts`), just above the maximum
  attachment size (10 MB). Known limitation: the limit is global and Next applies it
  **before authentication**, so anyone can send up to 11 MB to an action; actions then
  reject anything that exceeds their own limits.

## Accepted risks

- **Password spraying with the default configuration**: with `TRUSTED_PROXY_HOPS=0` there
  is no per-IP or global limit, so trying the same password against many different emails
  is only slowed down by the bcrypt cost (the per-account limit does not catch it). Behind
  a trusted proxy, set `TRUSTED_PROXY_HOPS` to enable the per-IP limit. See
  [ADR 0009](./decisions/0009-in-memory-rate-limit.md#consequences).

## Future recommendations

- **Last-admin guard**: an explicit check that prevents deleting or demoting the last
  ADMIN of the instance.
- **Setup reset endpoint** (admin) instead of manual SQL.
- Email/Web Push and notification preferences (already on the [roadmap](./roadmap.md)).
- **Attachment uploads through a route handler** (`/api/...`) that authenticates before
  reading the body, so the global Server Action limit can be lowered.

## Reproducing the audit

```bash
pnpm audit                 # dependencies
pnpm lint && pnpm typecheck
pnpm test && pnpm test:integration   # includes authorization tests (IDOR, 403/404)
```

The adversarial multi-agent audit is rerun with the `orgtable-security-audit` workflow.

## Reporting a vulnerability

See [`SECURITY.md`](../SECURITY.md) at the repository root.
