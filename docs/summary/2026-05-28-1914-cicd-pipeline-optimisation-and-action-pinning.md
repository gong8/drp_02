# CI/CD pipeline optimisation and GitHub Actions SHA-pinning - 2026-05-28

**Branch:** dev | **PRs:** none opened this session (work committed straight to `dev`; promotion to `main` via a later `dev -> main` PR) | **Scope:** Four GitHub Actions pipeline optimisations, then a security follow-up pinning all actions to immutable commit SHAs.

## TL;DR
The session began as a Q&A about whether the APK build and API deploy run in parallel (they do - they are two independent workflows triggered by the same `push: main` event), then turned into "is the pipeline optimised?" The user asked to fix the four optimisation gaps I identified. I implemented Gradle caching, Docker layer + pnpm-store caching, a `paths:` filter + `workflow_dispatch` on the APK build, and `concurrency` groups on all three workflows, then committed to `dev` (`57873c9`). An automated background security review then flagged the two newly-added third-party actions as unpinned; the user chose to pin **all** actions repo-wide, so I resolved every action across all three workflows to its immutable commit SHA (verified live via `gh api`) and committed that (`afb1397`). Both commits are on `dev`. Work is tracked in Linear as **DRP-23** (Done).

## What was done

### 1. Diagnostic Q&A (no code change)
- Confirmed the **APK build** (`.github/workflows/cd.yml`, job `build-apk`) and **API deploy** (`.github/workflows/deploy-api.yml`, job `deploy`) run **in parallel** - they are separate workflow files both triggered on `push: branches: [main]`, with no `needs`/shared job between them, so GitHub starts them concurrently on separate runners.
- Noted one asymmetry: `deploy-api.yml` had a `paths:` filter (only runs on `apps/api/**`, `packages/shared/**`, lockfiles, its own workflow) plus `workflow_dispatch`; `cd.yml` (APK) had **no** path filter, so it rebuilt on every `main` push.

### 2. Four pipeline optimisations -> commit `57873c9` `perf(ci): cache Gradle + Docker layers, scope APK build, add concurrency`
- **Gradle caching** (`cd.yml`): added `gradle/actions/setup-gradle` after the Java setup. Caches the Gradle User Home (downloaded deps + wrapper distribution) around `./gradlew assembleRelease` - the slowest job, previously cold every run. Works despite the Android project being generated later by `expo prebuild`; cache *writes* happen because the workflow runs on `main` (the default branch).
- **Docker build cache** (`deploy-api.yml` + `apps/api/Dockerfile`):
  - Replaced the raw `docker buildx build ... --push` step with `docker/build-push-action` using `cache-from: type=gha` / `cache-to: type=gha,mode=max`. The action auto-exposes the GHA cache runtime token (raw CLI would have needed manual token plumbing). Preserved `provenance: false` and `platforms: linux/amd64` so App Runner still receives a single plain image (not a multi-arch manifest list).
  - Added a BuildKit pnpm-store cache mount in the Dockerfile: added `# syntax=docker/dockerfile:1` as line 1 and changed the install to `RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store --filter @bethere/api...`. Keeps the content-addressable store warm so a lockfile change re-runs install without re-downloading unchanged packages. The two caches are complementary: layer cache covers unchanged-lockfile, store mount covers lockfile churn.
- **paths filter + manual trigger** (`cd.yml`): added a `paths:` filter (`apps/mobile/**`, `packages/shared/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `.github/workflows/cd.yml`) plus `workflow_dispatch`. An API-only push to `main` no longer triggers a full Android build; APKs can still be cut manually.
- **concurrency groups** (all three workflows):
  - CI (`node.js.yml`) and APK (`cd.yml`): `cancel-in-progress: true` keyed on `${{ github.workflow }}-${{ github.ref }}` - superseded runs are cancelled (safe; no external side effects).
  - API deploy (`deploy-api.yml`): `cancel-in-progress: false` keyed on `${{ github.workflow }}` - deliberately conservative so a production deploy is never interrupted mid ECR-push / App Runner rollout; a newer push queues and runs after the current one settles.

### 3. Security follow-up: pin all actions to SHAs -> commit `afb1397` `harden(ci): pin all GitHub Actions to immutable commit SHAs`
- A background automated security review (security-guidance plugin) flagged the two newly-added third-party actions (`gradle/actions/setup-gradle@v4`, `docker/build-push-action@v6`) as **[HIGH] GitHub Actions Third-Party Unpinned**.
- I surfaced the tradeoff: the repo's existing convention was unpinned major-version tags everywhere, so pinning only the two flagged would be inconsistent and leave higher-value targets (the `aws-actions/*` credential steps) unpinned. Asked the user via AskUserQuestion; they chose **"Pin all repo-wide"**.
- Resolved every action's tag to its commit SHA live via `gh api repos/<repo>/commits/<tag> --jq .sha` (authenticated as `gong8`), and found the specific release version for each annotation by matching the SHA against `gh api repos/<repo>/tags`. Pinned all 10 distinct actions across 14 usages, each with a `# vX.Y.Z` comment.

| Action | Pinned SHA | Version |
|---|---|---|
| actions/checkout | `34e114876b0b11c390a56381ad16ebd13914f8d5` | v4.3.1 |
| actions/setup-node | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |
| actions/setup-java | `c1e323688fd81a25caa38c78aa6df2d33d3e20d9` | v4.8.0 |
| actions/upload-artifact | `ea165f8d65b6e75b540449e92b4886f43607fa02` | v4.6.2 |
| pnpm/action-setup | `b906affcce14559ad1aafd4ab0e942779e9f58b1` | v4.3.0 |
| gradle/actions (setup-gradle) | `ed408507eac070d1f99cc633dbcf757c94c7933a` | v4.4.3 |
| aws-actions/configure-aws-credentials | `7474bc4690e29a8392af63c5b98e7449536d5c3a` | v4.3.1 |
| aws-actions/amazon-ecr-login | `fa648b43de3d4d023bcb3f89ed6940096949c419` | v2.1.5 |
| docker/setup-buildx-action | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | v3.12.0 |
| docker/build-push-action | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` | v6.19.2 |

### Issue tracking
- Created **DRP-23** "Optimise CI/CD pipeline (Gradle + Docker caching, paths filter, concurrency)" in Linear team DRP_02, moved to In Progress at start, marked **Done** referencing `57873c9`, then added a comment documenting the SHA-pinning follow-up (`afb1397`).
- URL: https://linear.app/drp-02/issue/DRP-23

## Key decisions & rationale
- **API deploy uses `cancel-in-progress: false`, unlike CI/APK.** Cancelling a production deploy mid ECR-push / App Runner rollout is risky; queueing (GitHub keeps one pending run and cancels older *pending* ones) means prod still converges to the latest commit without interrupting an in-flight deploy. CI and APK have no external side effects, so cancelling superseded runs there is pure savings.
- **`build-push-action` over raw `docker buildx build`.** The action wires up the GHA cache backend token automatically; the raw CLI with `--cache-to type=gha` would have needed `crazy-max/ghaction-github-runtime` or manual token export. The action also cleanly maps `provenance: false` / `platforms` / multi-tag.
- **`type=gha` cache backend (not `type=registry`/ECR).** Free, simple, 10 GB repo limit is ample for one API image. `mode=max` caches intermediate stages for a higher hit rate.
- **`--store-dir=/pnpm/store` passed explicitly** rather than relying on `PNPM_HOME` magic. The pnpm default store location varies and the official `PNPM_HOME=/pnpm` Docker pattern was not trusted to place the store at `/pnpm/store`; the explicit flag guarantees the store path matches the cache-mount target. Verified `--store-dir` is a valid global flag for pnpm 9.15.4 via `pnpm install --help`.
- **Pin ALL actions, not just the two flagged.** Half-pinning is inconsistent and leaves the `aws-actions/*` steps (which handle AWS credentials) as the higher-value unpinned targets. User explicitly chose the comprehensive option.
- **Resolved real SHAs via `gh api`, not the review's placeholder SHAs.** The security review's suggested SHAs were illustrative examples; using them blindly would pin to wrong/unverified commits.

## Things learned / discovered
- **Stale session-start git snapshot.** The initial status listed `apps/api/.env.example` and `apps/api/src/index.ts` as modified, but by the time work started those were already committed - the snapshot was point-in-time. Always re-check `git status` before scoping a commit.
- **The user committed in parallel during the session.** Commits `1ec0201` (`fix(ci): correct App Runner deploy status sentinel in rollback alert` - the `case`-based polling refinement to the monitor `run:` block) and `f4d5519` (`docs: add summary docs`) landed between my two commits. A harness note also reported `deploy-api.yml` was modified externally mid-session (the monitor block). My pinning edits only touched `uses:` lines, so no conflict.
- **First pinning commit message was inaccurate and was amended.** The initial `afb1397` predecessor message claimed it "folds in the App Runner monitor refinement", but `git show` proved the commit was 14/14 lines of pure `uses:` pinning - the monitor change had already been committed separately as `1ec0201`. Amended the message (local, unpushed -> safe) to remove the false claim. Lesson: verify commit scope with `git show --stat` before trusting a drafted message.
- **No `actionlint`/`yamllint` installed**; validated workflows with `python3 -c "import yaml; yaml.safe_load(...)"` (pyyaml available). This catches syntax but not Actions-schema errors.
- **`gh` is authenticated** as account `gong8` (keyring). `gh api repos/<owner>/<repo>/commits/<ref> --jq .sha` resolves any tag/branch/sha to its commit SHA - the clean way to pin.
- **SHA pins do not auto-update** - they freeze patch fixes. Dependabot (`package-ecosystem: github-actions`) understands the `# vX.Y.Z` trailing comments and bumps SHA + comment together; offered but not yet added.

## Current state
- **Branch `dev`** HEAD is `afb1397` (action pinning). Working tree clean.
- **Commit `57873c9`** (four optimisations) - landed earlier; PR #17 "fix(ci): correct deploy-status sentinel + CI build caching" (dev -> main) merged 2026-05-28T18:04, which appears to have promoted `57873c9` + `1ec0201` to `main`. (Not independently re-verified against `main` in this session - confirm before assuming.)
- **Commit `afb1397`** (pinning) was made at ~19:07, *after* PR #17 merged, so it is on `dev` and **not yet in `main`**; it will promote on the next `dev -> main` PR.
- **Verified this session:** all three workflow YAMLs parse; zero mutable `@vN` tags remain (`grep "uses:.*@v[0-9]"` returns none); `--store-dir` valid for pnpm 9.15.4.
- **Not verified (only observable on real runs):** the cache hit-rate benefit (Gradle/Docker/pnpm caches only pay off on the second-and-later runs), and that `build-push-action` + `type=gha` behaves end-to-end in the live deploy. No Docker build or workflow run was executed locally.

## Conventions, commands & workflows
- **Branching (from CLAUDE.md):** work directly on `dev`; `main` is protected. Only `dev -> main` PRs may merge to `main`. CI runs on PRs into `main`; CD runs on push to `main`. This session committed to `dev` only and did not open a PR.
- **Commit trailer required:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **No em dashes** anywhere (use hyphens) - repo-wide rule.
- **Linear is the source of truth** - every piece of work gets an issue (team DRP_02), In Progress at start, Done at end with commit/PR reference.
- **Pin-resolution recipe:** `gh api repos/<owner>/<repo>/commits/<tag> --jq .sha` for the SHA; match against `gh api repos/<owner>/<repo>/tags --paginate` to recover the precise version for the `# comment`. For sub-path actions (e.g. `gradle/actions/setup-gradle`), the repo is the first two path segments (`gradle/actions`).
- **YAML validation without a linter:** `python3 -c "import yaml; yaml.safe_load(open('<f>'))"`.

## Known issues / caveats / risks
- **Cache benefit unproven until real runs.** First post-merge runs populate the caches; speed-up shows on subsequent runs.
- **SHA pins freeze updates** - no automatic patch/security bumps without Dependabot (not yet configured).
- **APK no longer builds on API-only `main` pushes.** If a release should always ship a fresh APK regardless of what changed, the `paths:` filter will skip it - use the new `workflow_dispatch` (Actions tab -> Android CD -> Run workflow) to cut one manually.
- **`# syntax=docker/dockerfile:1`** makes the build pull the dockerfile frontend image; standard with buildx in CI but a new external dependency at build time.
- **`main` promotion state of `afb1397` is unconfirmed** - verify it reaches `main` on the next PR.

## Next steps
- Open the next `dev -> main` PR to promote `afb1397` (action pinning) to production CD. (`57873c9` likely already promoted via PR #17 - confirm.)
- Optionally add Dependabot config (`.github/dependabot.yml`, `package-ecosystem: github-actions`) so pinned SHAs + version comments stay current automatically.
- After the first real post-merge runs, sanity-check that the Gradle cache, GHA Docker layer cache, and pnpm store mount are actually hitting (check run logs for cache restore lines and reduced step times).
- Consider whether the APK `paths:` filter matches release intent; if every release must ship an APK, reconsider or document the `workflow_dispatch` fallback.

## References
- `/Users/gong/Programming/drp_02/.github/workflows/cd.yml` - Android CD (APK build): Gradle caching, paths filter, workflow_dispatch, concurrency, pinned actions.
- `/Users/gong/Programming/drp_02/.github/workflows/deploy-api.yml` - API CD: build-push-action with GHA cache, concurrency (no cancel), App Runner rollback monitor, pinned actions.
- `/Users/gong/Programming/drp_02/.github/workflows/node.js.yml` - CI: dev-only guard + `pnpm check`, concurrency, pinned actions.
- `/Users/gong/Programming/drp_02/apps/api/Dockerfile` - syntax directive + pnpm-store BuildKit cache mount.
- `/Users/gong/Programming/drp_02/CLAUDE.md` - project conventions (branching, Linear, no em dashes, type chain).
- Linear DRP-23: https://linear.app/drp-02/issue/DRP-23
- Commits: `57873c9` (optimisations), `afb1397` (SHA pinning). Related parallel commits: `1ec0201` (deploy status sentinel fix), `f4d5519` (docs).
- PR #17 (merged): "fix(ci): correct deploy-status sentinel + CI build caching".
- Security guidance on workflow injection: https://github.blog/security/vulnerability-research/how-to-catch-github-actions-workflow-injections-before-attackers-do/
