# Runbook: backend deploy, migrations, and DB reset

How the live API ships and how to handle the one failure mode that bit us: a migration
**baseline reset** that leaves the live RDS schema out of sync.

## How deploy works

- Push to `main` (paths under `apps/api/**`, `packages/shared/**`, lockfile, or the workflow)
  runs `.github/workflows/deploy-api.yml`: build the image, push `:latest` + `:<sha>` to ECR.
- App Runner has **auto-deploy on `:latest`** enabled, so the push triggers a rolling deploy.
- On boot the container runs **migrate-on-boot** (`apps/api/src/index.ts`): applies any
  Drizzle migrations in `apps/api/src/db/migrations`, then seeds per `SEED_ON_BOOT`
  (`if-empty` in prod).
- The CD workflow's **"Alert if App Runner rolled back"** step waits for the deploy to settle
  and raises a GitHub **warning** (it does NOT fail the build) if the deploy did not succeed.

## The failure mode: silent rollback after a baseline reset

If migrate-on-boot throws, the process exits, the App Runner health check fails, and App
Runner **rolls back to the previous image** - so prod silently stays on old code even though
CD is green. The common trigger is a **migration baseline reset**: deleting the migrations and
regenerating a fresh `0000_*.sql`. The new `0000` tries to `CREATE TYPE/TABLE` that already
exist in the live DB, which fails with `error: type "..." already exists` (Postgres `42710`).

This matches the CLAUDE.md note: *if you reset the migration baseline, reset the DB too.*

**Normal forward work is safe:** no-schema-change PRs and proper incremental migrations
(`drizzle-kit generate` -> a new numbered `0001_*.sql`) apply cleanly. Only baseline resets
need the procedure below.

## Fix A (preferred): one-shot DB_RESET_ON_BOOT

`apps/api/src/index.ts` honors `DB_RESET_ON_BOOT=true`: before migrating it drops and
recreates the `public` schema, so the fresh baseline applies cleanly. Default off; it logs a
loud warning when used. It runs inside App Runner, so no DB network access from your laptop is
needed. **It wipes all data** - fine while data is throwaway demo/seed; do not use once there
is real data to keep.

1. Set the env var on the service (one deploy only):
   ```bash
   aws apprunner update-service \
     --service-arn arn:aws:apprunner:us-east-1:208569836255:service/bethere-api/260292b3564d41d6b60e9e2129a0263b \
     --source-configuration '{"ImageRepository":{"ImageIdentifier":"208569836255.dkr.ecr.us-east-1.amazonaws.com/bethere-api:latest","ImageRepositoryType":"ECR","ImageConfiguration":{"Port":"3000","RuntimeEnvironmentVariables":{"DATABASE_URL":"<unchanged>","SEED_ON_BOOT":"if-empty","DB_RESET_ON_BOOT":"true"}}}}'
   ```
   (Easier: set it in the App Runner console -> Configuration -> Environment variables, then Deploy.)
2. Wait for the deploy to reach `RUNNING` and confirm `START_DEPLOYMENT ... SUCCEEDED`:
   ```bash
   aws apprunner list-operations --service-arn <ARN> --max-results 1 \
     --query 'OperationSummaryList[0].[Type,Status]' --output text
   ```
3. **Set `DB_RESET_ON_BOOT` back to `false`** (or remove it) and deploy again - otherwise it
   wipes the DB on every future boot/recycle.

## Fix B (fallback): manual reset over a temporary public connection

Used on 2026-05-28 before Fix A existed. RDS is private, so briefly expose it:

```bash
source infra/.deploy-state.local          # DB_USER, DB_PASS, RDS_ENDPOINT, RDS_SG, DB_NAME
MYIP=$(curl -fsS https://checkip.amazonaws.com)
aws rds modify-db-instance --db-instance-identifier bethere-db --publicly-accessible --apply-immediately
aws ec2 authorize-security-group-ingress --group-id "$RDS_SG" --protocol tcp --port 5432 --cidr "$MYIP/32"
# wait until PubliclyAccessible=true and status=available, then:
psql "postgresql://$DB_USER:$DB_PASS@$RDS_ENDPOINT:5432/$DB_NAME?sslmode=require" \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;'
# revert:
aws ec2 revoke-security-group-ingress --group-id "$RDS_SG" --protocol tcp --port 5432 --cidr "$MYIP/32"
aws rds modify-db-instance --db-instance-identifier bethere-db --no-publicly-accessible --apply-immediately
aws apprunner start-deployment --service-arn <ARN>   # redeploy so migrate-on-boot rebuilds
```

## Verifying a deploy is actually live

```bash
B=https://96mgvmgcbj.us-east-1.awsapprunner.com
curl -fsS $B/trpc/health                 # {"result":{"data":{"ok":true}}}
curl -fsS $B/trpc/groups.mine | head -c 200   # should reflect the current schema/data
```
If a procedure the app calls returns 404, the deployed image is older than the app - check for
a rolled-back deploy (the CD warning, or `list-operations`).

## Reset live demo data

Wipe + reinstall the demo seed on the live API WITHOUT a redeploy. Gated by the
`ADMIN_RESET_TOKEN` env var on the App Runner service - the endpoint returns 403 if the var is
unset, so it is inert anywhere the secret is not configured (e.g. local dev, which already
reseeds on every boot).

```bash
ADMIN_RESET_TOKEN=<the secret> pnpm reseed:live
# or directly:
ADMIN_RESET_TOKEN=<the secret> curl -fsS -X POST \
  https://96mgvmgcbj.us-east-1.awsapprunner.com/admin/reseed -H "x-admin-token: $ADMIN_RESET_TOKEN"
# -> {"ok":true}
```

The token lives only in the App Runner service env (and the team password manager) - never in git.
It wipes ALL data and restores `apps/api/src/db/seed.ts`'s demo, so give the team a heads-up first.
To rotate, update `ADMIN_RESET_TOKEN` in the App Runner console (one deploy).

## The dev stack (isolated mirror of prod)

`dev` has its own backend + database so in-flight work (which runs ahead of `main`) can be
exercised without touching prod. It mirrors the prod stack and **reuses** prod's shared infra
(default VPC + subnets, the `bethere-api` ECR repo, the `bethere-apprunner-ecr-role` pull role,
the `bethere-vpc-conn` connector, and the `bethere-rds-sg` security group). Provisioning record:
`infra/aws-deploy-dev.sh`. Linear: DRP-31.

| | prod (`main`) | dev (`dev`) |
| --- | --- | --- |
| App Runner service | `bethere-api` | `bethere-api-dev` |
| ECR tag (auto-deploy) | `:latest` | `:dev` |
| API URL | `https://96mgvmgcbj.us-east-1.awsapprunner.com` | `https://wumksaeb3j.us-east-1.awsapprunner.com` |
| RDS instance | `bethere-db` | `bethere-db-dev` |
| CD workflow | `.github/workflows/deploy-api.yml` | `.github/workflows/deploy-api-dev.yml` |
| Vercel web | Production (branch `main`) | Preview (branch `dev`), https://bethere-dev.vercel.app |

- dev service ARN:
  `arn:aws:apprunner:us-east-1:208569836255:service/bethere-api-dev/f6c777627a7e473989fe9514709d16c6`
- A separate ECR **tag** is what isolates the two: each App Runner service auto-deploys only on
  pushes to its own tag, so a `dev` push (`:dev`) never disturbs prod (`:latest`).
- Everything in this runbook applies to dev by swapping the service ARN / URL / RDS identifier
  for the `-dev` ones above (deploy flow, the silent-rollback failure mode, `DB_RESET_ON_BOOT`,
  the manual-reset fallback, `/admin/reseed`). The dev `ADMIN_RESET_TOKEN` is a separate secret
  from prod's (both live only in the service env + the team password manager).
- Local credentials for the dev stack (DB password, RDS endpoint, admin token) live in the
  gitignored `infra/.deploy-state-dev.local`.

## The dev web (Vercel)

`vercel.json`'s `ignoreCommand` builds for `main` (production) and `dev` (preview); other
branches are skipped. The `dev` branch is served at **https://bethere-dev.vercel.app** - a
project domain bound to the `dev` git branch (added via the Vercel API with `gitBranch: dev`),
so every dev deploy auto-updates it. Vercel's auto branch alias
`bethere-git-dev-<team>.vercel.app` also still works. The web build bakes its API URL at build
time, so the **Preview**-scoped Vercel env vars point dev at the dev API:
`EXPO_PUBLIC_API_URL=https://wumksaeb3j.us-east-1.awsapprunner.com`,
`EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (same Clerk app as prod), `EXPO_PUBLIC_DEV_AUTH=1`.
