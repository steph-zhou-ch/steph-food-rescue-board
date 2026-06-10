# agents.md — application-services-agent (Claude operating instructions)

You're running inside a Scion-spawned container on the `claude` harness
(scion-claude:latest, Node 20 + pnpm 9 pre-installed). Your CWD is
`/workspace/` — the engagement repo bind-mounted from the host.

## Your composed prompt

The manager sends you a single message containing:
1. This template's `system-prompt.md` (the domain-agent rule-pack you
   already have above) — your identity.
2. `orchestration/prompts/base.md` — the engagement's shared TDD
   discipline.
3. Your track-meta from `orchestration/track-meta/<track-id>.yaml` —
   the mission, deliverables, REQ references, exit criterion.
4. Verbatim excerpts of the REQ(s) your criteria come from.
5. The operational protocol — when to push, what commit messages to
   use, when the manager polls your branch.

Read top-to-bottom. Re-read the REQ excerpts before each `[test]` commit.

## Workflow

1. `git checkout swarm/<track-id>` (manager pre-creates the branch).
2. For each `@criterion` in your assigned REQ, in topological order:
   a. Write the failing test in `the appropriate test/ dir per your track-meta scope/<area>.spec.ts`.
   b. `pnpm typecheck` (catches the missing impl as a TS error — that's the failure signature).
   c. `git commit -m "[test] <criterion-id> failing"` + push.
   d. Author the minimum impl in `the appropriate src/ dir per your track-meta scope/<area>.ts`.
   e. `pnpm typecheck && pnpm --filter <relevant-package> test (or `pnpm test` from the repo root for cross-package work)` — both must pass.
   f. `git commit -m "[impl] <criterion-id> passing"` + push.
3. When all criteria are done, write `[complete:<track-id>]` empty
   commit + push. Manager picks it up.

## When you hit an obstacle

- **A criterion can't be satisfied without infrastructure** (e.g. it
  needs a DB query) → that's a misclassified criterion. File an
  escalation `kind: criterion-misclassified` at
  `orchestration/escalations/<ISO>-<criterion-id>-misclassified.md`
  and halt. Domain rules are pure; if a criterion isn't pure, it
  belongs in an `app-*` or `integration-*` track, not yours.
- **A test compiles but fails for the wrong reason** → that's a
  sham-assertion smell. Pause; re-author the test to assert the
  PREDICATE, not just that something happens.
- **You'd need a stub or NOOP to make a test pass** → don't. Register
  the stub in `orchestration/ledgers/stub-ledger.yaml` first (with
  owner + expiry_wave); the audit will permit it. Otherwise no stubs.

## Pre-flight

Inside your container before doing any work:
```bash
node --version   # expect v20.x or later
pnpm --version   # expect 9.x
git status
pnpm install --frozen-lockfile  # if node_modules not yet present
```
