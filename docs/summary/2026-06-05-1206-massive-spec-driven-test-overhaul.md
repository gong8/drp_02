# Massive spec-driven test overhaul - 2026-06-05

**Branch:** `feat/redo-from-previous-meetup` | **PRs:** none opened this session (all work committed locally) | **Scope:** Build the missing test infrastructure, then author ~566 spec-driven tests across the monorepo, catch and fix bugs, and wire CI.

## TL;DR
The session started as an assessment of the project's testing ("what do you think about the testing right now?") and turned into a full overhaul ("fix all of the testing... massive parallel task... write what is expected, catch bugs"). We discovered the entire stateful core (`apps/api/src/routers/events.ts`, 965 lines, the whole plan lifecycle) had **zero tests and was untestable** because there was no DB-backed harness, mobile had 0 component tests, the aggregate `pnpm test` hung forever (mobile jest leaked a handle), and `dev` (the default working branch, which auto-deploys to a live backend) had no CI gate. We built a DB-backed tRPC `createCaller` harness (real per-process Postgres) and a React Native render harness, then ran a 23-agent parallel workflow to author **566 spec-derived tests** (derived from `ARCHITECTURE.md`/`CLAUDE.md`, not the code). The tests caught **3 bugs** (2 fixed with regression tests, 1 flagged as ambiguous), and we fixed the jest hang, added a Postgres service + `dev` gate to CI. End state: `lint` clean, `typecheck` clean, ~651 tests green (1 intentional skip), aggregate `pnpm test` exits cleanly; the only red is one **pre-existing** `biome-ignore` in `CreateWizard.tsx` (DRP-44) that blocks `pnpm quality`/`pnpm check`.

## What was done

### Phase 0 - Assessment (the original ask)
- Ran a multi-agent workflow to assess testing across coverage / quality / infra / risk / strategy. Findings (all independently verified against the code):
  - **`events.ts` (965 lines, ~12 tRPC procedures + the lazy settle engine) had no test file** and no harness could reach it: `db` is a hard module singleton (`apps/api/src/db/client.ts`), context is `{ userId, log }`, and there was no `createCaller`/pg-mem/testcontainers/`setupFiles`. The project's strategy was "extract a pure helper, unit-test that" - good for the pure math (in `packages/shared/src/logic/*`, well covered) but it left all DB-coupled wiring (the compare-and-set in `events.update`, conditional-RSVP persistence, lock tie-breaking, state transitions, auth/anonymity) untested.
  - **Mobile: 47 source files, ~3-4 test files, 0 screen/component tests.** `App.test.tsx` was a tautology (`expect(true).toBe(true)`).
  - **Aggregate `pnpm test` hangs** - mobile `jest --watchAll=false` passes its tests then never exits (leaked open handle); `pnpm -r` blocks forever. This silently broke CI (`pnpm check` runs `pnpm test` with no step timeout).
  - **`dev` branch is ungated** - CI (`node.js.yml`) only runs on PRs into `main`; `deploy-api-dev.yml` ships every `dev` push to the live dev App Runner with no lint/typecheck/test step.
  - Three test runners: node:test (api), vitest (shared), jest-expo (mobile).

### Phase 1 - Test infrastructure (committed before fan-out)
- **`537c9b1` API harness** (`apps/api/src/test/`):
  - `env.ts` - a `--import` preload that rebinds `DATABASE_URL` to a per-process throwaway DB `bethere_test_<pid>` **before** the db singleton imports it, plus `DATABASE_SSL=disable`, `DEV_AUTH_BYPASS=1`, `SEED_ON_BOOT=off`, `LOG_LEVEL=silent`.
  - `harness.ts` - `setupTestDb`/`resetTables`/`dropTestDb` lifecycle, `caller(userId)` over the real `appRouter`, and direct-insert factories (`makeUser`, `makeUsers`, `makeGroup`, `addMember`, `insertEvent`, `insertTimeCandidate`, `insertActivityCandidate`, `insertReaction`, `insertResponse`, `insertOptOut`).
  - `clean.ts` + `db:test:clean` script - sweep leaked `bethere_test_*` DBs.
  - `harness.smoke.test.ts` - proves create+migrate, caller, the auth boundary, and truncation end to end.
  - `apps/api/package.json` test script now: `node --import tsx --import ./src/test/env.ts --test src/**/*.test.ts`.
- **`380f921` Mobile harness** (`apps/mobile/src/test/`, `src/lib/__mocks__/`):
  - Added `--forceExit` to the mobile test script (**fixes the hang**).
  - Installed `@testing-library/react-native@13.3.3` + version-matched `react-test-renderer@19.1.0`.
  - `setup.ts` (`setupFilesAfterEnv`) - stubs Clerk + expo-notifications (the two native boundaries jest-expo does not cover).
  - `render.tsx` - `renderWithProviders` (SafeAreaProvider + NavigationContainer) and `renderScreen(Component, params?)` (mounts a screen in a real stack navigator so `useNavigation`/`route.params` work).
  - `__mocks__/trpc.ts` - a manual jest mock of the vanilla tRPC client: a Proxy resolving any procedure path to a `jest.fn()`, typed as the real client via `typeof import("../trpc")["trpc"]`, with `mockQuery`/`mockMutation`/`resetTrpcMock` helpers.

### Phase 2 - Massively parallel test authoring (23 agents)
- A `Workflow` script (`test-overhaul`) fanned out **23 lanes**, each owning ONE disjoint test file, each given the spec + harness API + a per-lane expected-behavior checklist, and each instructed to **derive assertions from the spec, run its own file, and flag (not patch) any bug** (mark the test `.skip` + `// BUG:` note and report it). Ownership-by-file lanes + per-process DB isolation let dozens of agents run their suites in parallel without collisions.
- Result: **566 tests** (API 322, shared 97, mobile 147), all lanes ran clean. The fan-out cost ~1.64M subagent output tokens over ~20 minutes.

### Phase 3 - Integration, bug triage, CI (after the workflow returned)
- Ran the full suites together (not just per-file) to confirm no cross-file breakage: all green.
- **Verified the 3 flagged bugs against the actual code + `ARCHITECTURE.md`** (adversarially, not trusting the agents):
  - Fixed `events.create` time-candidate dedup + `events.addCandidate` minute-dedup (commit `fa13337`), un-skipped both regression tests.
  - Left bug #3 (`RespondInput` stray cond) skipped + flagged (ambiguous).
- **Fixed two harness gaps the agents surfaced** (commit `72129c6`): the `resetTrpcMock` double-instance bug (anchored the jest.fn registry on `globalThis`), and a missing `useSSO` Clerk stub.
- **CI** (commit `f647ea1`): added a `postgres:16` service to `node.js.yml` (mapped to host `5433` so harness defaults work) and a new `dev-check.yml` (lint+typecheck+test on push/PR to `dev`).
- Committed in 6 modular chunks (foundation x2, then api/shared/mobile tests, then ci).
- Updated auto-memory: replaced the now-stale `pnpm-test-mobile-jest-hang` memory with a broader `testing-setup` memory.

## Key decisions & rationale

- **Why a real Postgres harness, not pglite or pure-helper extraction.** The user explicitly chose real Dockerized Postgres (and a *separate* test DB, not the shared dev DB). Rationale: the headline behaviors - the compare-and-set with `SELECT ... FOR UPDATE`, true two-connection concurrency - need real PG semantics; pglite is single-connection and would make concurrency tests sequential approximations (false greens). Pure-helper extraction was rejected as the *primary* approach because it gives false confidence exactly where bugs live (the helper passes while the DB-coupled procedure wiring is untested).
- **Per-process database isolation (`bethere_test_<pid>`), not per-schema.** The Drizzle migrations hardcode `"public"."..."` qualification, so a `search_path`-based per-schema scheme would not cleanly receive the migrated tables. node:test runs each test file in its own process, so a per-pid DB gives every file (and every parallel agent) a private migrated DB with zero cross-file interference. The env preload computes the name from `process.pid`.
- **Spec-driven, not code-mirroring.** The user's mandate ("don't write tests just to fit the code... write what is expected... catch bugs") drove the whole design. Each agent was told to derive assertions from `ARCHITECTURE.md`/`CLAUDE.md`/schemas and may read the implementation only to shape mocks/inputs. The `test-driven-development` skill reinforced this (tests-first = "what should this do"). The proof it worked: only 3 violations surfaced from 566 spec assertions, and the 3 were real.
- **Agents flag bugs, I fix them serially.** `events.ts` is touched by ~12 lanes, so concurrent product-code edits would conflict/clobber. Agents wrote only disjoint test files and marked bug-catching tests `.skip` + `// BUG:`; the integrator (me) verified each adversarially and fixed the product code serially, then un-skipped. This honored the user's "Fix code, report each" choice while keeping lanes independent and the suite green throughout.
- **Bug #3 flagged, not fixed.** The shared:schemas agent itself rated `RespondInput` accepting a stray `cond` on yes/no as low-confidence ("defensible as: server ignores it"). Per the user's selected policy (risky/ambiguous -> skip + flag), it was left as a skipped test with a one-line fix offered.
- **CreateWizard `biome-ignore` flagged, not refactored.** `apps/mobile/src/screens/CreateWizard.tsx:90` has a deliberate, documented `useExhaustiveDependencies` suppression from in-flight DRP-44 feature work. A correct fix requires reordering the component (`applyPrefill` is an in-body function, not memoized; wrapping it in `useCallback` and adding it to the effect deps requires moving it above the effect to avoid a TDZ in the dep array). That is a feature-code refactor in someone else's active work, so it was flagged with the exact fix rather than done unilaterally. Consequence: `pnpm quality`/full `pnpm check`/main CI stay red until resolved (and the `--forceExit` fix now lets main CI *reach* the quality step instead of hanging before it).
- **`dev` gate runs lint+typecheck+test, not full `pnpm check`.** So it is green on arrival despite the pre-existing CreateWizard quality violation; the full check (including `pnpm quality`) still gates the `dev -> main` PR via `node.js.yml`. This closes the "no gate on dev" gap without blocking day-to-day dev commits on a pre-existing issue.
- **Commit in modular chunks.** Per `CLAUDE.md`'s explicit instruction for big tasks; each chunk is self-contained, verified, and was locked in before moving on (the foundation commits especially, as the riskiest/highest-value pieces).

## Things learned / discovered

- **`db` is a module singleton bound to `DATABASE_URL` at import** (`apps/api/src/db/client.ts:8`). The only way to point tests at a test DB is to set `DATABASE_URL` *before* the client module loads - hence the `--import ./src/test/env.ts` preload (run after `--import tsx` so the TS preload can be transpiled). `pg.Pool` connects lazily, so importing the client against a not-yet-created DB is fine until the first query.
- **node:test default isolation is process-per-file.** This is what makes per-pid DBs work for parallelism; the `--import` flags propagate to the per-file child processes via `execArgv`.
- **Migrations are `"public"`-qualified** (`apps/api/src/db/migrations/0000_*.sql` etc.), which is why per-database (not per-schema) isolation was chosen.
- **Mobile uses the vanilla tRPC client** (`createTRPCClient` + `httpBatchLink`), called imperatively (`trpc.events.mine.query()`), NOT `@trpc/react-query`. So mocking is a simple `jest.mock("../lib/trpc")` with a manual `__mocks__` mock - no QueryClient/provider needed.
- **The manual jest mock loads under two specifiers** (as the mock for `../trpc` AND via a direct import of its helpers), giving two module instances with separate registries - so `resetTrpcMock` was clearing a different Map than the screen recorded into (mutation call history leaked between tests). Fix: anchor the registry on `globalThis` via `Symbol.for`. Discovered by the CreateWizard and Groups agents, who worked around it in-file; fixed at the harness level afterward.
- **`@testing-library/react-native` v13 auto-extends matchers** (no `extend-expect` import). `react-test-renderer` must exactly match React (19.1.0).
- **`SignIn.tsx` calls Clerk's `useSSO` on mount** - the App smoke test needs it stubbed; added to `setup.ts`. `App.tsx` also renders its own `SafeAreaProvider` with no `initialMetrics`, so the App test stubs `react-native-safe-area-context` in-file (insets never resolve async in the test renderer otherwise).
- **The quality gate (`scripts/quality-check.mjs`) bans `as any`/`@ts-ignore`/`@ts-nocheck`/`@ts-expect-error`/`biome-ignore`/`eslint-disable`; biome separately bans explicit `any`.** So harness code uses `as unknown as T` and `typeof import(...)` instead of `any`.
- **biome quirks hit during cleanup:** (1) `biome check --write --unsafe` is needed to remove unused imports (the safe pass won't); scope it to a dir and re-verify with typecheck+tests because unsafe fixes can do more. (2) biome reports a confusing "Illegal return statement outside of a function" + "Code formatting aborted due to parsing errors" when it cannot parse a file - in this case the offender was the **workflow orchestration script** (`.claude/workflows/scripts/test-overhaul.js`) which has a top-level `return` (valid in the Workflow runtime, illegal as a standalone module). biome scans `.claude/` (it is NOT gitignored). Fix: deleted the throwaway script. (3) `noAssignInExpressions` rejected `x ?? (x = new Map())`; rewrote as a 3-line `const v = x ?? new Map(); holder = v`.
- **The repo advanced under the session repeatedly** (e.g. a `/summary` commit landed mid-analysis: HEAD moved `d019df0 -> ... -> e6545fc`). The DRP-44 work (`status.ts`/`status.test.ts`, the `ui/` vocabulary) appeared between the assessment passes, which briefly looked like a missing-test discrepancy until reconciled via git.
- **toggleReaction has no CAS/transaction** (unlike `events.update`); a true concurrent double-tap by one user would be a PK-violation error, not a clean toggle - flagged as out of scope by the agent.

## Current state

- **Branch:** `feat/redo-from-previous-meetup`, 6 new commits on top of the DRP-44 work (`537c9b1`, `380f921`, `fa13337`, `67eb69e`, `72129c6`, `f647ea1`). Nothing pushed; no PR opened.
- **Verified green locally:** `pnpm lint` clean; `pnpm typecheck` clean (all 3 packages); **API 356/356** (354 + 2 un-skipped bug regressions), **shared 129 pass + 1 skipped** (bug #3), **mobile 165/165**; aggregate `pnpm test` completes and exits.
- **Red (pre-existing, flagged):** `pnpm quality` fails on the single `CreateWizard.tsx:90` `biome-ignore` (DRP-44). Therefore full `pnpm check` and the main `dev -> main` CI will fail until that one line is resolved.
- **Unverified:** the CI changes (`node.js.yml` Postgres service, `dev-check.yml`) cannot be run locally - watch the first GitHub Actions run.
- Test counts: ~566 new tests authored this session; ~651 total across the repo.
- **Local Postgres must be up** (`pnpm db:up`, host port 5433) for the API tests.

## Conventions, commands & workflows

- **Run API integration tests:** `pnpm db:up` first, then `pnpm --filter @bethere/api test` (or a single file: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/<file>.test.ts`). Sweep leftover DBs with `pnpm --filter @bethere/api db:test:clean`.
- **Write a new API integration test:** import from `../test/harness.js` (ESM `.js` extensions), use `before(setupTestDb); beforeEach(resetTables); after(dropTestDb);`, build state with the factories, exercise via `caller(userId).events.x(...)`, assert via `assert.rejects(..., (e) => e instanceof TRPCError && e.code === "FORBIDDEN")`. To test lazy auto-lock/settle, set `decidesBy`/`momentEndsAt` to a PAST date (no time injection).
- **Write a new mobile screen test:** `jest.mock("../../lib/trpc")`, import `{ trpc }` + `{ mockQuery, resetTrpcMock }` from the mock, `beforeEach(resetTrpcMock)`, set canned responses, `renderScreen(Screen, params)`, assert with `findBy*`/`waitFor`/`fireEvent`. Match real rendered copy (`lib/copy.ts`); compose from `ui/` primitives (see the `mobile-ui-vocabulary` memory).
- **Branching/CI:** `dev` is the default working branch and auto-deploys to the live dev backend; the new `dev-check.yml` gates it (lint+typecheck+test). The full `pnpm check` (incl. `pnpm quality`) gates the `dev -> main` PR via `node.js.yml`. `main` is protected.
- **Quality gates:** no `as any`/`@ts-ignore`/`biome-ignore`/etc. (`scripts/quality-check.mjs`); no explicit `any` (biome); no em dashes anywhere.

## Known issues / caveats / risks

- **`pnpm quality`/`pnpm check`/main CI are red** until `CreateWizard.tsx:90`'s `biome-ignore` is removed. Recommended fix: wrap `applyPrefill` in `useCallback([])`, move it above the `groupId` effect, add it to that effect's deps, delete the ignore comment. The 15 CreateWizard tests will confirm behavior is preserved.
- **CI changes are unverified locally.** The Postgres service maps to host 5433 so the harness defaults work with no extra env, but the first Actions run should be watched (service health, connection).
- **Bug #3 (`RespondInput` stray cond) is an open decision** - a skipped test (`packages/shared/src/schemas.test.ts`) documents it; tighten the refine if desired (`(v) => v.kind === "conditional" || v.cond === undefined`).
- **No Linear issue was created** for this work (CLAUDE.md wants work tracked in Linear). Offered to create one; not yet done.
- Mobile coverage gaps the agents left intentionally: exhaustive add-candidate submit flow, live-countdown banner values, fizzled-card copy, the unrespond/"Change" re-open flow.
- The `dev`-branch onboarding-button navigation in Dashboard can only be asserted as "pressable without throw" in a single-screen test stack (it routes via `navigation.getParent()`).

## Next steps

1. **Resolve the `CreateWizard.tsx:90` `biome-ignore`** (the `useCallback` refactor above) so `pnpm check`/CI go green - this is the one thing blocking a fully-green pipeline.
2. **Decide on bug #3** and either tighten `RespondInput` (and un-skip its test) or delete the skipped test if "server ignores cond" is the intended design.
3. **Watch the first CI run** of `node.js.yml` (with Postgres) and `dev-check.yml`; adjust the service config if the connection/health check misbehaves.
4. Open a PR (and/or a Linear issue) for this test overhaul once CreateWizard is resolved.
5. Optionally fill the deferred mobile coverage gaps and add `toggleReaction` concurrency handling if it matters.

## References

- Harness: `apps/api/src/test/{env,harness,clean,harness.smoke.test}.ts`; `apps/mobile/src/test/{render.tsx,setup.ts}`; `apps/mobile/src/lib/__mocks__/trpc.ts`.
- API integration tests: `apps/api/src/routers/{events-create,events-toggleReaction,events-setOptOut,events-addCandidate,events-lock,events-update-cas,events-respond,events-settle,events-get,events-mine,events-pastForGroup,events-auth-boundary,conditional-rsvp,groups}.test.ts`.
- Shared tests: `packages/shared/src/logic/edge-cases.test.ts`, `packages/shared/src/schemas.test.ts`.
- Mobile tests: `apps/mobile/src/lib/__tests__/{format,lock-mirror}.test.ts`; `apps/mobile/src/screens/__tests__/{Dashboard,EventDetail,CreateWizard,Groups}.test.tsx`; `apps/mobile/__tests__/App.test.tsx`.
- Product code touched: `apps/api/src/routers/events.ts` (the 2 dedup fixes, `create` ~L308 and `addCandidate` ~L561).
- CI: `.github/workflows/node.js.yml` (Postgres service added), `.github/workflows/dev-check.yml` (new dev gate).
- Spec: `ARCHITECTURE.md`, `CLAUDE.md`. Memory: `testing-setup` (auto-memory; supersedes the deleted `pnpm-test-mobile-jest-hang`).
- Commits: `537c9b1`, `380f921`, `fa13337`, `67eb69e`, `72129c6`, `f647ea1`.
