# Debugging the live APK "cannot reach server" + deploy hardening — 2026-05-28

**Branch:** dev (all work merged to `main`) | **PRs:** #16, #17 (this session) | **Linear:** DRP-22 (Done) | **Scope:** Diagnose why the installed Android APK couldn't reach the live backend, fix it, and harden the deploy so the failure mode can't recur silently.

> Prior session archives: `docs/summary/2026-05-28-1624-aws-app-runner-rds-deployment-and-cd.md` (initial AWS deploy) and `docs/summary/2026-05-28-1705-live-backend-deploy-and-standalone-apk.md` (release-APK fix). This file continues from there.

## TL;DR
The Android APK reported "Couldn't reach the server." It was **not** the APK or connectivity — the **live backend was running stale code**. The concrete-event pivot had reset the Drizzle migration baseline, but the live RDS still held the old (suggestion/availability/moment) schema; on every deploy, migrate-on-boot crashed with `type "response_kind" already exists` (Postgres 42710), failed the health check, and App Runner **silently rolled back to the old image** while CD stayed green. I reset the live DB schema (throwaway demo data) so the new baseline applied, redeployed cleanly, and confirmed the app's procedures resolve. Then I hardened the pipeline: a guarded `DB_RESET_ON_BOOT` escape-hatch, a non-gating "rollback alert" step in CD, and a runbook — fixing two bugs found while testing the hardening itself.

## What was done

### 1. Diagnosis (systematic, evidence-first)
- **Confirmed backend healthy:** `curl` to `https://96mgvmgcbj.us-east-1.awsapprunner.com/trpc/health` → 200; valid Amazon TLS cert (`*.us-east-1.awsapprunner.com`, issuer Amazon RSA 2048 M01). So "cannot reach server" was client-side-surfaced, not a network outage.
- **Inspected the APK** (downloaded the `app-release` artifact, unzipped): the live URL **was** correctly inlined into the Hermes bundle (`index.android.bundle`), `localhost:3000` absent; `INTERNET` permission present (via `aapt2 dump permissions`). So the APK was fine.
- **Found the app's error pattern:** every screen does `.catch(() => setError(true))` → "Couldn't reach the server" for *any* failure, including a tRPC "no such procedure". The screens call `trpc.events.mine`, `trpc.groups.mine`, etc. (concrete-event model).
- **Probed the live API:** `events.mine` → **404**, but `availability.mine`/`moments.mine` → 200. The deployed backend was the **old** suggestion/availability model; the app (concrete-event) called `events.mine` → 404 → "couldn't reach server."
- **Resolved the git/deploy mismatch:** both `origin/main` and `origin/dev` have the concrete-event routers (`apps/api/src/routers/events.ts`, `groups.ts`); a "Deploy API" run from PR #15 had succeeded; a new image was pushed. Yet live served old code → something rolled back.
- **Root cause from App Runner application logs:** the failed-deploy instances logged `error: type "response_kind" already exists` (code 42710, `routine: DefineEnum`) at `PgDialect.migrate` / `index.ts` migrate-on-boot. App Runner operations showed `START_DEPLOYMENT ROLLBACK_SUCCEEDED` — the new image crashed on boot, failed health check, and App Runner reverted to the previous (old-schema) image. Exactly the "reset the migration baseline → must reset the DB too" gotcha from CLAUDE.md.

### 2. The fix (reset the live DB schema)
RDS is private, so to run DDL against it from the laptop I temporarily exposed it:
1. `aws rds modify-db-instance --db-instance-identifier bethere-db --publicly-accessible --apply-immediately`; added an ingress rule to `bethere-rds-sg` for my IP only (`146.179.86.179/32`) on 5432; waited until `PubliclyAccessible=true` + `available`.
2. `psql` (creds from `infra/.deploy-state.local`): `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ...` — dropped 8 old tables + 4 old enums (throwaway demo data only; no real user data).
3. Reverted: removed the temp ingress rule; `--no-publicly-accessible`.
4. `aws apprunner start-deployment` → migrate-on-boot ran clean on the empty DB, seeded, **deployment SUCCEEDED** (no rollback).
- **Verified live:** `events.mine` → 200 (Bowling @ TenPin Bowling, "The Boys"), `groups.mine` → 200 (The Boys / Climbing Group / Glitter Natters / ...); `groups.get`/`events.get`/`groups.addableUsers` → 400 (present, need input); old `availability.mine`/`moments.mine` → 404. The installed APK needs **no rebuild** — only the backend was stale.

### 3. Hardening (PR #16, then bug-fix PR #17)
Per the user's chosen approach — **alert (don't gate)** on rollback, and **yes** to a guarded reset flag:
- **`DB_RESET_ON_BOOT` escape-hatch** (`apps/api/src/index.ts`): default off, loudly warns, and when `=true` drops+recreates the `public` **and** `drizzle` schemas before `migrate()`. Runs inside App Runner (no laptop→RDS access needed). Intended as a one-shot: set it for one deploy on a deliberate baseline reset, confirm success, set back to false.
- **Non-gating rollback alert** in `.github/workflows/deploy-api.yml` ("Alert if App Runner rolled back"): after the image push, waits for the App Runner auto-deploy to settle and emits a GitHub `::warning::` if it didn't `SUCCEED` — turning a silent rollback into a visible signal without failing the build. Added read-only `apprunner:DescribeService`/`ListOperations` to the `bethere-ci` IAM user.
- **Runbook** `docs/runbook-deploy.md`: deploy flow, the silent-rollback failure mode, Fix A (`DB_RESET_ON_BOOT`), Fix B (manual temp-public-access reset), and how to verify a deploy is live.
- Updated `infra/aws-deploy.sh` so the CI policy it documents includes the new App Runner read perms.

### 4. Two bugs caught *while testing the hardening*
- **Reset left the migration journal:** first version dropped only `public`, but Drizzle stores its journal in a separate `drizzle` schema. So `migrate()` saw the baseline already applied and never rebuilt the tables → local boot failed with `relation "events" does not exist` in `seedDemoIfEmpty`. Fixed by also `DROP SCHEMA IF EXISTS drizzle CASCADE`. (My manual RDS fix had worked only because that journal held the *older* baseline, so migrate re-ran.) Re-tested locally: reset→migrate→seed→listen, then a normal boot is a clean no-op.
- **Alert false-warned on healthy deploys:** the wait loop compared status against `OPERATION_IN_PROGRESS` (a `describe-service` value), but `list-operations` reports `IN_PROGRESS`/`PENDING`/`ROLLBACK_IN_PROGRESS`. The loop broke on the first poll and warned even on success. Fixed in PR #17 to poll while the op is in any non-terminal state. Confirmed on the live run: it polled through `IN_PROGRESS` and logged "App Runner deploy succeeded - prod is on the new image."

## Key decisions & rationale
- **Diagnose before touching the APK.** The symptom pointed at the client, but verifying the backend (curl), the bundle (URL inlined), and the manifest (INTERNET perm) first ruled out the obvious and exposed the real cause (stale deployed schema). Saved a pointless APK rebuild.
- **Reset the DB rather than write an old→new migration.** Data is throwaway demo/seed only (no real users), so a schema reset is the cheapest correct fix; a hand-written migration from the old model to concrete-event would be wasted effort.
- **Temp-public-access + psql to reach private RDS** for the one-off fix: faster and lower-blast-radius (single-IP ingress, reverted immediately) than standing up a bastion/VPC task, and needed no code change.
- **Alert, not gate (user's call).** A non-failing warning surfaces silent rollbacks without blocking merges/deploys — keeps the lightweight CD flow while removing the "green-but-stale" blind spot. The user explicitly chose this over disabling auto-deploy + CD-owns-deploy (which would have needed broader `apprunner:StartDeployment` IAM).
- **Guarded `DB_RESET_ON_BOOT` in the app, not a manual-only runbook (user's call).** Makes the next intentional baseline reset a safe 2-deploy env toggle instead of repeating the manual psql dance; default-off and loud-logged to limit footgun risk.

## Things learned / discovered
- **App Runner rolls back silently on a failed health check.** A bad image (crash on boot) does NOT take the service down — it reverts to the last good image. CD stays green (build+push succeeded); the only signals are `list-operations` showing `ROLLBACK_SUCCEEDED` and the application logs. This is the core trap this session addressed.
- **Drizzle's node-postgres migrator journals in a separate `drizzle` schema** (`drizzle.__drizzle_migrations`), not `public`. Dropping only `public` leaves the journal, making `migrate()` a no-op against an empty schema. A full reset must drop both.
- **Migrator applies by timestamp:** it compares each migration's `folderMillis` (the `when` in `meta/_journal.json`) against the latest `created_at` in the journal table. A regenerated baseline with a *newer* timestamp re-runs against existing objects → "already exists" crash; a baseline already journaled with the *same* timestamp is skipped.
- **App Runner status enums differ by API:** `describe-service` → `Service.Status` uses `OPERATION_IN_PROGRESS`/`RUNNING`; `list-operations` → `OperationSummaryList[].Status` uses `PENDING|IN_PROGRESS|ROLLBACK_IN_PROGRESS|SUCCEEDED|FAILED|ROLLBACK_SUCCEEDED|ROLLBACK_FAILED`. Don't mix them.
- **App Runner deploys take ~4 min** to go `IN_PROGRESS` → `SUCCEEDED`; during a rolling deploy the old image keeps serving (so a 200 mid-deploy does not mean the new image is live).
- **RDS public-access toggle** (`modify-db-instance --publicly-accessible`) applies in ~1-2 min and the endpoint then resolves to a public IP (allow for DNS propagation; retry `psql`). Works only because the DB subnet group uses public subnets with an IGW route.
- **APK inspection:** `aapt2 dump permissions <apk>` reads the binary manifest; `strings index.android.bundle` finds inlined URL literals in the Hermes string table (they appear concatenated with neighbours — normal).
- **Parallel edits landed during the session** (committed by the user/linter on `dev`): structured Pino logger, suppressed duplicate Fastify listen logs, switched the build to `docker/build-push-action@v6` with GHA layer cache, Gradle caching + concurrency + path-scoping on the workflows, and SHA-pinned all GitHub Actions (`afb1397`). These compose with the deploy changes; the rollback-alert step and `DB_RESET_ON_BOOT` survived the rebases.

## Current state
- **Live backend:** `https://96mgvmgcbj.us-east-1.awsapprunner.com` — App Runner RUNNING on the latest concrete-event image; `/trpc/health` 200, `/trpc/events.mine` 200. Latest `START_DEPLOYMENT` = `SUCCEEDED`.
- **Git:** `main` has everything (PRs #16, #17 merged). Working branch `dev`, in sync. Clean tree.
- **APK:** the existing `app-release` artifact targets the live URL and the now-correct procedures — should work without a rebuild. (Device install/visual confirm still ultimately the user's to eyeball, but the API side is verified.)
- **AWS (acct 208569836255, us-east-1):** App Runner `bethere-api` (ARN `…/service/bethere-api/260292b3564d41d6b60e9e2129a0263b`), private RDS `bethere-db` (`bethere-db.cofy48ucsi6c.us-east-1.rds.amazonaws.com`, back to `--no-publicly-accessible`, temp IP rule removed), ECR `bethere-api`, VPC connector `bethere-vpc-conn`, IAM role `bethere-apprunner-ecr-role`, CI user `bethere-ci` (now: ECR push + read-only App Runner).
- **CD hardening:** rollback alert verified working on a real run; `DB_RESET_ON_BOOT` verified locally.
- **Linear:** DRP-22 Done (full root-cause + fix + hardening recorded in comments).

## Conventions, commands & workflows
- **Branching:** `main` protected; work on `dev`; ship via PR `dev → main` (CI `guard` enforces head==dev). CI on PRs into main; CD on push to main.
- **Quality gate:** `pnpm check` = Biome lint + typecheck + test + `scripts/quality-check.mjs`.
- **Deploy = push to `main`** (paths under `apps/api/**` etc.) → `deploy-api.yml` builds+pushes to ECR → App Runner auto-deploys. Watch the "Alert if App Runner rolled back" step's warning; a rollback means prod is stale despite green CD.
- **Baseline reset procedure** (`docs/runbook-deploy.md`): set `DB_RESET_ON_BOOT=true` env on the App Runner service, deploy once, confirm `SUCCEEDED`, set it back to `false`. Normal forward work needs nothing special — use incremental migrations (`drizzle-kit generate` → new numbered file), never re-baseline casually.
- **Verify a deploy is live:** `curl $BASE/trpc/health` and a known procedure (e.g. `groups.mine`); a 404 on an app procedure means the deployed image is older than the app (check for a rollback via `aws apprunner list-operations`).
- **Inspect App Runner:** `aws apprunner list-operations --service-arn <ARN> --max-results 1 --query 'OperationSummaryList[0].[Type,Status]'`; logs in CloudWatch `/aws/apprunner/<service>/<id>/application`.

## Known issues / caveats / risks
- **`DB_RESET_ON_BOOT` is destructive** — if left `true`, it wipes the DB on every boot/recycle. Always flip it back off after a reset. Safe only while data is throwaway; revisit before real user data exists.
- **No authentication / open API** — `x-user-id` stub defaults to a dev user; anyone with the URL can read/write. CORS `origin:true` is irrelevant for the RN client. Acceptable for supervised skeleton testing only (`docs/tech-debt.md`).
- **Rollback alert is non-gating by design** — a human must notice the CI warning; a rollback does not fail the build. (Deliberate per the chosen approach.)
- **Demo seed uses "today"** (`todayISO()`); on a long-lived DB the "free this evening" data goes stale next day and seed-if-empty won't refresh it.
- **Root AWS access keys** still used locally — rotate to an IAM user; CI already uses the scoped `bethere-ci`.
- **App device test** still ultimately needs a human eyeball; API side verified, simulator/device not driven here.

## Next steps
1. Reopen/refresh the installed app and confirm it loads live data (it should now).
2. Before any unsupervised exposure: add auth (see `docs/tech-debt.md` options).
3. Optional: migrate CI auth to OIDC; rotate root keys; add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to `deploy-api.yml` (GitHub forces Node-20 actions to Node 24 from 2026-06-02).
4. Optional: a custom domain on App Runner.

## References
- Live API: https://96mgvmgcbj.us-east-1.awsapprunner.com (`/trpc/health`, `/trpc/events.mine`)
- PRs this session: #16 (harden: reset flag + rollback alert + runbook), #17 (fix: deploy-status sentinel + CI build caching). Both merged to `main`.
- Linear: DRP-22 "Live API stuck on old schema..." (Done) — https://linear.app/drp-02/issue/DRP-22
- Code: `apps/api/src/index.ts` (migrate-on-boot, `DB_RESET_ON_BOOT`, seed modes), `apps/api/src/db/seed.ts`, `apps/api/.env.example`
- CI/CD: `.github/workflows/deploy-api.yml` (build + rollback alert), `.github/workflows/cd.yml` (Android release APK), `.github/workflows/node.js.yml` (CI)
- Ops: `docs/runbook-deploy.md`, `infra/aws-deploy.sh`, `infra/teardown.sh`, `infra/.deploy-state.local` (gitignored secrets/IDs)
- Tech debt: `docs/tech-debt.md`
- Prior summaries: `docs/summary/2026-05-28-1624-aws-app-runner-rds-deployment-and-cd.md`, `docs/summary/2026-05-28-1705-live-backend-deploy-and-standalone-apk.md`
- Repo guidance: `CLAUDE.md`, `CONTRIBUTING.md`
