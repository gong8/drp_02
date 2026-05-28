# pnpm Monorepo Migration, Branching Model, and Quality Tooling — 2026-05-28

**Branch:** `dev` | **PRs this session:** #6, #7, #8 (all merged) | **Scope:** Upgrade Expo to SDK 56, restructure into a pnpm monorepo with a tRPC backend skeleton, set up a `dev`-only-to-`main` branching/CI model, and add a Biome + `pnpm check` quality gate. Plus CLAUDE.md and a `/summary` command.

## TL;DR

`drp_02` started as a single-package Expo (SDK 54, npm) app and is now a **pnpm-workspace monorepo** (`apps/mobile`, `apps/api`, `packages/shared`) on an **Expo + tRPC + Zod + Drizzle + Postgres + Fastify** stack — a verified **skeleton with no product/domain logic yet**. Production (`main`) is protected so that **only `dev` can merge into it**, CI runs only on PRs into `main` (with a `guard` job enforcing the dev-only rule), and CD (Android) runs on push to `main`, gated by CI. A `pnpm check` gate (Biome lint+format, typecheck, tests, and a custom escape-hatch scanner) is wired into CI. `CLAUDE.md` and a project `/summary` slash command were added. The app is a group meetup-coordination product ("BeThere"), but that is background only — nothing product-specific is implemented.

## What was done

1. **Analyzed the original CI/CD + scaffold.** Found a single-package Expo SDK 54 app on npm, two workflows (Node CI on push/PR to main; Android CD via `workflow_run`), and a lock-file conflict (`package-lock.json` modified + untracked `pnpm-lock.yaml`). Flagged `build --if-present` no-op, no lint, placeholder tests, and `--legacy-peer-deps` masking a peer conflict.
2. **Upgraded Expo SDK 54 → 56** (PR #6, branch `chore/upgrade-expo-sdk-56`). Used `npx expo install --fix` so Expo set exact compatible versions rather than blind npm-latest. Added `@types/jest` + `"types": ["jest"]` so strict `tsc` resolves jest globals in the test file. (This PR was still on npm.)
3. **Brainstormed the backend + monorepo** and chose the stack (see decisions below). Wrote a design spec and an implementation plan under `docs/superpowers/`.
4. **Executed the monorepo migration** (PR #7, branch `feat/pnpm-monorepo-skeleton`) via subagent-driven development in 6 units: workspace root + move mobile → `apps/mobile`; scaffold `apps/api` and `packages/shared` + `docker-compose.yml`; migrate npm→pnpm and generate `pnpm-lock.yaml`; prove the type chain; update CI/CD + README; full verification. Final review applied two fixes.
5. **Set up the branching/protection model.** Created `dev` off `main`; added a `guard` CI job + branch protection so only `dev`→`main` can merge; switched CI to PR-into-main-only and CD to push-to-main; documented enforceable-vs-convention rules in `CONTRIBUTING.md` (PR #8 promoted these to `main`).
6. **Added a quality gate.** Biome 2.4.16 (lint + format), a custom `scripts/quality-check.mjs` escape-hatch scanner, and a `pnpm check` command; wired CI to run it. Committed to `dev` (`ad3125b`).
7. **Wrote `CLAUDE.md`** (`d6d75e9`) and created the **`/summary`** slash command (`.claude/commands/summary.md`, currently uncommitted).

## Key decisions & rationale

- **tRPC over REST.** User wanted maximum type safety with a single first-party TS client. tRPC gives end-to-end types with zero codegen and deletes the hand-synced-API-types problem. Cost: TS-on-both-ends coupling (acceptable — it's a monorepo).
- **Drizzle over Prisma.** Code-first TS schema; row types flow through tRPC to the client with no generate step; matches the "own your database" intent (thin typed-SQL layer). Prisma's extra codegen step was the deciding negative.
- **Postgres self-hosted via docker-compose**, not Supabase — explicit user preference to run their own database.
- **Fastify over Hono as the tRPC host.** Two reasons: (a) the product design removed the need for server-pushed real-time (BeReal-style proposals are delivered by push notifications, and responses are *blind during the window*), neutralizing Hono-vs-Fastify real-time differences; (b) the project is "mostly Claude-coded," and tRPC-on-Fastify is the more canonical/stable pattern in training data → more reliable generation with fewer hallucinated APIs.
- **pnpm over npm; `apps/` + `packages/` both.** Workspace management; `apps/{mobile,api}` are deployables, `packages/shared` is a library. Resolved the user's "apps vs packages" question — it's both.
- **Dropped the planned `packages/tsconfig` package** in favor of a root `tsconfig.base.json` + relative `extends` (lighter, fewer moving parts). Mobile keeps extending `expo/tsconfig.base`.
- **`main` admin bypass ON (`enforce_admins=false`).** Pragmatic for a small team / avoids lockout; user chose this over strict enforcement.
- **"Only `dev`→`main`" enforced via a `guard` check, not native settings.** GitHub has no native "restrict PR source branch" rule, so a workflow job that fails when `head_ref != 'dev'` (made a required check) is the enforcement mechanism.
- **Biome formatter enabled (not lint-only)**, normalized once with `biome check --write`; quality script focuses on suppression escape-hatches Biome can't see, since Biome's `noExplicitAny` already covers explicit `any`.
- **Strict ban-list** for the quality script (includes `@ts-expect-error` and `biome-ignore`) — user wanted zero escape hatches.

## Things learned / discovered

- **Expo SDK 56 expects TypeScript ~6.0.3, jest ~29.7, and react 19.2.3** — corrected my initial assumptions (I'd guessed TS ~5.9 and jest 30). `npx expo install --check` / `--fix` is authoritative; don't hand-pick versions for Expo.
- After the SDK 56 upgrade, **`pnpm install` succeeds with NO `--legacy-peer-deps`** — the peer conflict that previously required that flag was resolved by the upgrade.
- **All chosen backend versions resolved first try** (no drift): `@trpc/server`/`@trpc/client` 11.17.0, `fastify` 5.8.5, `drizzle-orm` 0.38.4, `drizzle-kit` 0.30.6, `@biomejs/biome` 2.4.16.
- **Metro + pnpm requires `.npmrc` with `node-linker=hoisted`** — pnpm's default symlinked `node_modules` breaks Metro.
- **`apps/api` is ESM** (`"type": "module"`) → relative imports need `.js` extensions; `apps/mobile` imports `@drp/api` **type-only** so Metro never bundles server code (it's a devDependency).
- **GitHub `pull_request` uses the HEAD branch's workflow version** (confirmed: PR #8's CI ran `dev`'s new workflow). This is why promoting workflows to `main` before enabling required checks avoids a bootstrap deadlock.
- **`gh pr create` fork-detection bug:** `jhug146/drp_02` redirects to `gong8/drp_02`; `gh` resolved the PR base to the wrong fork and failed. Workaround that worked: `gh api repos/jhug146/drp_02/pulls -f head=... -f base=...`.
- **Security:** the branch `guard` originally interpolated `${{ github.head_ref }}` (attacker-controllable via fork PR branch names) directly into a shell `run:` — a command-injection vector. Fixed with the env-var pattern (`env: HEAD_REF: ...` then `"$HEAD_REF"`). The `if:` expression context is safe.
- **Slash-command authoring:** `!`cmd`` injections require the matching `Bash(...)` in `allowed-tools`, and a **failing injected command halts the whole command** — so the fragile `gh` call is guarded with `… 2>/dev/null || echo`. `allowed-tools` is permission-granting, not restrictive.
- **CLAUDE.md is loaded into every prompt**; Anthropic guidance: keep ~50–100 lines, and there's an empirical ~150–200 instruction budget before compliance drops. Bloat dilutes the critical rules.
- The API **`health` route works without Postgres** — it doesn't touch the DB, and the Drizzle `Pool` connects lazily, so the server boots for smoke tests without `db:up`.

## Current state

- **Local branch:** `dev` (ahead of `main` by `b63e0a2` branching model, `d6d75e9` CLAUDE.md, `ad3125b` Biome gate).
- **`main`** contains: the monorepo (PR #7) and the new-model workflows + `CONTRIBUTING.md` (PR #8).
- **Merged PRs:** #5 (react bumps), #6 (Expo SDK 56), #7 (monorepo skeleton), #8 (workflow/branching promotion). #1–#4 predate this session.
- **Verified green:** `pnpm install --frozen-lockfile`, `pnpm typecheck` (3/3 packages), `pnpm test` (1 passed), `pnpm lint` (Biome), `pnpm quality` (no banned patterns; negative-tested to confirm it catches `as any`/`@ts-ignore`/`biome-ignore`), and API health smoke test (`GET /trpc/health` → `200 {"result":{"data":{"ok":true}}}`).
- **Uncommitted in working tree:** `.claude/commands/summary.md` (this command — pending a commit decision) and `docs/superpowers/specs/2026-05-28-bethere-product-design.md` (a **stray file from the user's separate "BeThere" session — left untouched**).
- **Installed versions:** expo 56.0.6, expo-status-bar 56.0.4, react 19.2.3, react-native 0.85.3, typescript 6.0.3, jest 29.7.0, jest-expo 56.0.4, @babel/core 7.29.7, @types/react 19.2.15, @types/jest 29.5.14, @biomejs/biome 2.4.16, pnpm 9.15.4.

## Conventions, commands & workflows

- **Package manager: pnpm only** (never npm/yarn). `.npmrc` sets `node-linker=hoisted`.
- **Commands:** `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm lint` (`biome check`), `pnpm format` (`biome check --write`), `pnpm quality`, **`pnpm check`** (lint → typecheck → test → quality), `pnpm dev:api` (http://localhost:3000), `pnpm dev:mobile`, `pnpm db:up`/`db:down`. Target one package with `pnpm --filter @drp/<pkg> <script>`.
- **Branching (enforced):** branch off `dev`; feature work on `feat/*`; PR into `dev`. To ship: PR `dev`→`main` (the only branch allowed to merge to `main`). CI runs on PRs into `main`; CD (Android) on push to `main`.
- **Enforced by GitHub:** `main` requires a PR + checks `[guard, ci]`, no direct push, no force-push/deletion; `guard` rejects non-`dev` sources; `dev` blocks force-push/deletion. **Convention only (not enforceable):** "branch off `dev`, never `main`" — Git can't restrict where a branch is created; the merge-side rule is what's enforced.
- **Type chain:** define Zod schemas in `packages/shared` → expose tRPC procedures in `apps/api/src/router.ts` (+ `routers/`) → mobile gets types automatically. Don't hand-write API types.
- **No escape hatches:** `as any`, `@ts-ignore`, `@ts-nocheck`, `@ts-expect-error`, `eslint-disable*`, `biome-ignore`, and `.eslintignore` are banned by `pnpm quality`.

## Known issues / caveats / risks

- **Android CD under pnpm monorepo is not fully validated.** `expo prebuild` + Gradle with hoisted `node_modules` can need autolinking/path tweaks (a `react-native.config.js` or `root` in `android/app/build.gradle`). A prior Android build run did succeed, but the new `push:[main]` trigger path should be confirmed before relying on the APK artifact.
- **Stale merged remote branches** not cleaned up: `feat/pnpm-monorepo-skeleton`, `chore/upgrade-expo-sdk-56`, `update-react-packages`, `feat/basic-app`.
- **`.claude/commands/summary.md` is uncommitted** — needs a commit decision.
- **Stray file** `docs/superpowers/specs/2026-05-28-bethere-product-design.md` is untracked and unowned by this session.
- The `/summary` command couldn't be run end-to-end by the author (custom commands are user-invoked); its mechanics were validated (frontmatter parses, all injected commands exit 0).

## Next steps

- Decide whether to commit `.claude/commands/summary.md` to `dev` (and how to handle the stray `bethere-product-design.md`).
- Optionally delete the four stale merged remote branches.
- Validate the Android CD end-to-end (real `expo prebuild` + Gradle) before trusting the APK output.
- When starting product work: build domain logic following the type chain (Zod in `packages/shared` → tRPC in `apps/api` → typed mobile client), add Drizzle tables in `apps/api/src/db/schema.ts` and migrate via `pnpm --filter @drp/api db:generate`/`db:migrate`.

## References

- `CLAUDE.md` — repo guidance (stack, commands, branching, conventions).
- `CONTRIBUTING.md` — full branching model and enforced-vs-convention rules.
- `docs/superpowers/specs/2026-05-28-pnpm-monorepo-skeleton-design.md` — approved design spec.
- `docs/superpowers/plans/2026-05-28-pnpm-monorepo-skeleton.md` — implementation plan.
- `biome.json`, `scripts/quality-check.mjs` — quality tooling.
- `.github/workflows/node.js.yml` (CI: guard + ci), `.github/workflows/cd.yml` (Android CD on push to main).
- `apps/api/src/router.ts` (tRPC `AppRouter` + `health`), `apps/mobile/src/lib/trpc.ts` (typed client / type-chain proof).
- PRs: #6 (Expo 56), #7 (monorepo skeleton), #8 (branching/workflows) — all at https://github.com/gong8/drp_02.
- Product context (background, not implemented): `docs/superpowers/specs/2026-05-28-bethere-product-design.md` (from a separate session) — a meetup-coordination app where users submit private availability, the system fires time-boxed BeReal-style proposals, and people respond Yes/No/Conditional blind during the window.
