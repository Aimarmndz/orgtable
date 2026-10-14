# ADR 0016 — Proprietary license (MARA-KASSA SL)

**Status:** superseded on 2026-10-14 (see [`docs/DECISIONES.md`](../DECISIONES.md#2026-10-14--agpl-30-or-later-license-with-attribution)) · **Date:** 2026-08-05 · **Supersedes:** [ADR 0005](./0005-agpl.md)

> This decision is no longer in force: on 2026-10-14 the project went back to the AGPL
> (AGPL-3.0-or-later with an attribution term). The current license is the one in
> [`LICENSE`](../../LICENSE). It is kept as a historical record.

## Context

The project was first published under AGPL-3.0 (ADR 0005). On 2026-08-05 the owner
replaced the text of `LICENSE` with a proprietary license in the name of MARA-KASSA SL
(commit `27c1ba9`), but the documentation, `package.json` and some app texts still said
AGPL or "open source". This ADR records the decision and aligns everything else with it.

## Decision

- The current license is the one in [`LICENSE`](../../LICENSE): all rights reserved by
  MARA-KASSA SL, use restricted to authorized people, and assignment to the company of the
  rights over contributions. The text of `LICENSE` is the only source; the other documents
  point to it without copying it.
- `package.json` declares `"license": "UNLICENSED"` (the value npm reserves for software
  without a public license to use it).
- The documentation and visible texts stop describing the project as open source.
- CI fails if references to the previous license reappear outside this ADR, ADR 0005 and
  the decision log.

## Alternatives considered

- **Keep AGPL-3.0 and restore `LICENSE`.** Rejected by the owner when making the change.
- **Dual license (AGPL + commercial).** Not considered; it would require publishing the
  code under the AGPL again.

## Consequences

- Copies distributed while AGPL-3.0 applied remain under that license for whoever received
  them: the change is not retroactive.
- The assignment of rights over contributions included in `LICENSE` is accepted by
  contributing, without a signature. Its validity under Spanish intellectual property law
  is doubtful; if external contributors join, a lawyer should review it, or a contributor
  license agreement (CLA) should be signed.
- `install.sh` and the installation docs still point to a public GitHub repository; if the
  repository is private, installing with anonymous `curl` does not work. The owner decides.
