# Seed refresh + token-gated live reset - designed, built, shipped, and reseeded live - 2026-06-02

**Branch:** `dev` (shipped to `main` via PR #30) | **PRs:** #30 MERGED (`dev → main`) | **Scope:** Refresh the demo seed to an iteration-matched set and add a token-gated instant live reseed; then ship it to prod and wipe+reinstall the live demo.

> Continuation of the same day's earlier session (`docs/summary/2026-06-02-1553-iteration-1-2-pickers-and-voting-ux.md`, which covers the mobile create/vote iterations 1-2, native pickers, the voting-screen auto-save + organizer-lock redesign, and the Hermes timezone fix). This summary covers everything after that: the seed/reset work and the production ship.

## TL;DR
The user asked to "clear the live API database" because the demo data was out of whack. Rather than one-off wiping it, we did it properly: brainstormed → wrote a spec → wrote an implementation plan → executed it with subagents → shipped it. The result: the seeded demo is now an **iteration-matched** set (exact + options only; fuzzy deferred to iteration 3), refactored into a DB-free `seed-data.ts` with a referential-integrity validator, plus a **token-gated `POST /admin/reseed`** route that wipes+reinstalls the demo on the live backend without a redeploy (one command: `pnpm reseed:live`). It was shipped via PR #30 (`dev → main`, CI green, CD deployed), the `ADMIN_RESET_TOKEN` secret was provisioned on the live App Runner service, and the live DB was wiped and reseeded - **verified** to now hold exactly the 5-plan demo. The token is stored in `apps/api/.env` (gitignored) and on the App Runner service env.

## What was done (chronological)

1. **Original ask + safety pause.** User: "clear the live api database". I investigated rather than acting: confirmed "live" = App Runner service `bethere-api` (acct 208569836255, `us-east-1`, base `https://96mgvmgcbj.us-east-1.awsapprunner.com`) behind private RDS, that the team's documented reset is env-driven (`docs/runbook-deploy.md`: `SEED_ON_BOOT=reset` or `DB_RESET_ON_BOOT=true` via an App Runner redeploy), and that the live env had `SEED_ON_BOOT=if-empty` (which is exactly why test data never got cleaned up - redeploys never wipe a non-empty DB). I presented a confirmation with blast radius; user interrupted to redirect.

2. **Pivot to "do it properly."** User wanted the seed reformulated for the current product and a repeatable reset, since "schemas are changing rapidly." Invoked **superpowers:brainstorming**. Established (one question at a time):
   - Verified the current `seed.ts` still matched the schema (no drift) - so "out of whack" was demo-content + reset-ergonomics, not schema breakage.
   - **Scope = A** (refresh demo + make resets easy).
   - **Content = A** (iteration-matched: exact + options only; drop fuzzy demo plans until iteration 3).
   - **Reset mechanism = A** (token-gated admin reseed endpoint, instant, no redeploy).

3. **Spec** written + self-reviewed: `docs/superpowers/specs/2026-06-02-seed-refresh-and-live-reset-design.md`.

4. **Plan** written via **superpowers:writing-plans** (8 bite-sized TDD tasks): `docs/superpowers/plans/2026-06-02-seed-refresh-and-live-reset.md`.

5. **Execution** via **superpowers:subagent-driven-development**, orchestrated with the Workflow tool (sequential because tasks share files; implement → spec+quality review → fix loop per task). 14 agents, all tasks DONE/PASS, 0 fix rounds. Six commits on `dev`:
   - `5308c46` refactor(api): split pure demo data into `seed-data.ts` + iteration-matched plan set
   - `494a925` test(api): seed integrity validator + tests
   - `1dfcc89` feat(api): constant-time reseed token guard
   - `8323df1` feat(api): token-gated `POST /admin/reseed` route
   - `fe936ba` chore: `reseed:live` one-command live reset
   - `0c03340` docs: runbook section for resetting live demo data

6. **Controller verification:** typecheck clean, lint clean (81 files), `pnpm --filter @bethere/api test` = 14/14 (8 auth + 3 new seed-integrity + 3 new token-guard). I personally re-read the security-critical files (`isAuthorizedReset`, the route, `reseed-live.sh`) and confirmed correctness.

7. **Ship** (superpowers:finishing-a-development-branch). Detected `dev` was **123 commits ahead of `main`** - so the new route was NOT live until deployed. Per `CLAUDE.md` (never push/merge to main locally; ship via PR `dev → main`), opened **PR #30**, CI green (`ci` 39s, `guard`, GitGuardian, Vercel all pass), merged (merge commit `344ee0c`). CD (`deploy-api.yml`) ran on push to main → built/pushed image → App Runner auto-deployed. Confirmed live: App Runner `RUNNING`, `/admin/reseed` returned **403** (route deployed + correctly inert without the token).

8. **Provisioned the secret + reseeded live (Task 8, destructive).**
   - Generated `ADMIN_RESET_TOKEN` and added it to the App Runner service via `aws apprunner update-service`, preserving the other 5 env vars by editing the live `SourceConfiguration` JSON with `jq` (never retyping `DATABASE_URL`/`CLERK_*`). Waited for the rolling deploy to `SUCCEEDED`/`RUNNING`.
   - Ran `pnpm reseed:live` → `{"ok":true}`. **Verified** via `events.mine` (dev bypass `x-user-id: u_dev`): live now holds exactly **Dune: Part Two** (options/collecting), **Pub night** (options/collecting, not-yet-reacted), **Bowling** (exact/moment), **Dinner** (options/cleared/going), **Football** (exact/cleared/declined). No fuzzy plans; all four dashboard groupings covered.
   - Cleaned up `/tmp` files that contained secrets (the service-config dump + token).

9. **Stored the token.** Added `ADMIN_RESET_TOKEN=79eddc20bc537e9c7dd3fa6ec263d2194fce2dbac78c6c6f` to `apps/api/.env` (gitignored, confirmed via `git check-ignore`), with a comment showing how to use it: `set -a; source apps/api/.env; set +a; pnpm reseed:live`.

## Key decisions & rationale

- **Don't one-off wipe; build a proper reset + refreshed seed.** The user explicitly wanted it done properly because schemas change fast. So we invested in a repeatable mechanism + an honest demo, not a throwaway action.
- **Iteration-matched seed (exact + options only).** Every seeded plan should be one the current UI can actually create (fuzzy is hidden until iteration 3), so the live demo stays honest about what the app does. Chosen over full-coverage (could confuse teammates with un-creatable fuzzy plans) and over two seed sets (more moving parts).
- **Token-gated `POST /admin/reseed`, instant, no redeploy.** Chosen over a deploy-cycle script (too slow for rapid iteration) and "always reset on deploy" (a footgun once real data exists). The endpoint is **inert (403) unless `ADMIN_RESET_TOKEN` is set**, uses a **constant-time** compare (`timingSafeEqual`, length-checked first), and logs loudly.
- **Raw Fastify route, NOT a tRPC procedure.** Keeps the destructive op out of the mobile client's typed `AppRouter` surface; trivial to `curl`.
- **Split `seed-data.ts` (pure) from `seed.ts` (DB ops).** Lets `seedIntegrityErrors()` be unit-tested with no Postgres (no idle-pool/process-hang risk in `node:test`), and gives a real TDD task. The validator catches the exact class of "out of whack" bug (a reaction/response/creator referencing a non-existent user or group, a bad `chosenSuffix`, an exact plan without exactly one candidate).
- **Sync guardrails kept minimal (user picked A not C).** The seed is TS built against the Drizzle types (schema changes break `pnpm typecheck`), `reseedDemo()` runs on every local boot (`SEED_ON_BOOT=reset`) so runtime drift surfaces immediately, plus the new integrity test. Convention written down: change the schema → update `seed-data.ts` in the same commit.
- **Ship via PR `dev → main`, not a local merge.** `CLAUDE.md` forbids pushing/merging to protected `main` locally; CD deploys on push to main. The 123-commit delta meant shipping also carried the rest of the accumulated `dev` work (including this session's mobile iterations) - flagged to the user as a large prod deploy before merging.
- **Preserve App Runner env with `jq`, never retype secrets.** `update-service` replaces the whole env map, so I round-tripped `describe-service`'s `SourceConfiguration` and set only `ADMIN_RESET_TOKEN`, avoiding any chance of clobbering `DATABASE_URL`/`CLERK_*`.

## Things learned / discovered

- **`dev` was 123 commits ahead of `main`.** The live backend runs `main`; a lot of accumulated work (incl. the whole day's mobile iterations) was undeployed. Shipping the seed required deploying all of it. Worth knowing the team lets `dev` run far ahead and ships in big batches.
- **`SEED_ON_BOOT=if-empty` on live** means redeploys never reseed a non-empty DB - so the only ways to refresh live demo data are the new `/admin/reseed`, or the runbook's `SEED_ON_BOOT=reset` / `DB_RESET_ON_BOOT=true` one-shot redeploys.
- **App Runner env changes require a rolling deploy** (`update-service` → new operation). There's no hot env update. Two deploys happened: the code (from the PR merge) and the token (from `update-service`).
- **`gh pr checks <n> --watch --exit-status`** cleanly blocks until checks settle (good for background waiting). `gh pr merge` returned "already merged" - the merge had gone through despite the CLI reporting an error; verify with `gh pr view --json state,mergedAt,mergeCommit`.
- **Probing deploy rollout:** `curl -s -o /dev/null -w '%{http_code}' -X POST <base>/admin/reseed` → `403` means the new route is live (inert), `404` means the old image is still serving. A fast, reliable "did my code deploy?" check.
- **The user was editing in parallel** the whole time (a `lockAt` auto-lock + member opt-out + single-option `options.min(1)` feature) across `schema.ts`, `schemas.ts`, `events.ts`, a new migration `0003_red_the_initiative.sql`, and new `packages/shared/src/logic/lock.ts`/`lock.test.ts`. These are **uncommitted working-tree changes, NOT deployed** - the live deploy is exactly the merged `0c03340`, so the live seed and live schema are mutually consistent. I deliberately left that work untouched.
- **Workflow orchestration for plan execution:** running implement→review→fix as sequential awaited agents (not `parallel`/`pipeline`) is correct when tasks share files; parallel implementers would conflict.

## Current state

- **Live (prod):** App Runner `bethere-api` is `RUNNING` on the post-#30 image. `/admin/reseed` is deployed and **enabled** (token set). Live DB = the fresh 5-plan iteration-matched demo (verified). Health OK.
- **Repo:** PR #30 merged to `main`. The 6 seed/reset commits are on both `dev` and `main`.
- **Secret:** `ADMIN_RESET_TOKEN=79eddc20bc537e9c7dd3fa6ec263d2194fce2dbac78c6c6f` lives on the App Runner service env AND in `apps/api/.env` (gitignored). Should also go in the team password manager.
- **Uncommitted (user's in-progress, NOT shipped):** `apps/api/src/db/schema.ts`, `seed-data.ts`, `seed.ts`, `routers/events.ts`, `packages/shared/src/{index,schemas}.ts`, migration `0003_red_the_initiative.sql` + its snapshot, and new `packages/shared/src/logic/lock.{ts,test.ts}` - the `lockAt`/opt-out/single-option feature. Verified green state was on the committed tree; the working tree may be mid-edit and not necessarily compiling.
- **Verified:** typecheck/lint/test green on the committed work; live reseed + 5-plan demo confirmed against the live API; route inert-without-token confirmed (403→{ok:true}).

## Conventions, commands & workflows

- **Reset live demo data (new, one command):** `set -a; source apps/api/.env; set +a; pnpm reseed:live` (or `ADMIN_RESET_TOKEN=… pnpm reseed:live`, or curl `POST /admin/reseed` with header `x-admin-token`). Disabled (403) wherever `ADMIN_RESET_TOKEN` is unset. Documented in `docs/runbook-deploy.md`.
- **Local always-fresh:** `pnpm dev:api` reseeds on boot (`SEED_ON_BOOT=reset`); local DB is docker Postgres on host port 5433 (`postgres://drp:drp@localhost:5433/drp`).
- **Quality gates (run from root before PR):** `pnpm typecheck`, `pnpm lint` (`pnpm format` to fix), `pnpm --filter @bethere/api test`.
- **Ship to prod:** PR `dev → main` only (never local merge/push to `main`); CD deploys backend on push to main; App Runner auto-deploys on `:latest`.
- **App Runner ARN:** `arn:aws:apprunner:us-east-1:208569836255:service/bethere-api/260292b3564d41d6b60e9e2129a0263b`. Env edits: `describe-service` → `jq` set one key → `update-service --source-configuration file://…` → wait for `list-operations` `SUCCEEDED`.
- **When changing the DB schema, update `apps/api/src/db/seed-data.ts` in the same commit** (typecheck + local boot reseed are the guardrails).
- No em dashes; pnpm only; apps/api is ESM (`.js` import specifiers).

## Known issues / caveats / risks

- **Seed will drift the moment the user's `lockAt`/opt-out schema lands.** Their uncommitted migration adds columns/tables (e.g. `eventOptOuts`, likely a `lockAt`); `seed-data.ts`/`seed.ts` are also locally modified, presumably to match. When they commit + deploy, `seed-data.ts` must set any new NOT-NULL columns or `reseedDemo()` (and boot reseed) will fail. The guardrails (typecheck + local boot) should catch it before live.
- **`/admin/reseed` is a destructive prod endpoint.** Mitigated (disabled-without-env, secret header, constant-time compare, loud logs, IP rate-limit), but the token must stay secret; rotate by updating the App Runner env var (one deploy). Revisit before any real (non-demo) data exists.
- **The reseed wiped the shared backend** - any teammate test data there is gone (intended).
- **Token exposure:** the token value appears in this session's transcript and in `apps/api/.env`. Acceptable at demo stage; rotate if that's a concern.
- **`gh pr merge` "already merged" quirk** - don't trust the CLI exit code alone; verify merged state via `gh pr view`.

## Next steps

1. Put `ADMIN_RESET_TOKEN` in the team password manager (currently only in App Runner env + local `apps/api/.env`).
2. The user finishes the `lockAt`/opt-out/single-option feature; **update `seed-data.ts` in the same commit** as the schema change, run `pnpm typecheck` + a local boot, then ship `dev → main` and `pnpm reseed:live` to refresh live again.
3. Iteration 3: re-enable the `fuzzy` whenMode in the create UI and re-add fuzzy demo plans to `seed-data.ts`.
4. Optional hardening (deferred): a CI job with ephemeral Postgres that runs migrate+reseed; migrate timestamp columns to `timestamptz`.

## References

- Spec: `docs/superpowers/specs/2026-06-02-seed-refresh-and-live-reset-design.md`
- Plan: `docs/superpowers/plans/2026-06-02-seed-refresh-and-live-reset.md`
- Prior summary (mobile iterations 1-2 + voting redesign + tz fix): `docs/summary/2026-06-02-1553-iteration-1-2-pickers-and-voting-ux.md`
- Seed: `apps/api/src/db/seed-data.ts` (data + `seedIntegrityErrors`), `apps/api/src/db/seed.ts` (DB ops), `apps/api/src/db/seed-data.test.ts`
- Reseed endpoint: `apps/api/src/admin/reset-auth.ts` (+ test), the route in `apps/api/src/index.ts` (search `admin/reseed`)
- Reset tooling: `infra/reseed-live.sh`, root `package.json` `reseed:live`, `docs/runbook-deploy.md` ("Reset live demo data")
- PR: https://github.com/gong8/drp_02/pull/30
- Live API: `https://96mgvmgcbj.us-east-1.awsapprunner.com` (`/trpc/health`, `/admin/reseed`)
- Memory: `~/.claude/.../memory/create-flow-iteration-roadmap.md`
