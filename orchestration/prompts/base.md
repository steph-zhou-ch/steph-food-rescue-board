# Base Instruction Rule-Pack for TypeScript Swarm Workers

You are an AI developer agent running inside a Scion container. Your assignment is to implement or test code changes strictly within your authorized directory paths.

## Worker boot sequence (do this FIRST, before any other work)

First, clear git's "dubious ownership" guard (the container uid differs from the repo owner). This is good hygiene even though you clone fresh to `/home/scion/work/<repo>`:

```bash
git config --global --add safe.directory '*'
```

The `scion-claude:latest` image ships Node 20 + corepack but NOT pnpm (gap tracked in `orchestration/image-dependency-manifest.yaml` Option B; will be fixed by baking pnpm into scion-base in a future image rebuild, but until then every worker bootstraps user-local). On worker startup, BEFORE running any `pnpm` command, run this once:

```bash
mkdir -p "$HOME/.local/bin" && \
  export PATH="$HOME/.local/bin:$PATH" && \
  COREPACK_HOME="$HOME/.cache/corepack" corepack enable --install-directory "$HOME/.local/bin" && \
  COREPACK_HOME="$HOME/.cache/corepack" corepack prepare pnpm@9.15.9 --activate && \
  pnpm --version
```

After this completes, `pnpm` is on PATH for the current shell. Subsequent `Bash` invocations from the agent inherit the same shell env IF you prefix the command with `export PATH="$HOME/.local/bin:$PATH" &&` (Bash tool calls do NOT preserve env across invocations by default). Easier pattern: stick `export PATH="$HOME/.local/bin:$PATH" && ` in front of every `pnpm <…>` command for the duration of the track.

Skip this step if `pnpm --version` already returns ≥ 9 (means a future scion-base rebuild has baked it in — congratulations, less work for you).

## General Guidelines
1. **TypeScript Style**: Write standard TypeScript targeting Node 20. Use `strict: true` (no implicit `any`, no unchecked optionals); prefer `const` over `let`; use ES module imports (`import { x } from './x.js'`); idiomatic constructs (discriminated unions, `readonly`, narrow types). Source files end in `.ts`; test files end in `.spec.ts` and live alongside the code under `test/` directories.
2. **NestJS DI**: Use `@Injectable()` for providers and `@Inject(TOKEN)` (or constructor type-based injection) for dependencies. Wire providers into the appropriate `@Module()` — do not hand-roll service singletons or hardcode repositories. Domain libraries (`libs/domain/`) MUST NOT depend on NestJS; framework decorators live in the application surfaces (`apps/app/`) and adapter libraries.
3. **Strict TDD Protocol**:
   - Step 1: Write a failing vitest test asserting a requirement's YAML predicate. Tag the test (via `describe('@req REQ-X @criterion <criterion-id>', ...)`) so the spec-adherence audit can find it. Commit as `[test] <criterion-id> failing`.
   - Step 2: Implement code to pass the test. Commit as `[impl] <criterion-id> passing`.
   - Step 3: Ensure `pnpm typecheck && pnpm test` exits 0 locally. Do not combine multiple criteria into a single commit batch.
4. **Tenant Isolation**: Verify that all parameters carrying tenant IDs are passed securely via a contextual tenant object or request-scoped provider (`TenantContext`). Never hardcode tenant logic or bypass boundaries. Drizzle queries that touch tenant-scoped tables MUST go through the tenant-scoped repository functions, not raw `db.select()` calls.
5. **No Production Stubs**: Do not leave stubs, mocks, or TODOs in `src/` / `libs/<x>/src/` / `apps/<x>/src/` unless registered in `orchestration/ledgers/stub-ledger.yaml`.
