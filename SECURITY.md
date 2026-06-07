# Security Policy

## Supported versions

orgtable is developed on the `main` branch. Security fixes land on `main`; self-hosters
should track the latest release. Always run the most recent version.

## Reporting a vulnerability

Please **do not** open a public issue for security problems. Instead, use GitHub's
**private vulnerability reporting** for this repository
(`Security` tab → `Report a vulnerability`), which opens a confidential advisory with the
maintainers.

Include, where possible: affected version/commit, a description, reproduction steps, and
the impact. We aim to acknowledge reports promptly and to coordinate a fix and disclosure.

## Hardening and posture

The project's security posture, the result of the latest audit, and operational hardening
recommendations are documented in [`docs/security.md`](./docs/security.md). Operational
guidance (TLS/reverse proxy, backups, secrets) is in
[`docs/self-hosting.md`](./docs/self-hosting.md) and
[`docs/operations.md`](./docs/operations.md).
