# Documentation

Map of everything under `docs/` and the root-level docs that complement it.
Pick the entry point that matches what you're doing.

## I want to…

| Goal | Where |
|---|---|
| **Understand the system** | [`/ARCHITECTURE.md`](../ARCHITECTURE.md) → [`adr/`](adr/) |
| **Run it locally for the first time** | [`/RUN.md`](../RUN.md) → [`runbooks/platform-bootstrap.md`](runbooks/platform-bootstrap.md) |
| **Day-to-day dev loop** | [`/DEVELOPMENT.md`](../DEVELOPMENT.md) + [`/COMMANDS.md`](../COMMANDS.md) |
| **Onboard a new tenant** | [`runbooks/tenant-onboarding.md`](runbooks/tenant-onboarding.md) |
| **Read code style / project rules** | [`/CONVENTIONS.md`](../CONVENTIONS.md) + [`/CLAUDE.md`](../CLAUDE.md) |
| **Open a PR** | [`/CONTRIBUTING.md`](../CONTRIBUTING.md) |
| **See what's planned / pending** | [`/TODO.md`](../TODO.md) |
| **See what shipped** | [`/CHANGELOG.md`](../CHANGELOG.md) |

## Layout

```
docs/
├── README.md           ← this file
├── adr/                ← architecture decision records (immutable, append-only)
├── design/             ← specs for features in flight (mutable until merged)
└── runbooks/           ← step-by-step operational procedures
```

### `adr/` — Architecture Decision Records

Decisions worth a paragraph of rationale. Once accepted, an ADR is not edited
in-place — superseded by a new ADR if the decision changes. Index in
[`adr/README.md`](adr/README.md).

### `design/` — feature specifications

Working documents that describe a feature's intended behaviour before (and
during) implementation. They're the source of truth for "what should this do?"
while a feature is being built. Once shipped, the spec stays as historical
context but the canonical answer becomes the code + ADR.

Current specs:

- [`design/tenant-bootstrap.md`](design/tenant-bootstrap.md) — two-phase tenant
  provisioning + onboarding flow.

### `runbooks/` — operational procedures

How a human operator (staff, on-call, dev) performs a recurring task. Each
runbook has a clear "when to run this" trigger, the exact steps, and what
"done" looks like.

Current runbooks:

- [`runbooks/platform-bootstrap.md`](runbooks/platform-bootstrap.md) — create
  the first super_admin on a fresh database (one-shot per environment).
- [`runbooks/tenant-onboarding.md`](runbooks/tenant-onboarding.md) — provision
  a new tenant from voragine-console and walk the owner through Phase B.

## Conventions

- ADRs are numbered sequentially (`NNN-kebab-case.md`) and never renumbered.
- Specs in `design/` use the same kebab-case naming as the feature/branch.
- Runbooks are named after the procedure, not the system
  (`tenant-onboarding.md`, not `tenant-config.md`).
- Root-level docs (`README.md`, `RUN.md`, `DEVELOPMENT.md`, …) are entry points
  by convention — they stay at root because external readers and IDEs expect
  them there. Anything more domain-specific goes under `docs/`.
