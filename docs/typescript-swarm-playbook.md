# TypeScript swarm playbook — app

Engagement-specific commands + conventions for the multi-agent swarm
running against this TypeScript / NestJS monorepo. Read alongside
[`USER-GUIDE.md`](USER-GUIDE.md), which is the org-canonical
methodology — this file is the TS-flavored command appendix per
`USER-GUIDE.md` Appendix B.

---

## Engagement profile

| Field | Value |
|---|---|
| Stack | TypeScript 5.5 / Node 20 / NestJS 10 / Apollo Server 4 / Drizzle ORM / Postgres 15 |
| Build tool | pnpm 9 workspaces |
| Test runner | vitest 2 (unit + integration); Testcontainers for the Postgres integration tier |
| Linter / formatter | ESLint 8 + Prettier 3 |
| Package layout | Monorepo: `apps/` + `libs/` + `tools/` + `contracts/` + `migrations/` + `infra/` |
| Agent classes | `typescript-domain-agent`, `typescript-api-agent`, `application-services-agent`, `foundations-agent`, `spec-adherence-agent`, `code-review-codex` (see `orchestration/ledgers/agent-class-registry.yaml`) |
| Worker container image | `scion-claude:latest` (vanilla; Node + pnpm are pre-installed; Docker socket mounted for Testcontainers via scion harness-config volumes) |

---

## Command table

| Concept | `USER-GUIDE.md` reference | TypeScript / pnpm command |
|---|---|---|
| Type-check | Phase 4 — gate-check chain | `pnpm typecheck` (per-package: `pnpm --filter <pkg> typecheck`) |
| Unit + integration test | Phase 4 — gate-check chain | `pnpm test` |
| Unit test only | Phase 4 | `pnpm test:unit` (per-app: `pnpm --filter @charliehealth/app test:unit`) |
| Integration test only | Phase 4 | `pnpm test:integration` |
| Build (compile) | Phase 4 | `pnpm build` |
| Lint | Phase 4 | `pnpm lint` |
| Catalog validator (REQs) | Phase 1 — catalog discipline | `pnpm req-lint` (calls `tools/req-lint/src/lint.ts`; `--catalog requirements --output orchestration/reviews/req-lint-<ts>.json` for Phase 2 audit runs) |
| Catalog test-coverage | Phase 1 — after every 3-5 REQs; Phase 6/7 — manager audits | `pnpm req-coverage` (calls `tools/req-coverage/src/coverage.ts`; `--soft` for advisory; `--gate-severity critical` to narrow) |
| Compose worker prompts | Phase 4 — dispatch | `pnpm compose-prompts` (calls `tools/prompt-composer/src/compose.ts`) |
| Validate prompt composition | Phase 4 — dispatch (per-track) | `pnpm validate-prompt-composition --track-meta <path>` (alias for `compose-prompts --validate-only`) |
| Track-meta path scope | Phase 4 — wave planning + Phase 9 preflight | `pnpm check-track-meta-paths` (calls `tools/check-track-meta-paths/src/check.ts`) |
| Run gate-check | Phase 6 — synchronization gates | `./orchestration/gates/gate-check.sh <gate-id>` |
| Captain preflight (Phase 0) | Phase 0 | `./tools/captain-preflight/check.sh` |
| Render live session log | Phase 6 | `python3 tools/session-log/render.py` (or rely on the Stop hook) |
| Run the service locally | Phase 4 | `pnpm --filter @charliehealth/app start:dev` (after bringing the local DB up) |
| Bring up local Postgres | Phase 0.6 | `docker compose -f infra/docker-compose.yml up -d postgres-app` |

---

## TDD discipline

Per `orchestration/prompts/base.md`, every track follows strict TDD:

1. **`[test] <criterion-id> failing`** — a `vitest` test in
   `<package>/test/<area>.spec.ts` asserts the YAML predicate from the
   relevant `requirements/REQ-*.md`. The test must fail for the predicted
   reason. The test class / `describe` block carries the tag pattern
   `@req REQ-X @criterion <id>` in its name so `req-coverage` can detect
   it (e.g. `describe('@req REQ-CAP-BOOK-APPOINTMENT @criterion slot-grid-conformance', …)`).

2. **`[impl] <criterion-id> passing`** — the production change that
   turns the failing test green. NestJS DI via `@Injectable()` + module
   composition; Drizzle queries + schema; Zod validators at the boundary.

3. Repeat per criterion. **One criterion per commit pair.** Manager
   audits the commit graph at merge time.

Workers MUST run `pnpm typecheck && pnpm test` locally before each push
(see `base.md` step 3). The image has Node + pnpm pre-installed; the
Testcontainers Postgres needs the docker socket mounted (see
`orchestration/image-dependency-manifest.yaml`).

---

## Track naming (this engagement)

Follows the methodology-level convention in `USER-GUIDE.md` Appendix D
— Track naming convention. The eight type prefixes (`domain-`, `app-`,
`service-`, `contract-`, `meta-`, `foundation-`, `helper-`,
`integration-`) are fixed at the methodology level; the body convention
is also fixed (plural noun for `domain-*`, verb-noun for `app-*`,
full-name for `service-*`, etc.).

TypeScript-specific specifics on top of the methodology:

- All track-ids are **kebab-case** (matches our package + filename
  conventions across the monorepo).
- Wave prefix uses the wave number directly without separator: `w1-`,
  `w2-`. Per-wave-batch invocations of a permanent meta-track also
  carry the wave prefix: `w1-meta-compose`, `w2-meta-compose`.
- Branch convention follows the track-id verbatim: `swarm/w1-domain-slots`,
  `swarm/w1-app-cancel-appointment`.
- Done marker on a worker branch: `[complete:<track-id>]` (e.g.
  `[complete:w1-domain-slots]`).

Example track IDs you'll see in this engagement's wave plan:

| Type | Example IDs (some hypothetical until wave plan is authored) |
|---|---|
| `domain-` | `w1-domain-slots`, `w1-domain-appointments`, `w2-domain-care-plans`, `w2-domain-participants` |
| `app-` | `w1-app-book-appointment`, `w2-app-cancel-appointment`, `w2-app-record-no-show`, `w2-app-check-in-appointment`, `w2-app-query-slots` |
| `service-` | `w1-service-bps`, `w1-service-individual-therapy`, `w2-service-group-therapy`, `w2-service-psychiatry` |
| `contract-` | `w1-contract-events@v1.0.0`, `w2-contract-graphql-sdl@v1.0.0` |
| `meta-` | `w1-meta-compose`, `w1-meta-gate`, `w1-meta-propagate` (re-invoked every wave) |
| `foundation-` | `w1-foundation-database`, `w1-foundation-timezone`, `w1-foundation-tenant-isolation` |
| `helper-` | `w2-helper-checkin-state-machine`, `w2-helper-cascade-attribution` |
| `integration-` | `w3-integration-elation-ehr`, `w4-integration-world-model` |

## Package conventions

- **Test files**: `*.spec.ts` (unit) live next to source in `src/`; `*.spec.ts` (integration) live under `test/`.
- **Tagged tests**: `describe('@req <REQ-ID> @criterion <criterion-id>', …)` — required for `req-coverage` to map tests to predicates.
- **Imports**: workspace packages use `@charliehealth/<pkg>` aliases (NodeNext resolution; declared via `pnpm-workspace.yaml` + `workspace:*` semver).
- **Hexagonal module boundaries** (enforced by `forbidden_patterns` per agent class):
  - `libs/domain` — pure TS core. NO infrastructure imports (`drizzle-orm`, `pg`, `@nestjs/*`, `fs`, `net`). Holds entities, value objects, domain services, and inbound + outbound port interfaces. Depends only on `libs/shared-kernel`.
  - `libs/application` — use cases that orchestrate the domain via ports. No NestJS decorators here; that's wired at the composition root. Depends on `libs/domain` + `libs/shared-kernel` only.
  - `libs/inbound-adapters` — **shared inbound types** only: GraphQL scalars (Timestamp, Money, UUID), federation `@key` directive constants, DTO shapes that cross the wire. No `@Resolver` / `@Controller` classes — those live in `apps/app/src/`.
  - `libs/outbound-adapters` — driven adapters (persistence/, integrations/, messaging/, auth/). Each implements one or more domain outbound ports. `persistence/` owns Drizzle schema + repositories.
  - `libs/shared-kernel` — cross-layer primitives (`Result`, `Clock`, `DomainError`, branded UUIDs). Depends on nothing else in the workspace.
  - `apps/app` — **NestJS composition root + live inbound surface**: `main.ts`, `app.module.ts`, and the actual `@Resolver` / `@Controller` / webhook receiver classes under `src/{graphql,rest,webhooks}/`. NestJS-idiomatic shape: resolvers ship with the app, shared wire types ship in `libs/inbound-adapters/`.

---

## Agent-class ↔ path scope

The composer reads `orchestration/ledgers/agent-class-registry.yaml`
and refuses to write outside the declared `allowed_paths`:

- `typescript-domain-agent` → `libs/domain/src/` + `libs/domain/test/`
- `typescript-api-agent` → `apps/app/src/{graphql,rest,webhooks}/` (live @Resolver / @Controller / webhook classes) + `apps/app/test/` + `libs/inbound-adapters/src/` (shared scalars, federation directives, DTOs) + `libs/inbound-adapters/test/`
- `application-services-agent` → broad slice: `libs/domain/`, `libs/application/`, `libs/inbound-adapters/` (shared types), `libs/outbound-adapters/{persistence,integrations,messaging}/`, `apps/app/` (resolvers + composition), `migrations/`
- `foundations-agent` → cross-cutting: `libs/shared-kernel/`, `libs/outbound-adapters/{auth,persistence}/`, `libs/inbound-adapters/src/` (scalars + federation + wire DTOs), `libs/domain/src/time/`, `apps/app/src/` (AppModule + bootstrap + graphql/rest/webhooks wiring), `migrations/`, plus root config (`package.json`, `pnpm-workspace.yaml`, `tsconfig.*`, `infra/`). Broadened scope granted per Captain decision when a foundation track lands cross-cutting scaffold.
- `spec-adherence-agent` → `orchestration/reviews/` ONLY. Auditor MUST NOT modify impl code.
- `code-review-codex` → `orchestration/reviews/` ONLY. Cross-model auditor (Codex / gpt-5.5).

> [!NOTE]
> **Co-existence with Scion Agent Templates:**
> Even though this engagement utilizes **Scion Agent Templates** (which canonically define container infrastructure details like images, harnesses, and base system prompts at the CLI/Grove level), the `agent-class-registry.yaml` remains **strictly required** at the repository level. 
> 
> The registry serves three distinct functions:
> 1. **Dynamic Prompt Composition:** The `prompt-composer` reads the registry to extract the `allowed_paths` and `forbidden_patterns` to dynamically inline them into each track's composed prompt (`orchestration/prompts/composed/<track-id>.md`).
> 2. **Template Name Resolution:** The Manager uses `yq` to read the registry at runtime and resolve the abstract `agent_class` ID to the concrete Scion template name before issuing a `scion create <track-id> -t <template>` command.
> 3. **Pre-flight & Path Validation:** The `captain-preflight/check.sh` and `check-track-meta-paths` tools use the registry's path configurations to verify that planned track-meta files do not target deliverables outside the agent's allowed codebase directories.

---

## Image-dependency manifest

`orchestration/image-dependency-manifest.yaml` declares what tools the
worker image (`scion-claude:latest`) must contain. Captain preflight
Step 0.6 probes the image at engagement boot:

- `git` — branch ops
- `node` (≥ 20) — runtime
- `pnpm` (≥ 9) — workspace orchestration
- `docker` (CLI) — Testcontainers needs to spawn sibling containers; the
  host docker / podman socket must be mounted into worker containers via
  scion harness-config volumes (see USER-GUIDE.md § 0.6 for the macOS
  podman-socket bridging pattern)

If a probe fails, preflight surfaces the manifest's remediation block
and refuses to authorize dispatch.

---

## Codex review setup (one-time per Captain machine)

See [`USER-GUIDE.md`](USER-GUIDE.md) §Step 0.4 — "Codex (OpenAI) credentials for the `code-review-codex` agent" for the canonical procedure (Path A — API key, Path B — OAuth file, plus the required `CODEX_CONFIG` model-pin secret). This engagement's `code-review-codex` template (`orchestration/scion-templates/code-review-codex/`) is the consumer; the model is pinned to `gpt-5.5` with `model_reasoning_effort = "xhigh"` via the `CODEX_CONFIG` file secret, and `tools/captain-preflight/check.sh` Step 0.4 probes both auth-path and config-pin presence at user + grove scope.

## Cross-links

- `USER-GUIDE.md` — org-canonical methodology (read first)
- `SWARM-QUALITY-FRAMEWORK.md` — 6 categories of swarm mistakes + prevention (Category G covers cross-model review)
- `requirements/README.md` — REQ catalog overview + authoring template
- `orchestration/prompts/base.md` — worker rule-pack (TDD, tenant isolation, stub-ledger discipline)
- `orchestration/prompts/code-review-rule-pack.md` — engagement-side cross-model review rule-pack
- `orchestration/prompts/manager-kickoff.md` — manager system prompt (Lifecycle Step 6.5 spawns code-review-codex in parallel with spec-adherence-agent)
- `~/.scion/templates/code-review-codex/` — the Scion template declaring harness=codex + auth-file mode
- `~/projects/appointment-swarm` — prior V2 engagement (tech-stack reference; this repo is a clean-room rebuild on the hardened methodology)
