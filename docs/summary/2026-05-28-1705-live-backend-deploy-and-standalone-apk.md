# BeThere: live AWS backend + CD, and standalone Android APK fix — 2026-05-28

**Branch:** dev (all work merged to `main`) | **PRs:** #12, #13, #14 (all MERGED) | **Linear:** DRP-16 (Done), DRP-19 (Done) | **Scope:** Deploy the API to a public AWS backend with CD, then fix the Android APK so it runs standalone on a device.

> A more detailed archive of the deployment phases exists at `docs/summary/2026-05-28-1624-aws-app-runner-rds-deployment-and-cd.md`. This file is self-contained and additionally covers the APK release-build fix done afterward.

## TL;DR
This session took the BeThere API from localhost-only to a live, public HTTPS backend on **AWS App Runner + private RDS Postgres** (`https://96mgvmgcbj.us-east-1.awsapprunner.com`), wired **GitHub Actions CD**, and shipped it all to `main`. We then discovered the Android APK produced by CD was a **debug** build that needed a Metro dev server (failed on-device with "unable to load script"), and fixed it by switching the Android CD to **`assembleRelease`** so the JS bundle is embedded and the APK runs standalone. End state: backend live and verified; CD proven end-to-end; a self-contained `app-release.apk` is downloadable from the latest Android CD run. The only deliberately-deferred item is API authentication (logged as tech debt).

## What was done

### A. Codebase analysis (parallel subagents)
Four agents analyzed API runtime, persistence, mobile↔API contract, and build/CI. Findings that shaped everything: API needs **Postgres only**; ran via `tsx` with **no Dockerfile/build step**; `reseedDemo()` **wiped the DB every boot**; migrations **never ran on startup**; `pg` pool had **no TLS**; mobile **hardcoded `localhost:3000`**; client is **mobile-only** (`platforms:[ios,android]`, no web). (Agents under-reported the schema as 2 tables; the real schema has **8** — always verify against source.)

### B. Hosting decision → App Runner + RDS
Recommended and chose **App Runner + private RDS via VPC connector** over EC2/ECS. User authorized "do everything including CD now."

### C. Phase 1 — make the API deployable (commit `3ebd76c`)
- `apps/api/src/db/client.ts`: TLS for non-local DB — verify against CA at `DATABASE_CA_PATH`, else fall back to unverified TLS; `DATABASE_SSL` env override (`disable|require|verify`) so the container can be tested against local non-SSL Postgres.
- `apps/api/src/db/seed.ts`: split `insertDemoData()`; kept `reseedDemo()` (wipe+insert, local dev) and added `seedDemoIfEmpty()` (insert only if `suggestions` empty, live).
- `apps/api/src/index.ts`: run Drizzle migrations on boot; `SEED_ON_BOOT` env = `reset`(default/dev) | `if-empty`(live) | `off`.
- `apps/api/package.json`: `start` script (`tsx src/index.ts`), `engines.node >=20`.
- `apps/mobile/src/lib/trpc.ts`: API base URL from `EXPO_PUBLIC_API_URL` (fallback localhost).
- New `apps/api/Dockerfile` (built from repo root; pnpm workspace install filtered to `@bethere/api...`; `ADD`s AWS RDS CA bundle → `/app/rds-ca.pem`; runs via `tsx`) + root `.dockerignore`.
- Verified: `pnpm check` green; container ran against local Postgres → `/trpc/health` 200; `drizzle-kit generate` showed no drift.

### D. Phase 2 — provision AWS (CLI; recorded in `infra/aws-deploy.sh`)
All in us-east-1, default VPC `vpc-0b1d0390723265c33`: security groups (App Runner SG → RDS:5432), DB subnet group, **RDS** `bethere-db` (Postgres **16.14**, `db.t4g.micro`, private), **ECR** `bethere-api`, **IAM** access role `bethere-apprunner-ecr-role`, **VPC connector** `bethere-vpc-conn`, **App Runner** service `bethere-api` (0.5 vCPU/1 GB, env `DATABASE_URL`+`SEED_ON_BOOT=if-empty`, port 3000, health `/trpc/health`, VPC egress, **AutoDeploymentsEnabled=true**). Verified live end-to-end: `groups.mine` and `suggestions.get` returned seeded data from RDS. Secrets/IDs in gitignored `infra/.deploy-state.local`; teardown in `infra/teardown.sh`.

### E. Phase 3 — connect mobile + CD (commit `c7a22e3`)
- Scoped CI IAM user `bethere-ci` (ECR-push only) → GitHub secrets `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (verified can auth to ECR).
- `.github/workflows/deploy-api.yml`: on push to `main` (path-filtered to apps/api, packages/shared, lockfile, workspace, the workflow), buildx `--provenance=false --platform linux/amd64` → push `:latest`+`:sha` to ECR → App Runner auto-deploys.
- `.github/workflows/cd.yml`: bake `EXPO_PUBLIC_API_URL` (live URL) into the Android job.
- `apps/mobile/.env.example` documents the var.

### F. CORS/auth question → tech debt (commit `cc88eaf`)
Clarified that CORS is browser-only and the RN client ignores it, so tightening CORS does nothing against curl/scripts; the real openness is **no auth** (`x-user-id` stub defaults to `u_dev`). User chose to log it as tech debt → `docs/tech-debt.md`.

### G. Ship + prove CD (PRs #12, #13)
- #12 feat/bethere-full-loop → dev; #13 dev → main (CI green: guard + `pnpm check` + GitGuardian).
- Push to main: **Deploy API** (55s) → App Runner `START_DEPLOYMENT SUCCEEDED`, RUNNING; **Android CD** (6m44s) → APK artifact. (Also on the branch: `8f56c50`, `9b4e247`, `4b90f8a` = the user's/linter's UI + style commits, not part of deploy.)

### H. Standalone APK fix (commit `919d52a`, PR #14) — the new work this session
- **Symptom:** sideloading the APK on the physical Android device → "unable to load script… make sure you're running Metro… index.android.bundle packaged correctly for release." The app shouldn't need Metro for a standalone APK.
- **Root cause:** `cd.yml` ran `assembleDebug -PbundleInDebug=true`. There is **no committed `android/`** (CI generates it via `expo prebuild`), and that `-PbundleInDebug` property is **not read** by Expo's generated Gradle, so it was a no-op. A debug APK does **not** embed the JS bundle → it tries to fetch from Metro at `localhost:8081`.
- **Fix:** switch the Android CD to **`assembleRelease`**. Verified locally by running `expo prebuild --platform android` and inspecting the generated `android/app/build.gradle`: the `release` buildType uses `signingConfig signingConfigs.debug` (so the APK is **debug-signed → installable without a keystore**), and `hermesEnabled=true` (JS embedded as Hermes bytecode). `EXPO_PUBLIC_API_URL` is still inlined during the release bundle step. Updated artifact `app-debug`→`app-release` and path to `…/apk/release/app-release.apk`. (Cleaned up the local prebuild side-effects: it modified `apps/mobile/app.json` + `package.json` and created `apps/mobile/android/` — note **`android/` is NOT gitignored** — all reverted/removed.)
- **Shipped on `dev`** (per branching rules, since the feature branch was merged) → PR #14 dev→main, CI green, merged. Only **Android CD** ran (Deploy API path-filter correctly skipped since only `cd.yml` changed). Release build succeeded in **7m21s**; artifact **`app-release`** (~30 MB) at run `26585290136`.

## Key decisions & rationale
- **App Runner over EC2/ECS** — decisive axis was **free HTTPS without a custom domain** (mobile needs TLS; EC2/ECS need a domain + ACM cert). App Runner's auto-deploy-on-ECR-push is also the cleanest CD. ECS = overkill; Lambda rejected (would force an entrypoint rewrite + RDS Proxy).
- **Private RDS + VPC connector** over public RDS — security (DB never public). Cost: laptop can't reach a private DB → solved by **migrate-on-boot**.
- **Migrate-on-boot + seed-if-empty** — migrate-on-boot fixes "migrations never run" AND the private-RDS-from-laptop problem; seed-if-empty prevents App Runner instance recycles/redeploys from wiping data, while `SEED_ON_BOOT=reset` keeps dev's clean-replay ergonomics.
- **TLS verified against bundled RDS CA**, not blanket `rejectUnauthorized:false` (a security hook flagged it). Unverified TLS remains only as a last-resort fallback, acceptable because the hop is private-VPC.
- **Run via `tsx` in the container** — smallest change that ships; image size irrelevant given credits.
- **Scoped CI IAM user, not root, not OIDC** — root-in-CI is unacceptable; OIDC is best-practice but more setup; a scoped user is the pragmatic middle ground (OIDC noted as future hardening).
- **Auth deferred / CORS not "fixed"** — CORS is theater for a CORS-immune RN client; real protection is auth, a bigger piece. Logged as tech debt rather than half-done.
- **APK: release over force-bundled-debug** — `assembleRelease` is the standard, reliable way to get a standalone, bundled, installable APK; Expo's template debug-signs release so no keystore work is needed. Force-embedding a bundle into a debug build is messier.

## Things learned / discovered
- **zsh `:l` history modifier bites unbraced vars.** `"$ECR_URI:latest"` became `…bethere-apiatest` (zsh applied the `:l` lowercase modifier, consuming `:l`). **Always brace: `"${VAR}:tag"`.** Caused a failed push to a non-existent ECR repo.
- **App Runner can't pull buildx's default OCI index/attestation image.** Use `docker build/buildx --provenance=false` (+ `--platform linux/amd64`) to get a single Docker v2 schema2 manifest. Confirmed media type `application/vnd.docker.distribution.manifest.v2+json`.
- **Architecture:** local Mac is arm64; App Runner is x86_64 → build `--platform linux/amd64` (emulated locally, native on GitHub runners).
- **`expo prebuild` is NOT gitignored here** for `apps/mobile/android/`, and it also rewrites `apps/mobile/app.json` + `package.json`. If you run it locally to inspect, revert those and `rm -rf apps/mobile/android` so they don't get committed.
- **Debug vs release APK:** debug APK = no embedded JS, needs Metro; release APK = Hermes bytecode embedded, standalone. Expo SDK 56 / RN 0.85 `release` buildType is debug-signed by default (installable), minify off by default.
- **Transient AWS errors:** first `create-db-subnet-group` and `create-vpc-connector` failed ("invalid subnets") on valid subnets; a plain retry succeeded.
- **RDS forces TLS;** a plain `pg` pool fails without `ssl`.
- **`gh` quirks:** `gh pr view --json merged` and `gh run view --json artifacts` are invalid fields (use `state`/`mergedAt`; list artifacts via `gh api repos/<o>/<r>/actions/runs/<id>/artifacts`). `gh pr checks --watch` can **exit 0 before all required checks register** — re-check `statusCheckRollup` / poll until the `ci` check is `COMPLETED` before merging.
- **Path filters work as intended:** changing only `cd.yml` triggered Android CD but not Deploy API (whose `paths:` exclude it) — so the API didn't needlessly redeploy.
- **Non-blocking annotation:** GitHub will force Node-20 actions to Node 24 from 2026-06-02; `cd.yml` sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `deploy-api.yml` does not (could add later).
- **msgpackr-extract** native build fails in the Docker image (no Python) but is optional (pure-JS fallback) — harmless.

## Current state
- **Live backend:** `https://96mgvmgcbj.us-east-1.awsapprunner.com` — App Runner RUNNING, `/trpc/health` 200, DB-backed queries verified.
- **Git:** `main` has everything (PRs #12/#13/#14 merged). Working branch is now **`dev`** (HEAD `919d52a`), in sync with `main`. The old `feat/bethere-full-loop` is merged.
- **APK:** standalone **`app-release`** (~30 MB) on Android CD run `26585290136` (expires 2026-06-27). **Not yet confirmed installed/working on the physical device** — that step is the user's.
- **AWS (acct 208569836255, us-east-1):** App Runner `bethere-api`, RDS `bethere-db` (endpoint `bethere-db.cofy48ucsi6c.us-east-1.rds.amazonaws.com`), ECR `bethere-api`, VPC connector `bethere-vpc-conn`, IAM role `bethere-apprunner-ecr-role`, CI user `bethere-ci`. Secrets/IDs in gitignored `infra/.deploy-state.local`.
- **CD:** both pipelines proven green; App Runner auto-deploy verified (`START_DEPLOYMENT SUCCEEDED`).

## Conventions, commands & workflows
- **Branching:** `main` protected; work on `dev`; big features `feat/*` → PR into `dev`; ship via PR `dev → main` (CI `guard` job enforces head==dev). CI on PRs into main; CD on push to main.
- **Quality gate:** `pnpm check` = Biome lint + typecheck + test + `scripts/quality-check.mjs`.
- **Linear:** track all work (team DRP_02). This session: DRP-16 (deploy), DRP-19 (APK fix), both Done.
- **Build/push image:** `docker build --platform linux/amd64 --provenance=false -f apps/api/Dockerfile -t <ecr>:latest .` from repo root. Brace shell vars in zsh.
- **Deploy:** push to `main` → `deploy-api.yml` → ECR → App Runner auto-deploys. APK: `cd.yml` → `assembleRelease` → `app-release` artifact.
- **Run app against live API locally:** `EXPO_PUBLIC_API_URL=https://96mgvmgcbj.us-east-1.awsapprunner.com pnpm dev:mobile`.
- **Provision/teardown:** `infra/aws-deploy.sh` / `infra/teardown.sh`.

## Known issues / caveats / risks
- **No authentication / open API** — `x-user-id` stub defaults to `u_dev`; anyone with the URL can read/write via curl. CORS `origin:true` is irrelevant (RN client). Acceptable for supervised skeleton testing only. See `docs/tech-debt.md`. Fix path: CORS allowlist → shared `x-api-key` (weak) → real per-user auth.
- **Root AWS access keys** used locally — rotate to a non-root IAM user.
- **CI uses long-lived access keys** in GitHub secrets — consider OIDC later.
- **`apps/mobile/android/` is not gitignored** — don't accidentally commit a generated native project; `expo prebuild` also edits `app.json`/`package.json`.
- **Release APK is debug-signed** — fine for sideload testing, NOT for a store/production release (generate a real keystore + EAS credentials for that).
- **RDS:** single-AZ, 1-day backups, `db.t4g.micro`, no Performance Insights — fine for a skeleton, not production-resilient.
- **Demo seed references "today"** (`todayISO()`): on a long-lived DB the seeded "free this evening" availability goes stale next day, and seed-if-empty won't refresh it (empty the DB to re-seed).
- **Ongoing cost** ~$15–40/mo (RDS is the bulk), covered by credits; `infra/teardown.sh` zeroes it.
- **APK device test still pending** — verified the API and the build, not an actual install/run on the phone.

## Next steps
1. **Install `app-release.apk` on the Android device** (download artifact from run 26585290136, unzip, uninstall the old debug app, sideload) and confirm it loads live data over HTTPS.
2. Decide on auth before any unsupervised/public exposure (see tech-debt options).
3. Optional hardening: add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to `deploy-api.yml`; migrate CI to OIDC; rotate root keys; real release keystore if distributing the app.
4. Optional: custom domain on App Runner for a branded URL.

## References
- Live API: https://96mgvmgcbj.us-east-1.awsapprunner.com (`/trpc/health`)
- PRs: #12 (feat→dev), #13 (dev→main, ship), #14 (dev→main, APK fix) — all merged.
- Latest Android CD run (release APK): https://github.com/gong8/drp_02/actions/runs/26585290136 — artifact `app-release`.
- Linear: DRP-16 (deploy, Done) https://linear.app/drp-02/issue/DRP-16 ; DRP-19 (APK fix, Done) https://linear.app/drp-02/issue/DRP-19
- Code: `apps/api/Dockerfile`, `apps/api/src/{index.ts,db/client.ts,db/seed.ts}`, `apps/mobile/src/lib/trpc.ts`
- CI/CD: `.github/workflows/cd.yml` (Android, now `assembleRelease`), `.github/workflows/deploy-api.yml` (backend), `.github/workflows/node.js.yml` (CI)
- Infra: `infra/aws-deploy.sh`, `infra/teardown.sh`, `infra/.deploy-state.local` (gitignored — secrets/IDs)
- Tech debt: `docs/tech-debt.md`
- Prior detailed summary: `docs/summary/2026-05-28-1624-aws-app-runner-rds-deployment-and-cd.md`
- Repo guidance: `CLAUDE.md`, `CONTRIBUTING.md`
