# Security policy

## Supported versions

orgtable is developed on the `main` branch, and security fixes land on `main`. Keep your
installation up to date with `scripts/update.sh`, which takes a backup and updates to the
latest `main` (see [`docs/operations.md`](./docs/operations.md#updates)).

## Reporting a vulnerability

**Do not** open a public issue for a security problem.

Use GitHub private vulnerability reporting: the repository's **Security** tab →
**Report a vulnerability**
([direct link](https://github.com/Aimarmndz/orgtable/security/advisories/new)). It only
works while the repository is public; while it is private, contact the author through
their profile, [github.com/Aimarmndz](https://github.com/Aimarmndz).

<!-- TODO: committed response time. Aimar decides it; until then, none is promised. -->

If you can, include the affected version or commit, a description, the steps to reproduce
it and the impact.

## Security posture and hardening

The project's security posture, the result of the latest audit and the hardening
recommendations are in [`docs/security.md`](./docs/security.md). The operations guide
(TLS/reverse proxy, backups, secrets) is in [`docs/self-hosting.md`](./docs/self-hosting.md)
and [`docs/operations.md`](./docs/operations.md).
