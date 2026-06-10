# webapp-template-scion-demo

A webapp template for **spec-driven development** with a Scion multi-agent
(swarm) workflow. Fork of `project-template`, simplified for building
full-stack web applications without heavy infrastructure dependencies.

## What's different from project-template

| Removed | Replaced with |
|---------|---------------|
| GraphQL / Apollo / Federation | REST endpoints (NestJS controllers) |
| Drizzle ORM + Postgres | In-memory data store (no DB required) |
| `contracts/` (SDL + event schemas) | Removed |
| `migrations/` (Drizzle) | Removed |
| `infra/` (Docker Compose) | Removed |
| `libs/inbound-adapters` + `libs/outbound-adapters` | Removed |

| Added | Purpose |
|-------|---------|
| `apps/web/` | Vite + React frontend (minimal -- add your own styling) |
| `apps/api/` | NestJS REST API with in-memory data |
| Vite proxy | `/api` requests proxy to the API server in dev |

## Quick start

```bash
pnpm install
pnpm dev          # starts both web (5173) and api (3001)
pnpm dev:web      # frontend only
pnpm dev:api      # backend only
```

## Repo layout

```
apps/
  web/             <- Vite + React frontend
  api/             <- NestJS REST API (in-memory, no DB)

libs/
  domain/          <- entities, value objects, ports (pure TS)
  application/     <- use cases (pure TS)
  shared-kernel/   <- Result type, Clock port, errors

requirements/      <- REQ catalog (REQ Spec v4 format)
  _template.md     <- copy for each new REQ
  domains/         <- shared domain context files
  README.md        <- format reference

docs/              <- methodology + playbooks
orchestration/     <- swarm coordination state
tools/             <- CLI utilities (req-lint, req-coverage, etc.)
```

## Spec-driven workflow

1. **Author REQs** in `requirements/` using `_template.md`
2. **Author domain files** in `requirements/domains/` for shared context
3. **Validate**: `pnpm req-lint`
4. **Implement** capability tracks against the REQ acceptance criteria
5. **Check coverage**: `pnpm req-coverage`

See [`docs/USER-GUIDE.md`](docs/USER-GUIDE.md) for the full methodology
and [`requirements/README.md`](requirements/README.md) for REQ authoring.

## Tech stack

- **Runtime**: Node >= 20.10
- **Package manager**: pnpm@9.15.9 (workspaces)
- **Language**: TypeScript 5.5 (strict)
- **Frontend**: Vite 5 + React 18
- **Backend**: NestJS 10 (REST only, no GraphQL)
- **Testing**: Vitest 2
- **Architecture**: Hexagonal (domain + application layers are framework-free)
