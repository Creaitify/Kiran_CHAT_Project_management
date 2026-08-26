# KIRAN Platform

Merging a chat application and a project-management application into a single
product, built so that further modules can be plugged in later by other teams.

## Repository layout

| Path | What it is |
| --- | --- |
| `KIRAN-MGMT-main/` | Project-management app — Next.js web/admin/space apps, a Django API (`apps/api`), and a live collaboration server, in a Turborepo monorepo. |
| `CHATROOM-FINAL-main/` | `nexus-chat` — the chat application being folded into the shell. |
| `.claude/` | Agent configuration and project instructions. |

## Documentation

Start with the roadmap; it explains what is being built and, just as usefully,
what is deliberately being left out.

- **[INTEGRATION-ROADMAP.md](INTEGRATION-ROADMAP.md)** — the integration plan, success criteria, and explicit non-goals.
- **[DESIGN.md](DESIGN.md)** — design system and UI conventions.
- **[CONNECTORS.md](CONNECTORS.md)** — the configurable database/service connectors and the environment variables each one reads.

## Getting started

Both applications carry their own setup instructions and dependency manifests.
Configuration is supplied through environment variables — nothing is hardcoded.

Every app ships an `.env.example` listing the variables it reads. These files
are committed on purpose: they are the documentation for what needs to be set.
Copy one to `.env` and fill it in.

```bash
cp KIRAN-MGMT-main/.env.example KIRAN-MGMT-main/.env
```

Real `.env` files are gitignored and must never be committed.

## Status

Active development. Chat and project management are being brought under one
shell; the aim is that adding a third module is a registration plus a package,
not a pull request that touches shell internals.
