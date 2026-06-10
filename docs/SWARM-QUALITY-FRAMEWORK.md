# Swarm Quality Framework

**The seven categories of swarm mistakes the methodology is built to prevent.**

Derived from a post-mortem of the prior NestJS engagement's V2 run,
which produced 16 PRs of post-swarm cleanup before the service was
shippable. Every cleanup PR mapped to one of five root-cause categories
the swarm itself should have caught. This doc names those categories,
gives diagnostic vocabulary, and points at the mechanism in this repo's
methodology that prevents each.

Use this when:

- **Planning a wave** — review the seven categories; ensure your gate
  set covers each.
- **Debriefing a wave** — every fix-PR or cleanup-PR should map to one
  category. If it doesn't, you've found a sixth category — add it.
- **Defending a methodology change** — "we added gate X" must answer
  "which of the seven categories does X close?"

---

## A — Gate was lying

**Root cause**: a gate exists but doesn't catch what it claims to catch.

**Concrete examples from the prior engagement**:
- The test harness used a transpiler (`esbuild`) that didn't enforce
  strict TypeScript types. Tests passed in vitest; the same code failed
  `tsc --noEmit` in CI. Result: 4 cleanup PRs for type errors that
  should have been caught at write-time.
- "Smoke specs" existed but only asserted `expect(result).toBeDefined()`
  — they ran, they passed, they proved nothing.
- `runtime-packaging-gate` checked exports in `package.json` but didn't
  walk transitive dist artifacts; `.ts` files leaked into runtime
  artifacts undetected.

**Diagnostic**: every gate must include in its description **what it
will MISS**. A gate without a stated false-negative profile is a
honeypot.

**Prevention in this methodology**:
- `pnpm typecheck && pnpm test` is the unified gate — chains
  `pnpm req-lint` + `pnpm check-track-meta-paths` + `tsc --noEmit` +
  `vitest run`. None of these are
  optional; the failure profile of each is documented.
- `validatePromptComposition` proves each track-meta can be composed
  BEFORE dispatch; impossible-to-compose tracks fail immediately rather
  than producing a worker that spirals.
- Phase 9 verification suite (`USER-GUIDE.md`) names six explicit
  capability gates: build / test / federation compose / Pact / events /
  healthcheck. Each is a real command with predicted output per wave
  milestone.

---

## B — No composition owner

**Root cause**: every track produces its own slice; nobody owns wiring
the slices into a bootable system.

**Concrete examples from the prior engagement**:
- `AppModule` had `controllers: [], providers: []` after the first wave
  completed. Three impl tracks each wrote use cases; none added their
  module to `AppModule`. Service wasn't bootable.
- Drizzle adapters for Cancel/CheckIn/Fulfill were never wired into the
  composition root. The unit tests passed; the integrated app crashed
  at startup.

**Diagnostic**: at wave-end, can you run the actual application binary
and exercise one mutation end-to-end? If not, you have no composition
owner.

**Prevention in this methodology**:
- The **meta-compose** meta-track concept (see
  `USER-GUIDE.md` Phase 4 — meta-tracks): a permanent track the manager
  spawns alongside capability tracks, every wave. Its job is to wire
  whatever the capability tracks produced into the running application.
- Phase 9 verification suite check #6 (`pnpm --filter app start` + `curl
  /health`) is the bootable-app assertion. After Wave 1 closes, this
  must return `{"status":"UP"}`. Before then, it correctly fails (the
  gap signal that capability work hasn't wired the healthcheck path).

---

## C — No pattern propagation

**Root cause**: track A discovers the right pattern for solving problem
X; track B solves the same problem differently; nobody propagates A's
pattern to B.

**Concrete examples from the prior engagement**:
- `app` got a proper JWT verifier (canonical pattern).
  `world-model-api` kept a shim. The shim eventually shipped to prod;
  cleanup was PR #15 fixing JWKS verification asymmetry.
- `cancel-appointment` used per-request transaction-bound adapters
  (correct). `book-appointment` used a global pool. Cleanup PR #9 unified.

**Diagnostic**: at wave-end, do two siblings (sibling apps, sibling use
cases) implement the same cross-cutting concern in different ways? If
yes, no pattern propagation.

**Prevention in this methodology**:
- The **meta-propagate** meta-track concept (see
  `USER-GUIDE.md` Phase 4): a permanent track that maintains a
  canonical-patterns registry and proactively opens propagation tracks
  in wave N+1 for any pattern not yet applied across all applicable
  surfaces.
- The contract ledger (`orchestration/ledgers/contract-ledger.yaml`)
  captures cross-track contracts; spec-adherence audits flag when a
  contract is implemented inconsistently across tracks.
- Cross-cutting packs (`cross_cutting_packs:` in track-meta) inject the
  same rule-pack guidance into every track in scope.

---

## D — Layer rules in comments, not gates

**Root cause**: architectural intent is documented in prose; the build
doesn't enforce it.

**Concrete examples from the prior engagement**:
- `libs/domain/src/ports.ts` started with a comment: "libs/domain sits
  at the bottom of the stack — no infrastructure imports." The SAME
  wave that wrote that comment imported `drizzle-orm` into
  `libs/domain`. Cleanup PR #8 cut the cycle.
- Test code reached across module boundaries because no compiler
  visibility rule prevented it. Cleanup PR #11 extracted `libs/schema`
  to break the import.

**Diagnostic**: if your "architectural rule" lives in a `README.md` or
a `// rule:` comment, it's not a rule — it's a hope.

**Prevention in this methodology**:
- `agent-class-registry.yaml` declares `allowed_paths` and
  `forbidden_patterns` for every agent class. Workers physically cannot
  write outside their scope (the audit catches violations).
- `pnpm check-track-meta-paths` enforces the engagement's stack convention
  (TypeScript V2 monorepo paths for this TypeScript engagement, not the
  Kotlin layout the prior reference engagement used).
- **Future work** in this engagement: a `layered-architecture-gate`
  parallel to `tools/build-checks/layered-architecture-gate.ts` in the
  prior engagement — a pnpm script that asserts package boundaries
  declared in a manifest file (e.g. `libs/domain` must not import from
  `libs/outbound-adapters/src/persistence` or any NestJS module). See `USER-GUIDE.md` Appendix C
  (mechanical gates) — flagged as future.

---

## E — Exemptions became permanent

**Root cause**: a gate produced a finding; the team added an exemption
to silence it "for now"; "for now" became "forever."

**Concrete examples from the prior engagement**:
- `EXTENSIBILITY_EXEMPT_PENDING_REFACTOR` had one entry. The entry
  outlived the swarm. Cleanup PR #14 removed it months later.
- Stale `pnpm` dependencies persisted because the dep-version gate had
  an exemption with no ticket, no deadline, no owner.

**Diagnostic**: every exemption must have an owner, a ticket, and a
deadline. If your exemption file has rows missing any of those three
fields, you have permanent exemptions in disguise.

**Prevention in this methodology**:
- The stub-ledger (`orchestration/ledgers/stub-ledger.yaml`) is the
  ONLY allowed location for production stubs. Every entry MUST carry:
  - `path` — the file containing the stub
  - `type` — `todo` / `mock` / `fake`
  - `owner` — `@handle` responsible
  - `expiry_wave` — the wave number by which it MUST be replaced
  - `reason` — why the stub exists
- The Captain reviews the stub-ledger at every wave closure; expired
  stubs that haven't been replaced are escalated, not silently carried.
- **Future work** in this engagement: an `exemption-deadline-gate`
  parallel to the prior engagement's
  `tools/build-checks/exemption-deadline-gate.ts` — fails the build if
  any stub is past its `expiry_wave` and the wave has closed.

---

## F — Image dependency drift

**Root cause**: workers are booted with a container image that lacks
the engagement's primary toolchain. The failure surfaces mid-wave as
an informational escalation; the worker hand-verifies code instead of
running gates; the swarm degrades silently from "test-driven" to
"inspection-only." Same-class problem one level up: the audit can't
compile-and-execute the code, so its review is textual at best.

**Concrete examples from the prior Kotlin engagement (paused 2026-05-25)**:
- Wave-1 workers ran on `scion-claude:latest` which has no JDK. `./gradlew check` failed at bootstrap. Workers filed informational escalations, hand-verified each TDD pair, pushed every pair so the manager could observe. Tracks succeeded — but `./gradlew test` was never actually run during the impl pass; the spec-adherence audit became the only real validator. The audit itself had the same gap.
- (Counterfactual) A Python service variant: `pytest` not found because Python wasn't in the base image. Same protocol degradation by a different name.

**Diagnostic**: at preflight time, can you
`<container-runtime> run --rm <agent_image> bash -c '<probe>'`
for every tool your workers need? If you've never run that probe, your
image has unknown dependency gaps. If you ran it once and accepted
gaps, the next stack-mismatched escalation is in your future.

**Prevention in this methodology**:
- **`orchestration/image-dependency-manifest.yaml`** declares the
  engagement's worker-image dependencies explicitly: `agent_image`,
  `required_tools[]` (name, purpose, probe, optional `min_version` +
  `version_probe`, multi-line `remediation`). Single source of truth.
- **Captain preflight Step 0.6** reads the manifest and probes the
  image via `podman run --rm` (or docker), one container-spawn per
  declared tool. Any non-zero probe surfaces the manifest's full
  remediation block and fails preflight loudly. Phase 5 dispatch is
  unsafe until probes pass.
- **Three remediation paths** documented in the manifest itself:
  A. SDKMAN-style runtime fallback (tactical; cheap; needs outbound
     network at boot).
  B. Bake into base image (broad; pollutes other engagements).
  C. Per-engagement image variant (durable; clean separation;
     recommended for long-running engagements).
- **Worker rule-pack** (`orchestration/prompts/base.md`) carries a
  Sandbox Bootstrap section so a worker can recover from a
  preflight-missed gap AND surface a `kind: <tool>-bootstrap-failed`
  escalation so the manifest gets updated before the next engagement.

---

## G — Same-model blind spots

**Root cause**: the audit model has the same reasoning patterns,
priors, and failure modes as the impl model. If Opus 4.7 systematically
misreads a predicate during impl, an Opus 4.7 audit may not catch it
because both models share architectural reasoning. The swarm passes
its own validation but produces predictable-to-the-model-family bugs.

**Concrete examples**:
- Two Claude-on-Claude review cycles approve impl code that contains a
  subtle SQL-injection vector via a dynamic Drizzle query; both
  reviewers focused on predicate-fidelity (the contract) and missed
  the implementation-level security flaw. A different-model reviewer
  (Codex / Gemini) would have looked at the SAME code with different
  priors and noticed.
- Claude implements and audits an N+1 GraphQL resolver pattern that
  passes the unit test and the integration test (small fixture data
  doesn't trigger the N+1 cost) — production triggers it. Codex would
  have flagged "this child resolver fires per parent without a
  DataLoader" from idiomatic-NestJS priors.

**Diagnostic**: are your reviewers the same model family as your
implementers? If yes, your audit is single-perspective by
construction. Look at the last 5 rejected-by-Claude findings — how
many of them found bugs Claude itself wrote? If the answer is "all
self-found bugs are syntactic or trivially predicate-drift, never
deep idiomatic or security findings," you have the gap.

**Prevention in this methodology**:
- **`code-review-codex` agent class** (Scion template at
  `orchestration/scion-templates/code-review-codex/`) runs on the
  Codex harness (model = `gpt-5.5` via ChatGPT-OAuth auth-file). It
  spawns in PARALLEL with `spec-adherence-agent` (which runs on
  Claude) after impl tracks complete. Both verdicts gate the
  staging→main merge — `rejected` from either auditor blocks merge
  and triggers a fix-batch.
- **Distinct review focus**: spec-adherence-agent (Claude) covers
  predicate-fidelity + impl-honors-predicate + coverage-completeness.
  code-review-codex (Codex) covers idioms / security / missed edge
  cases / architectural drift / dead code. The two are explicitly
  non-overlapping by design (see each template's
  `system-prompt.md`).
- **Two-vantage merge rule**: manager merges staging→main ONLY when
  BOTH auditors return `verdict: approved`. If either rejects, the
  manager dispatches the union of findings as fix-batches to the
  impl workers named in `target_track` and re-spawns the audit
  cycle.
- **One-time Captain setup**: `typescript_swarm_playbook.md`
  documents the two `scion hub secret set` commands that propagate
  `~/.codex/auth.json` + `~/.codex/config.toml` into the Codex
  container at boot via file-type hub secrets.
- **Future extension**: a 2nd cross-model auditor on Gemini
  (`code-review-gemini`) is straightforward to add as an additional
  template. Per-wave opt-in is recommended for high-stakes waves
  rather than running 3 auditors on every batch.

---

## How to use this framework

### At wave planning

For each capability track in the proposed wave:

| Risk category | Question |
|---|---|
| A | Which gate proves the criterion was met? Which false negatives can it have? |
| B | Who is composing this track's output into the running application? |
| C | Is there a pattern this track must follow that already exists elsewhere? |
| D | What architectural rule does this track touch? Is it gated, or in a comment? |
| E | What stubs / exemptions does this track introduce? Are they in the ledger with owners + expiry? |
| F | What tools does this track's worker need at runtime? Are they declared in `image-dependency-manifest.yaml` and probed by preflight? |
| G | Which cross-model auditor will review this code? Are the audit reviewers genuinely different model families from the impl workers? |

### At wave closure

For each cleanup-PR or fix-PR you have to write AFTER the wave closes,
assign one (or more) of the seven categories. If a PR maps to none of
them, you've found an eighth category — extend this framework.

### At quarterly methodology review

Audit:
- Every gate has a written false-negative profile (catches category A).
- Every wave plan includes the three permanent meta-tracks meta-compose /
  meta-gate / meta-propagate (catches B + C).
- Every architectural rule has a mechanical enforcer in
  `tools/` or a pnpm script in `package.json` (catches D).
- The stub-ledger and any other exemption files have non-empty owners
  and unexpired deadlines on every row (catches E).
- `orchestration/image-dependency-manifest.yaml` exists, names every
  tool workers need, and `tools/captain-preflight/check.sh` exits 0
  with all probes green against the engagement's `agent_image`
  (catches F).
- Every wave's audit dispatch includes BOTH `spec-adherence-agent`
  (Claude) and `code-review-codex` (Codex/gpt-5.5); both verdicts
  gate the staging→main merge (catches G).

---

## References

- `USER-GUIDE.md` Appendix C — Mechanical gates (the 6 gate types this
  framework recommends; this repo currently implements 4 / 6).
- `USER-GUIDE.md` Phase 4 — three permanent meta-tracks pattern.
- `orchestration/ledgers/stub-ledger.yaml` — the only place production
  stubs are allowed.
- `orchestration/ledgers/contract-ledger.yaml` — cross-track contracts
  that drive pattern propagation.
- `orchestration/prompts/manager-kickoff.md` Lifecycle Step 6 (audit
  cycles) — how the manager detects and propagates category-A / B / C
  violations within a wave.

Source: this doc consolidates and generalizes
`PRD-swarm-quality-framework.md` from the prior NestJS engagement
(`~/projects/appointment-swarm/scheduling-redesign/`). Engagement-
specific examples have been kept as illustrations; the mechanism
descriptions have been generalized to apply to any stack adopting
the swarm methodology.
