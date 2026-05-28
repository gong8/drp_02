# BeThere API → live AWS backend (App Runner + RDS) with CD — 2026-05-28

**Branch:** feat/bethere-full-loop (merged → dev → main) | **PRs:** #12, #13 (both MERGED) | **Linear:** DRP-16 (Done) | **Scope:** Take the BeThere API from localhost-only to a public HTTPS backend on AWS, connect the mobile app, and wire continuous deployment.

## TL;DR
The session moved the `@bethere/api` server off localhost onto a public, autoscaling **AWS App Runner** service backed by a **private RDS Postgres 16** instance, reachable at `https://96mgvmgcbj.us-east-1.awsapprunner.com`. We made the API deployable (Dockerfile, migrate-on-boot, seed-if-empty, TLS-to-RDS, env-driven mobile API URL), provisioned all AWS infrastructure via the CLI (captured in `infra/`), and wired GitHub Actions CD that builds/pushes the image to ECR so App Runner auto-deploys. Everything was shipped to `main` through PRs #12 and #13, and the full CD chain was proven end-to-end: the **Deploy API** workflow pushed a new image → App Runner auto-deployed (`START_DEPLOYMENT SUCCEEDED`), and the **Android CD** workflow produced `app-debug.apk` (46 MB) with the live URL baked in. The one explicitly-deferred item is API authentication (logged as tech debt).

## Context at session start
- `drp_02` / **BeThere** is a group meetup-coordination app for the Imperial+RCA "Designing for Real People" (DRP) course; M2 (Walking Skeleton) milestone. The M2 software rubric rewards "Git → CI → public deployment → **functioning CD**", which directly motivated doing a real deployment + CD (not just running locally).
- Monorepo: pnpm workspace, `apps/api` (Fastify + tRPC v11), `apps/mobile` (Expo SDK 56 RN), `packages/shared` (Zod schemas + logic). ESM, Drizzle ORM + Postgres.
- The user has **$10,000 of AWS credits**, so cost was a non-issue; optimize for speed, reliability, a public HTTPS URL, and a CD story.
- Repo: github.com/gong8/drp_02. AWS account **208569836255**, region **us-east-1** (authenticated locally with **root access keys** — flagged as a security smell).

## What was done

### 1. Codebase analysis (parallel subagents)
Four `general-purpose` agents analyzed: API runtime, persistence layer, mobile↔API contract, and build/CI/CD. Key findings that shaped the plan:
- API depends on **Postgres only** (no S3/queues/websockets/external APIs). Binds `0.0.0.0`, port `PORT ?? 3000`, CORS `origin:true`. Health via tRPC `GET /trpc/health`.
- Ran via `tsx` with **no build/start script, no Dockerfile**.
- `reseedDemo()` **deletes 5 tables on every boot** (`index.ts` → `db/seed.ts`).
- Migrations existed but were **never run on startup**; `pg` pool had **no SSL**.
- Mobile tRPC client **hardcoded `http://localhost:3000/trpc`**, HTTP-only, no auth headers; `platforms: ["ios","android"]` (no web).
- (Agents under-reported the schema as "2 tables" — reading the real files showed **8 tables**: users, groups, group_members, suggestions, availability, moments, responses, plans. The DB analysis agent was stale; always verify against real files.)

### 2. Hosting decision
Recommended **App Runner + RDS** over EC2 and ECS. Walked the user through tradeoffs (see Key decisions). User chose App Runner + **private RDS via VPC connector**, and "do everything including CD now."

### 3. Phase 1 — make the API deployable (commit `3ebd76c`, on feat/bethere-full-loop)
- `apps/api/src/db/client.ts`: TLS resolution — plaintext for localhost; for remote, verify against a CA at `DATABASE_CA_PATH` else fall back to unverified TLS. Added `DATABASE_SSL` override (`disable|require|verify`) so the container can be smoke-tested against the local non-SSL Postgres.
- `apps/api/src/db/seed.ts`: split insert logic into `insertDemoData()`; kept `reseedDemo()` (wipe + insert) for local dev; added `seedDemoIfEmpty()` (insert only when `suggestions` empty) for the live backend.
- `apps/api/src/index.ts`: run Drizzle migrations on boot (`migrate()` from `drizzle-orm/node-postgres/migrator`, folder resolved via `import.meta.url`); `SEED_ON_BOOT` env selects `reset` (default, dev) | `if-empty` (live) | `off`.
- `apps/api/package.json`: added `start` script (`tsx src/index.ts`) + `engines.node >=20`.
- `apps/mobile/src/lib/trpc.ts`: base URL from `EXPO_PUBLIC_API_URL` (fallback `http://localhost:3000`).
- New `apps/api/Dockerfile` (built from repo root; pnpm workspace install filtered to `@bethere/api...`; runs via `tsx`; `ADD`s the AWS RDS CA bundle to `/app/rds-ca.pem`; sets `DATABASE_CA_PATH`, `SEED_ON_BOOT=if-empty`, `PORT=3000`). New root `.dockerignore`.
- Verified: `pnpm check` green; built image; ran container against local Postgres (`-e DATABASE_SSL=disable`) → logs showed "migrations applied" + "seeded demo data (if-empty)" + `/trpc/health` 200; `drizzle-kit generate` reported **no drift**.

### 4. Phase 2 — provision AWS (CLI; recorded in `infra/aws-deploy.sh`)
Resources (all us-east-1, default VPC `vpc-0b1d0390723265c33`):
- Security groups `bethere-rds-sg` + `bethere-apprunner-sg`; ingress rule App Runner SG → RDS:5432.
- DB subnet group `bethere-subnets` (3 subnets across 1a/1b/1c).
- **RDS** `bethere-db`: Postgres **16.14**, `db.t4g.micro`, 20 GB gp3, **private** (`--no-publicly-accessible`), db/user `bethere`, password generated via `openssl rand -hex 24`.
- **ECR** repo `bethere-api`; image built `--platform linux/amd64 --provenance=false` and pushed.
- **IAM** access role `bethere-apprunner-ecr-role` (trust `build.apprunner.amazonaws.com`, policy `AWSAppRunnerServicePolicyForECRAccess`).
- **VPC connector** `bethere-vpc-conn` (subnets + apprunner SG).
- **App Runner** service `bethere-api`: 0.5 vCPU / 1 GB, image `:latest`, env `DATABASE_URL` + `SEED_ON_BOOT=if-empty`, port 3000, health `/trpc/health`, **VPC egress** via the connector, **AutoDeploymentsEnabled=true**.
- Verified live: `/trpc/health` 200; `/trpc/groups.mine` and `/trpc/suggestions.get?input=...` returned seeded data from RDS → proving App Runner → VPC connector → RDS, migrations, and seeding all work.
- Secrets/IDs saved to **`infra/.deploy-state.local`** (gitignored). Also wrote **`infra/teardown.sh`** to delete everything and stop billing.

### 5. Phase 3 — connect mobile + CD (commit `c7a22e3`)
- Scoped CI IAM user **`bethere-ci`** with an inline ECR-push-only policy (never root keys). Created an access key; stored in `infra/.deploy-state.local` and as GitHub repo secrets `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` via `gh secret set`. Verified the key can authenticate to ECR.
- New **`.github/workflows/deploy-api.yml`**: on push to `main` (paths: apps/api, packages/shared, lockfile, workspace, the workflow), configure AWS creds → ECR login → `docker buildx build --provenance=false --platform linux/amd64 ... --push` (`:latest` + `:${{ github.sha }}`). App Runner auto-deploys on the `:latest` push.
- Edited **`.github/workflows/cd.yml`** (Android): added job env `EXPO_PUBLIC_API_URL=https://96mgvmgcbj.us-east-1.awsapprunner.com` so the APK targets the live backend.
- `apps/mobile/.env.example` documents `EXPO_PUBLIC_API_URL`.

### 6. CORS / auth question → logged as tech debt (commit `cc88eaf`)
User asked whether the API should be "fully open" and how hard proper CORS is. Clarified that **CORS is browser-only** and the RN client ignores it — so tightening CORS does nothing against curl/scripts; the real openness is the **missing auth** (`x-user-id` stub defaults to `u_dev`). User chose to **leave it as documented tech debt**: `docs/tech-debt.md`.

### 7. Ship + prove CD (PRs #12, #13)
- PR **#12** feat/bethere-full-loop → dev (merged). PR **#13** dev → main (merged after CI green: guard + `pnpm check` + GitGuardian).
- Push to main triggered both CD workflows: **Deploy API** succeeded in 55s → App Runner `START_DEPLOYMENT SUCCEEDED` (16:16), service RUNNING; **Android CD** succeeded in 6m44s → artifact `app-debug` (46,096,622 bytes, expires 2026-06-27).
- Note: commits `9b4e247` (M2 mockups/nudge screens) and `4b90f8a` (remove em dashes) also landed on the branch — these were the user's / a linter's UI + style changes interleaved with the deploy work, not part of the deployment itself.

## Key decisions & rationale
- **App Runner over EC2 / ECS.** Decisive axis: a public **HTTPS URL with no domain**. App Runner gives free TLS on `*.awsapprunner.com`; EC2 and ECS both need a domain + ACM cert (ACM won't issue for `amazonaws.com` DNS). iOS/Android need HTTPS to talk to the backend. App Runner's "auto-deploy on ECR push" is also the cleanest CD story. ECS was deemed overkill for a 8-table skeleton; Lambda rejected (would require rewriting the long-running Fastify entrypoint + RDS Proxy for pooling).
- **Private RDS + VPC connector** over public RDS. App Runner runs outside the VPC by default; a VPC connector puts its egress on the VPC so it can reach a private RDS. Chosen for security (DB never on the public internet). Cost: migrations can't be run from the laptop (can't reach a private DB) → solved by **migrate-on-boot**.
- **Migrate-on-boot** rather than a manual/separate migrate step. Fixes "migrations never run on startup" AND the private-RDS-unreachable-from-laptop problem in one move; idempotent via Drizzle's `__drizzle_migrations` journal.
- **Seed-if-empty** for the live backend. The original `reseedDemo()` wiped data on every boot — fatal for App Runner where instances recycle/redeploy. `SEED_ON_BOOT` env preserves the wipe-on-boot ergonomics in dev (default `reset`) while the live service uses `if-empty`.
- **TLS verified against the bundled RDS CA**, not `rejectUnauthorized:false`. A security hook flagged disabling TLS verification; resolved by `ADD`ing the AWS RDS global CA bundle into the image and pointing `DATABASE_CA_PATH` at it. Unverified TLS remains only as a last-resort fallback, acceptable because the hop is private-VPC.
- **Run the API via `tsx` in the container** (no compile/bundle step). Smallest change that ships; image size irrelevant for a skeleton with ample credits.
- **Scoped CI IAM user, not root keys, not OIDC.** Root keys in CI is unacceptable; OIDC is best-practice but more setup. A scoped `bethere-ci` user (ECR-push only) was the pragmatic middle ground; OIDC noted as future hardening.
- **Auth deferred, CORS not "fixed."** Because the client is RN (CORS-immune), tightening CORS would be theater; real protection is auth, which is a bigger piece. Logged as tech debt rather than half-done.
- **Deploy onto feat/bethere-full-loop**, not dev. The deploy changes to `seed.ts` depend on the full-loop schema, so they can't live cleanly on dev. User chose to keep feature + deployment on one branch and ship together.

## Things learned / discovered
- **zsh `:l` history modifier bit us.** `"$ECR_URI:latest"` in zsh expanded to `...bethere-apiatest` because `$ECR_URI:l` applies the lowercase modifier, consuming `:l`. **Always brace: `"${ECR_URI}:latest"`.** This caused a failed `docker push` to a non-existent `bethere-apiatest` repo.
- **App Runner can't pull buildx's default image.** Default `docker buildx build` produces an OCI image index + attestation manifest; App Runner needs a single Docker v2 schema2 manifest. Fix: `--provenance=false` (and `--platform linux/amd64`). Confirmed pushed manifest media type `application/vnd.docker.distribution.manifest.v2+json`.
- **Architecture matters.** Local Mac is arm64; App Runner default is x86_64 → build `--platform linux/amd64` (emulated locally; native on GitHub amd64 runners).
- **Transient AWS errors.** First `create-db-subnet-group` and `create-vpc-connector` failed with "invalid subnets"/"Failed to get subnets details" despite valid subnets; a straight retry succeeded. Don't trust a single failure — verify and retry.
- **RDS forces TLS**; a plain `pg` pool fails to connect without `ssl`. Bundling the RDS CA is the correct fix.
- **`gh pr view --json merged`** is not a field; use `state` / `mergedAt`. **`gh run view --json artifacts`** is not a field; list artifacts via `gh api repos/<owner>/<repo>/actions/runs/<id>/artifacts`.
- **App Runner first deploy** took ~4 min to reach RUNNING; status string `OPERATION_IN_PROGRESS` → `RUNNING`. There is no `aws apprunner wait`; poll `describe-service` Status.
- **msgpackr-extract** native build fails in the Docker image (no Python/gyp) but is optional — msgpackr falls back to pure JS; harmless.
- Node-version note: CI uses Node 20; local Mac has Node 23; image is Node 20. Works fine (ESM + top-level await). GitHub deprecation warning: Node 20 actions will be forced to Node 24 from 2026-06-02 (non-blocking; `cd.yml` already sets `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `deploy-api.yml` does not — could add later).

## Current state
- **Live backend:** `https://96mgvmgcbj.us-east-1.awsapprunner.com` — RUNNING, `/trpc/health` 200, DB-backed queries verified.
- **AWS (us-east-1, acct 208569836255):** App Runner `bethere-api` (ARN `…/service/bethere-api/260292b3564d41d6b60e9e2129a0263b`), RDS `bethere-db` (endpoint `bethere-db.cofy48ucsi6c.us-east-1.rds.amazonaws.com`), ECR `bethere-api`, VPC connector `bethere-vpc-conn`, IAM role `bethere-apprunner-ecr-role`, CI user `bethere-ci`.
- **Git:** `main` has everything (PRs #12, #13 merged). Local branch still `feat/bethere-full-loop`. Working tree has minor untracked/modified items (`.DS_Store`, a separate earlier summary file) + linter em-dash normalizations.
- **CD:** proven. Deploy API + Android CD both ran green on the main push; App Runner auto-deployed; APK artifact `app-debug` available on the Android CD run.
- **Verified vs pending:** Backend, DB chain, both CD pipelines, and App Runner auto-deploy are **verified**. **Not yet done by anyone:** installing the APK on the physical Android device and visually confirming the UI against the live backend (API side verified, simulator/device not run).
- Secrets/resource IDs (incl. RDS password + CI key) live in gitignored **`infra/.deploy-state.local`**.

## Conventions, commands & workflows
- **Branching:** `main` is protected/production. Work on `dev`; big features as `feat/*` → PR into `dev`; ship via PR `dev → main` (the only branch allowed into main; the CI `guard` job enforces head==dev). CI runs on PRs into main; CD runs on push to main.
- **Quality gate:** `pnpm check` = lint (Biome) + typecheck + test + `scripts/quality-check.mjs`. Run `pnpm typecheck` + `pnpm test` before any PR.
- **Issue tracking:** all work in **Linear** (team DRP_02) via MCP; keep status in sync. This work = **DRP-16** (Done).
- **Build image:** `docker build --platform linux/amd64 --provenance=false -f apps/api/Dockerfile -t <ecr>:latest .` (context = repo root). Always brace shell vars in zsh: `"${VAR}:tag"`.
- **Deploy:** push to `main` → `deploy-api.yml` builds/pushes to ECR → App Runner auto-deploys. APK: `cd.yml` → `app-debug` artifact.
- **Run live API locally for the app:** `EXPO_PUBLIC_API_URL=https://96mgvmgcbj.us-east-1.awsapprunner.com pnpm dev:mobile`.
- **Provision / teardown:** `infra/aws-deploy.sh` (reproduce) / `infra/teardown.sh` (delete all to stop billing).

## Known issues / caveats / risks
- **No authentication / open API** — `x-user-id` stub defaults to `u_dev`; anyone with the URL can read/write via curl. CORS `origin:true` is irrelevant (RN client). Acceptable for supervised skeleton testing only. See `docs/tech-debt.md`. Fix path: CORS allowlist → shared `x-api-key` (weak) → real per-user auth (proper).
- **Root AWS access keys** used locally — rotate to a non-root IAM user.
- **CI secrets are long-lived access keys** in GitHub — consider OIDC later.
- **RDS:** single-AZ, 1-day backups, `db.t4g.micro`, no Performance Insights — fine for a skeleton, not production-resilient.
- **Demo seed references "today"** (`todayISO()` in `seed.ts`): the seeded "free this evening" availability is for the seed date, so the demo scenario goes stale the next day on a long-lived DB (seed-if-empty won't refresh it). Re-seed by emptying the DB if needed.
- **Ongoing cost** ~$15–40/mo (RDS is the bulk), covered by credits; run teardown to zero it.
- **App Runner instance recycles** are safe now (seed-if-empty) but any future destructive boot logic would wipe shared data — keep boot idempotent.

## Next steps
1. **Install & test on the Android device:** download the `app-debug` artifact from the latest Android CD run, sideload, open, confirm it loads the live Flatmates data over HTTPS.
2. Decide on auth before any unsupervised/public exposure (see tech-debt options).
3. Optional hardening: add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` to `deploy-api.yml`; migrate CI auth to OIDC; rotate root keys to an IAM user.
4. Optional: a custom domain on App Runner if a branded URL is wanted.

## References
- Live API: https://96mgvmgcbj.us-east-1.awsapprunner.com (`/trpc/health`)
- PRs: #12 (feat→dev), #13 (dev→main) — both merged.
- Linear: DRP-16 "Deploy API to a public live backend (AWS App Runner + RDS) with CD" (Done) — https://linear.app/drp-02/issue/DRP-16
- Code: `apps/api/Dockerfile`, `apps/api/src/index.ts`, `apps/api/src/db/client.ts`, `apps/api/src/db/seed.ts`, `apps/mobile/src/lib/trpc.ts`
- CI/CD: `.github/workflows/deploy-api.yml`, `.github/workflows/cd.yml`
- Infra: `infra/aws-deploy.sh`, `infra/teardown.sh`, `infra/.deploy-state.local` (gitignored — secrets/IDs)
- Tech debt: `docs/tech-debt.md`
- Repo guidance: `CLAUDE.md`, `CONTRIBUTING.md`
