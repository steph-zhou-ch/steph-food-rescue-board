# docs/ — engagement documentation

All design + methodology docs live here. Code lives one level up
(`apps/`, `libs/`, `contracts/`, `migrations/`, `infra/`); REQs and
swarm runtime state live at the repo root (`requirements/`,
`orchestration/`).

## Read order

| You are… | Start here |
|---|---|
| **A new Captain** | [`USER-GUIDE.md`](USER-GUIDE.md) § 0 → § 5 → [`typescript-swarm-playbook.md`](typescript-swarm-playbook.md) |
| **PM + Tech Lead pair kicking off** | [`pm-techlead-tag-team.md`](pm-techlead-tag-team.md) |
| **Designer joining a frontend track** | [`designer-onboarding.md`](designer-onboarding.md) → [`../clients/designs/README.md`](../clients/designs/README.md) → [`design-in-sdd.md`](design-in-sdd.md) |
| **PM authoring a REQ** | [`../requirements/README.md`](../requirements/README.md) → [`../requirements/_template.md`](../requirements/_template.md) → a worked example |
| **Architect tracing the design** | [`design/00-overview/`](design/00-overview/) → [`design/20-domain/`](design/20-domain/) → [`design/30-architecture/`](design/30-architecture/) |
| **Stakeholder reading the PRD** | [`prds/`](prds/) |
| **Adopting the swarm in another stack** | [`USER-GUIDE.md`](USER-GUIDE.md) end-to-end → [`USER-GUIDE.md` §Appendix B](USER-GUIDE.md#appendix-b--onboarding-a-new-platform) |

## What's in docs/

```
USER-GUIDE.md                       ← org-canonical methodology (stack-agnostic)
SWARM-QUALITY-FRAMEWORK.md          ← 6 swarm anti-patterns + prevention
typescript-swarm-playbook.md        ← TS / NestJS / Apollo / Drizzle commands
pm-techlead-tag-team.md             ← PM + Tech Lead onboarding playbook
designer-onboarding.md              ← Designer onboarding (Figma MCP + design.yaml workflow)
design-in-sdd.md                    ← Rationale for designs as a first-class spec artifact
README.md                           ← (this file)

design/                             ← Phase 1.4 design docs — PM + Tech Lead author
  00-overview/                      ← vision · assumptions · glossary (Phase 1.4 gate)
  10-discovery/                     ← stakeholder map · as-is flow · risks · competitive scan
  20-domain/                        ← entities · state machines · policies · events
  30-architecture/                  ← overview · data model · runtime · security · observability · adr/
  40-api/                           ← GraphQL · REST · events · error taxonomy · webhooks
  50-agents/                        ← fleet · wave plan · review cadence · escalation policy
  60-rollout/                       ← deployment · migration · comms · runbook · rollback

prds/                               ← service-level + per-capability PRDs
images/                             ← diagrams (manager↔scion flow, sequence, multi-wave timeline)
```

## Authorship + sign-off cadence

| Document | Owner | Cadence | Sign-off gate |
|---|---|---|---|
| [`USER-GUIDE.md`](USER-GUIDE.md), [`SWARM-QUALITY-FRAMEWORK.md`](SWARM-QUALITY-FRAMEWORK.md), [`typescript-swarm-playbook.md`](typescript-swarm-playbook.md) | Captain | Per-engagement (rarely changes) | Captain owns |
| [`design/00-overview/vision.md`](design/00-overview/) + assumptions + glossary | PM + Tech Lead | Phase 1.4 — first cycle | **Phase 1.4 stop-and-think** (USER-GUIDE.md §Phase 1.4) — must be approved before Phase 2 |
| [`design/10-discovery/`](design/10-discovery/) | PM + Tech Lead | Phase 1.4 first cycle; revised when scope shifts | Tech Lead owns the risk register; PM owns the rest |
| [`design/20-domain/`](design/20-domain/) | PM + Tech Lead | Phase 1.4 first cycle; per-wave when new entities land | Tech Lead owns; PM signs off on glossary alignment |
| [`design/30-architecture/`](design/30-architecture/) | Tech Lead | Phase 1.4 first cycle; per-wave for new ADRs | Tech Lead owns |
| [`design/40-api/`](design/40-api/) | Tech Lead | Phase 1.4 + per-wave when SDL evolves | Tech Lead owns; downstream consumers reviewer |
| [`design/50-agents/`](design/50-agents/) | Captain + Tech Lead | Phase 1.4 (first wave plan); per-wave updates | Captain owns |
| [`design/60-rollout/`](design/60-rollout/) | Tech Lead + PM | Phase 1.4 sketch; finalized pre-cutover | Tech Lead + PM + Ops sign-off |
| [`prds/service-prd.md`](prds/) | PM | Phase 1.4 first draft; per-wave appends | **Phase 1.4 stop-and-think** — PM + Tech Lead + Clinical + Ops sign |
| [`../clients/designs/<surface>/design.yaml`](../clients/designs/) | Designer | Per-surface; re-synced after each Figma edit | `G.design-sync` gate must pass before frontend track merges |

## How docs/ relates to the rest of the repo

- **[`../requirements/`](../requirements/)** — REQs in REQ Spec v3 are the testable contracts these design docs explain. PRDs cite REQs by id; design docs trace decisions back to REQs.
- **[`../clients/designs/`](../clients/designs/)** — per-surface Figma manifests authored by the Designer (see [`designer-onboarding.md`](designer-onboarding.md)). Bidirectionally linked to REQs via the `designs:` frontmatter field; gated by `G.design-sync`.
- **[`../orchestration/`](../orchestration/)** — live swarm runtime state (track-meta, dispatch briefs, status board, audit reports). Authored at Phase 4; consumed by the manager + workers.
- **[`../apps/`](../apps/) + [`../libs/`](../libs/)** — the code that realizes the design. Hexagonal layout: `domain/` (core) + `application/` (use cases) + `inbound-adapters/` + `outbound-adapters/` + `shared-kernel/`.
- **[`../tools/`](../tools/)** — CLI utilities (req-lint, req-coverage, prompt-composer, design-sync, etc.) that mechanically check the contracts these docs describe.

When a design doc and a REQ disagree, the REQ wins (it's the testable
contract); update the design doc. When a design doc and code disagree,
investigate which is right (sometimes code drifted; sometimes the doc
got stale during a wave); update the loser.
