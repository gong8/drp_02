# Isolated dev deployment (web + backend) mirroring main - 2026-06-03

**Branch:** dev | **Linear:** DRP-31 (Done) | **Commits:** 9acc228, f801a80, 9b49e14 | **Scope:** Stand up a second, fully isolated deployment for the `dev` branch (Vercel web preview + AWS App Runner backend + own RDS), mirroring the prod `main` stack, without touching prod.

## TL;DR
The team wanted a "second dev deployment, just like main, but for dev." Investigation showed the stack is split: web on Vercel (gated to build `main` only), backend on AWS App Runner + RDS, Android APK as a CD artifact. Because `dev` runs ahead of `main` (new migration `0004` + new `floats` API), pointing dev web at the prod backend would break, so dev needed its own backend + database. We mirrored the prod AWS stack: a new RDS `bethere-db-dev` and App Runner `bethere-api-dev` (isolated via a separate ECR `:dev` tag), reusing all of prod's shared infra (VPC, ECR repo, IAM role, VPC connector, RDS security group). We un-gated `dev` in `vercel.json`, set Preview-scoped Vercel env, added a `deploy-api-dev.yml` CD workflow, and broadened the CI IAM user. End state: dev backend live and healthy at `https://wumksaeb3j.us-east-1.awsapprunner.com`, dev web live at `https://bethere-git-dev-gong8s-projects.vercel.app`, CD self-validated green, prod untouched.

## What was done

**Investigation / scoping (read-only)**
- Read `.github/workflows/{cd.yml,deploy-api.yml,node.js.yml}`, `vercel.json`, `.vercel/project.json`, `apps/api/Dockerfile`, `docker-compose.yml`, `docs/runbook-deploy.md`, and `infra/aws-deploy.sh` (the prod provisioning recipe).
- Queried live AWS: prod App Runner config + env var keys; confirmed `dev` is 8 commits ahead of `main` with migration `0004_parched_rage.sql` and changed API contract (`schema.ts`, `router.ts`, new `routers/floats.ts`, `packages/shared` schemas).
- Established the key fork (asked the user twice): dev web must talk to a **separate dev backend**, not prod, because the web build bakes `EXPO_PUBLIC_API_URL` at build time and dev's API contract differs from prod's. User chose "mirror main on AWS."

**Provisioning (AWS, us-east-1, account 208569836255)**
- Created RDS `bethere-db-dev` (db.t4g.micro, pg 16.14, 20GB gp3, subnet group `bethere-subnets`, SG `bethere-rds-sg`, fresh password, db-name `bethere`, private, no-multi-az, backup 1 day).
- Built the API image from the current `dev` tree and pushed it to ECR as `bethere-api:dev` (bootstrap - App Runner cannot create a service from a tag that does not exist).
- Created App Runner `bethere-api-dev` (0.5 vCPU / 1 GB, reusing IAM role `bethere-apprunner-ecr-role` + VPC connector `bethere-vpc-conn`, health `/trpc/health`, auto-deploy on `:dev`). Env mirrors prod: copied `CLERK_JWT_KEY` + `CLERK_SECRET_KEY` from the prod service, dev `DATABASE_URL`, `DEV_AUTH_BYPASS=1`, `SEED_ON_BOOT=if-empty`, and a **freshly generated** `ADMIN_RESET_TOKEN` (not prod's).
- Broadened the `bethere-ci` IAM user policy's apprunner resource from `service/bethere-api/*` to `service/bethere-api*/*` so the dev workflow's rollback-alert step can read the dev service.
- Saved dev creds (DB password, RDS endpoint, admin token) to gitignored `infra/.deploy-state-dev.local`.

**Repo changes (3 modular commits on `dev`)**
- `9acc228 feat(infra)`: `infra/aws-deploy-dev.sh` (reproducible record), `.github/workflows/deploy-api-dev.yml` (dev CD), and `.gitignore` (ignore the dev state file).
- `f801a80 feat(web)`: `vercel.json` un-gate - `ignoreCommand` now builds both `main` and `dev`.
- `9b49e14 docs(runbook)`: `docs/runbook-deploy.md` dev-stack section (prod/dev resource table, dev ARN/URL, how reset/reseed apply to dev).

**Vercel**
- Set three **Preview**-scoped env vars branch-scoped to `dev` on project `bethere`: `EXPO_PUBLIC_API_URL=https://wumksaeb3j.us-east-1.awsapprunner.com`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (the public `pk_test_...` key), `EXPO_PUBLIC_DEV_AUTH=1`.

**Verification**
- Dev API: `/trpc/health` -> ok; `floats.mine` (with `x-user-id: u_dev`) returns seeded float data (proves the `:dev` image + dev schema + seed, since prod `:latest` has no floats router).
- Dev web: branch alias HTTP 200, bundle baked with the dev API host (prod host absent) + publishable key.
- CD self-validation: pushing the workflow file triggered `Deploy API (dev)` -> built `:dev` -> App Runner `START_DEPLOYMENT SUCCEEDED` -> dev API healthy. Run concluded `success`.
- Prod untouched: prod API healthy, prod web 200, prod Vercel Production env vars unchanged.

## Key decisions & rationale

- **Separate dev backend + DB, not shared prod backend.** The web build inlines `EXPO_PUBLIC_API_URL` at build time. `dev` is ahead of `main` (migration `0004`, new `floats` procedures, changed Zod/schema), so dev's frontend would call procedures/columns prod's deployed `:latest` image lacks and fail. The runbook's own note ("If a procedure the app calls returns 404, the deployed image is older than the app") is exactly this failure. Isolation is the only correct option, confirmed by the user.
- **Mirror prod on AWS** (vs. a cheaper Neon+Fly/Vercel stack). User chose truest parity over minimal cost. Cost: ~$15-25/mo (db.t4g.micro RDS + App Runner 0.5vCPU/1GB).
- **Isolate via a separate ECR tag (`:dev` vs prod `:latest`), reuse everything else.** Each App Runner service auto-deploys only on its own tag, so a dev push can never disturb prod. This let us reuse the default VPC, subnets, the `bethere-api` ECR repo, the `bethere-apprunner-ecr-role` pull role, the `bethere-vpc-conn` connector, and even the `bethere-rds-sg` security group (it already allows the App Runner egress SG on 5432, and one SG can attach to multiple RDS instances). Only two genuinely new billable resources.
- **Copy Clerk keys from prod, regenerate the admin token.** Same Clerk app -> same keys work for dev. But `ADMIN_RESET_TOKEN` is a destructive-action secret; minted fresh for dev so prod's isn't duplicated.
- **Branch-scoped Preview env (Preview + branch `dev`), not all-Preview.** Cleanest: only dev preview builds get the dev API URL; other branches are skipped by `ignoreCommand` anyway.
- **`EXPO_PUBLIC_DEV_AUTH=1` on dev web** (prod web does not set it). Dev is a testing env; the dev-bypass "Continue as test user" button (backed by the dev backend's `DEV_AUTH_BYPASS=1`) makes testing easier.
- **Bootstrap image built from the `dev` tree** (not re-tagging prod `:latest`). First boot then runs dev code and applies migration `0004` cleanly to the empty dev DB; the workflow keeps `:dev` current thereafter.

## Things learned / discovered

- **Prod stack shape:** web on Vercel project `bethere` (`gong8s-projects/bethere`, prj_AxGfy2tOQ6KEJbZkKIYWlNSnIQDZ), backend on App Runner `bethere-api` (`https://96mgvmgcbj.us-east-1.awsapprunner.com`, ARN `.../service/bethere-api/260292b3564d41d6b60e9e2129a0263b`) from ECR `bethere-api:latest`, RDS `bethere-db`. Android APK is a CD artifact.
- **`vercel.json` `ignoreCommand` semantics:** returns exit 0 -> skip build; non-zero -> build. Old value `[ "$REF" != "main" ]` skipped every non-main branch (dev pushes showed as "Canceled" 3-4s deployments). New value `[ "$REF" != "main" ] && [ "$REF" != "dev" ]` builds both.
- **Vercel "Sensitive" env vars are write-only:** `vercel env pull --environment=production` returned `EXPO_PUBLIC_API_URL=""` and `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=""` (empty), so the publishable key could not be read back from Vercel. Solution: the publishable key is a *public* value inlined into the prod web bundle - fetched the prod web app (public, HTTP 200) and grepped its `/_expo/static/js/web/*.js` bundle for `pk_(test|live)_...`. Got `pk_test_...` (58 chars, test mode).
- **curl + Vercel compression gotcha:** the Vercel CDN serves the JS bundle brotli/gzip-compressed. Plain `curl -s` intermittently returned compressed bytes, so `grep` for the baked URL flip-flopped between hit and miss on the *same* bundle hash. Fix: `curl -s --compressed` to decompress, then grep deterministically (bundle = 1.54 MB, dev host present, prod host absent).
- **Direct Vercel deployment URLs (`bethere-<hash>-gong8s-projects.vercel.app`) sit behind Vercel SSO/deployment protection**; the public, stable URL is the branch alias `bethere-git-dev-gong8s-projects.vercel.app`. Verify against the alias, not the deployment URL.
- **App Runner has no `aws apprunner wait`** for service-running; polled `describe-service` Status until `RUNNING`. First create took ~a few minutes.
- **`vercel env add <name> preview <gitbranch>`** reads the value from stdin (`printf 'value' | vercel env add ...`), creating a branch-scoped Preview var.
- **AWS CLI locally is authenticated as the account root** (208569836255). Works, but a security smell; CD uses the scoped `bethere-ci` IAM user instead.
- **Node 20 deprecation warning** on `deploy-api-dev.yml` (and prod's `deploy-api.yml`) - the pinned action SHAs run on Node 20; GitHub forces Node 24 from 2026-06-16. Pre-existing, shared with prod, not a regression.

## Current state

- **Dev backend:** App Runner `bethere-api-dev`, ARN `arn:aws:apprunner:us-east-1:208569836255:service/bethere-api-dev/f6c777627a7e473989fe9514709d16c6`, URL `https://wumksaeb3j.us-east-1.awsapprunner.com` - RUNNING, healthy, on dev code + schema + seed. RDS `bethere-db-dev` (endpoint `bethere-db-dev.cofy48ucsi6c.us-east-1.rds.amazonaws.com`).
- **Dev web:** `https://bethere-git-dev-gong8s-projects.vercel.app` - Ready, baked with dev API URL + publishable key. Builds on every push to `dev`.
- **CD:** `.github/workflows/deploy-api-dev.yml` green (run 26888998259). `bethere-ci` IAM widened to `service/bethere-api*/*`.
- **Repo:** 3 commits pushed to `dev` (9acc228, f801a80, 9b49e14). Working tree clean except the harness file `.claude/scheduled_tasks.lock` (do not commit).
- **Linear:** DRP-31 marked Done with a results comment.
- **Local secrets:** `infra/.deploy-state-dev.local` (gitignored) holds the dev DB password, RDS endpoint, and admin token. Clerk keys live only on the dev App Runner service + prod.
- All verification items pass; nothing pending.

## Conventions, commands & workflows

- **Two parallel backend stacks now exist.** Prod (`main` -> ECR `:latest` -> App Runner `bethere-api` -> RDS `bethere-db`) and dev (`dev` -> ECR `:dev` -> App Runner `bethere-api-dev` -> RDS `bethere-db-dev`). They are independent because each service auto-deploys only on its own tag.
- **The runbook (`docs/runbook-deploy.md`) now covers both** - every procedure (deploy flow, silent-rollback failure mode, `DB_RESET_ON_BOOT`, manual reset over a temporary public connection, `/admin/reseed`) applies to dev by swapping the `-dev` service ARN / URL / RDS identifier.
- **Reprovision dev from scratch:** `infra/aws-deploy-dev.sh` (mirrors `infra/aws-deploy.sh`; reuses shared infra, only creates RDS + App Runner + the IAM widening). Copy Clerk values from the prod service env.
- **Vercel dev env lives in Preview (branch `dev`) scope** - if the dev API URL ever changes, update `EXPO_PUBLIC_API_URL` there (it is baked at build time, so a redeploy is needed to take effect).
- Branching unchanged: work on `dev`; `main` is protected; PR `dev` -> `main` to ship. (This work stayed on `dev`, which is correct - it is dev-only infra.)

## Known issues / caveats / risks

- **Cost:** ~$15-25/mo added (db.t4g.micro RDS + App Runner 0.5vCPU/1GB). Teardown mirrors `infra/teardown.sh` against the `-dev` resources if the env is retired.
- **Node 20 actions** in `deploy-api*.yml` will break after GitHub's 2026-06-16 forced Node 24 switch unless `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` is set (prod's `cd.yml` sets it at env level; the two `deploy-api*.yml` files do not). Pre-existing; affects prod too.
- **Dev `SEED_ON_BOOT=if-empty`** means the dev DB seeds once and then persists; it does not reset on every deploy. To wipe dev demo data use `/admin/reseed` with the dev `ADMIN_RESET_TOKEN`, or `DB_RESET_ON_BOOT=true` for one deploy (see runbook).
- **Root AWS credentials on the local machine** - works but is a security smell; consider an IAM user/role for local admin.
- The dev backend reuses the **same Clerk app** as prod, so real Google sign-in on dev shares prod's Clerk user pool. Fine for a demo; revisit if dev needs an isolated user set.

## Next steps
- Optional: give the dev web a friendlier custom alias (e.g. `dev-bethere.vercel.app`) instead of the auto branch alias.
- Optional: bump the two `deploy-api*.yml` workflows to Node-24-compatible action versions (or set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`) before 2026-06-16.
- When retiring the dev env, write `infra/teardown-dev.sh` mirroring `infra/teardown.sh` for the `-dev` resources.

## References
- `infra/aws-deploy-dev.sh` - dev provisioning record (mirrors `infra/aws-deploy.sh`).
- `.github/workflows/deploy-api-dev.yml` - dev backend CD (mirrors `deploy-api.yml`).
- `vercel.json` - `ignoreCommand` builds `main` + `dev`.
- `docs/runbook-deploy.md` - "The dev stack" + "The dev web" sections.
- `infra/.deploy-state-dev.local` - gitignored dev secrets (DB password, RDS endpoint, admin token).
- `apps/mobile/src/lib/clerk.ts`, `apps/mobile/App.tsx:137` - how the web app consumes `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` / `EXPO_PUBLIC_DEV_AUTH` (ClerkProvider always mounts, so the publishable key is required).
- Linear DRP-31: https://linear.app/drp-02/issue/DRP-31
- Plan file: `/Users/gong/.claude/plans/playful-frolicking-sloth.md`
