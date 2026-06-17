# CLAUDE.md

Persistent guidance for Claude Code in this repo. These cover things you can't infer from the code - follow them.

## Project

`drp_02` is **BeThere**, a group meetup-coordination app (Expo mobile + Fastify/tRPC backend). The current model is the **unified suggest flow** (M3, replacing the older three-mode `whenMode` fork): a creator sends ONE plan to a group through ONE create flow. A plan owns two candidate lists - **TIME** (when) and **ACTIVITY** (what/where) - and members add to and publicly +1 either list during `collecting`. The creator never picks a "mode"; they only set two flags, both default `false` (open):

- **lockTimes** - when `true`, the time list is fixed: members vote but cannot add times.
- **lockActivity** - when `true`, the activity (what/where) list is fixed: members vote but cannot add activities.

Concrete shortcut: when BOTH axes are pinned - exactly ONE time candidate with `lockTimes`, AND at most one activity candidate with `lockActivity` - the plan skips `collecting` and opens straight into a blind timed **moment** (the old "exact" plan). Any open or contested axis starts a `collecting` round instead.

Everything after collecting is shared: a plan moves `collecting -> moment -> cleared` (or a silent `fizzled`); candidate +1 counts are **public during collecting** (momentum) but no voter names are ever shown - creator anonymity is ALWAYS on; at lock the most-voted TIME candidate wins, and the most-voted ACTIVITY candidate becomes the plan's **activity** (its name) if one is not already set; the plan then runs a **blind moment** where members RSVP **yes / no / "I'll go if [people]"** (conditionals resolved server-side); a per-user dashboard buckets plans into **Going / Open / Done** (plus an **All** overview), derived from each plan's per-user status (`reacting`/`awaiting`/`going`/`declined`); groups support membership CRUD and invite-link joins. Full design: `ARCHITECTURE.md`.

**A plan's name IS its `activity`** - there is no separate `title` (the title/activity/name concepts were unified in DRP-42: DB column `activity`, lock flag `lockActivity` / `lock_activity`; don't reintroduce a title). Two capabilities layer on top. Any group **member** (not just the creator) can edit a plan's text - its `activity` once locked, plus location and notes - before it clears, via `events.update`, an anonymous per-field **compare-and-set** that reports a conflict instead of clobbering a concurrent edit (while `collecting` the activity is still vote-decided, so it is not directly editable). And the create flow can **redo a past meetup**: a `source` step appears when the chosen group has cleared plans (`events.pastForGroup`) and clones a previous plan's shell, preloading what you did as a single locked activity so you only pick a new time - neither the old time nor any RSVPs carry over.

> The original standalone **loose-availability** prototype still lives in `archive/loose-availability/` (excluded from the build, do not edit it); its ideas were folded back into the current unified suggest flow. M2 concrete-event mockups: `docs/mockups/m2/ALL_MOCKUPS.pdf`; current unified-flow UX mockups: `docs/mockups/m3-ux-overhaul/all-screens.html`.

## Stack & layout

pnpm workspace monorepo. **Use `pnpm` only - never `npm` or `yarn`.** (`.npmrc` sets `node-linker=hoisted`, required by Expo/Metro.)

- `apps/mobile` - Expo SDK 54 React Native client (`@bethere/mobile`), running on iOS, Android, and web (`react-native-web`); navigation via `@react-navigation`
- `apps/api` - Fastify + tRPC server (`@bethere/api`)
- `packages/shared` - shared Zod schemas & types (`@bethere/shared`)

Stack: Expo · React Navigation · tRPC v11 · Zod · Drizzle ORM · Postgres · Fastify · Clerk.

TypeScript is split by package: `apps/api` and `packages/shared` are on TS `~6.0.3`; `apps/mobile` stays on TS `~5.9.3` (the line Expo SDK 54 / jest-expo expect). Don't unify them - bumping mobile's TS can break the Expo toolchain.

> **Do NOT upgrade the Expo SDK above 54.** The team tests on the App Store build of Expo Go, which only runs the latest SDK *it* shipped with (currently SDK 54). Pinning higher (we tried 56, then 55) makes Expo Go reject the project with "requires a newer version of Expo Go" - there is no newer Expo Go to install; the store build simply lags new SDK releases. Stay on SDK 54 until the team's installed Expo Go actually advances, then bump to match it (never ahead). The real long-term fix is a dev build (`expo-dev-client`), which removes this constraint - do that before bumping the SDK. When changing the SDK, use `npx expo install --fix` to align `react-native`/`react`/native modules; note pre-SDK-55 packages like `expo-status-bar` use their own version line (e.g. `~3.0.9`), not the SDK number. Entry point is `apps/mobile/index.ts` (`main: "index.ts"`), not `expo/AppEntry` - the latter's relative `../../App` import breaks under pnpm's hoisted node_modules.

## Commands

```bash
pnpm install                     # install workspace
pnpm lint                        # biome check (use `pnpm format` to auto-fix)
pnpm typecheck                   # tsc --noEmit, all packages
pnpm test                        # tests, all packages
pnpm check                       # lint + typecheck + test + quality (the pre-PR gate)
pnpm quality                     # bans escape hatches (as any, @ts-ignore, biome-ignore, ...)
pnpm dev:api                     # API at http://localhost:3000
pnpm dev:mobile                  # Expo dev server
pnpm db:up / pnpm db:down        # local Postgres (docker compose, host port 5433)
pnpm --filter @bethere/api <script>  # run a script in one package
```

Run `pnpm check` before opening any PR - it runs lint + typecheck + test + quality, the same gate CI runs on `dev` -> `main`.

## Conventions - IMPORTANT

- **No em dashes anywhere** (code, docs, comments) - use hyphens.
- **Type chain:** define data shapes as Zod schemas in `packages/shared`, expose tRPC procedures in `apps/api/src/router.ts` (+ `routers/`); the mobile client's types follow automatically. Don't hand-write API types.
- `apps/api` is ESM (`"type": "module"`) - relative imports need `.js` extensions.
- `apps/mobile` imports `@bethere/api` **type-only** (`import type { AppRouter }`) so Metro never bundles server code.
- **No escape hatches.** `pnpm quality` (part of `pnpm check`) fails the build on `as any`, `@ts-ignore` / `@ts-nocheck` / `@ts-expect-error`, `eslint-disable`, and `biome-ignore`. Fix the underlying type or lint issue instead of suppressing it.

## Branching - IMPORTANT

`main` is production and protected. **Never push to `main`, and never open a PR from a feature branch into `main`.**

- **Default: work directly on `dev`** - commit routine work straight to `dev`, no feature branch.
- **Only branch (`feat/*` → PR into `dev`) for a massive feature** worth isolating.
- To ship: PR `dev` → `main` (the only branch permitted to merge into `main`).
- CI runs on PRs into `main`; on push to `main` CD ships three targets: the API image to AWS App Runner (`deploy-api.yml`), the Android APK (`cd.yml`), and the Expo web build to Vercel (`vercel.json`). Pushes to `dev` deploy a parallel dev stack (App Runner `bethere-api-dev` + Vercel preview); see `docs/runbook-deploy.md`.
- **Commit in modular chunks - IMPORTANT.** When a big task is underway, don't pile everything into one giant commit at the end. Commit each self-contained, working step as you go (one logical change per commit), so history stays bisectable and progress is never at risk. If you've completed a coherent unit of work, commit it.

Full model: `CONTRIBUTING.md`.

## Issue tracking - IMPORTANT

Track all work in Linear (team **DRP_02**) via the Linear MCP, religiously - it is the source of truth for what's in flight.

- **Before starting work**, find or create the issue; move it to **In Progress**.
- **While working**, log decisions and blockers as comments.
- **When done**, mark it **Done** and reference the commit/PR.
- Never leave finished work open, or in-flight work marked todo.

## Database & gotchas

- Drizzle schema: `apps/api/src/db/schema.ts`. Apply migrations with `pnpm --filter @bethere/api db:migrate`; the API also runs `migrate` + seed on boot (`SEED_ON_BOOT`: `reset` local default / `if-empty` live / `off`).
- **Migrations are hand-authored, not generated.** `drizzle-kit generate` is interactive and hangs in a non-TTY when it can't tell a rename from a create, so don't rely on `db:generate`: add a numbered SQL file under `apps/api/src/db/migrations/` plus a matching entry in `meta/_journal.json` by hand. If you reset the migration baseline, reset the local DB too (`docker compose down -v && pnpm db:up`).
- **Auth: real Clerk + a dev bypass.** The mobile client signs in with real Clerk Google OAuth and sends a bearer token; `createContext` (`apps/api/src/trpc.ts`) verifies it when `CLERK_JWT_KEY` is set, and `protectedProcedure` 401s unauthenticated callers. The live backend doesn't set `CLERK_JWT_KEY` yet, so with `DEV_AUTH_BYPASS=1` it still falls back to a spoofable `x-user-id` header (default `u_dev`) when no valid token is present (the mobile bypass button is opt-in via `EXPO_PUBLIC_DEV_AUTH=1`). The open CORS (`origin: true`) and the bypass are deliberate while the API stays open (see `docs/tech-debt.md`) - don't "fix" them as bugs. A global rate-limit (`@fastify/rate-limit`, keyed on client IP) guards against abuse while the API is open.

## Docs

Specs and plans: `docs/superpowers/`. Mockups: `docs/mockups/`. Session summaries: `docs/summary/`. Refactor reports: `docs/refactor/`. Deploy runbook: `docs/runbook-deploy.md`. Tech-debt register: `docs/tech-debt.md`. M4 deliverables: `docs/m4/`.

**Final presentation:** the deck + its export script and all supporting context live in `presentation/`. Decks are versioned in self-contained folders; the **current deck is `presentation/v4/`** (an HTML slide deck, `index.html` + `styles.css`, exported to a faithful PDF via `presentation/v4/export-pdf.sh`). `v0/`-`v3/` are frozen earlier snapshots (`v4/` was cloned from `v3/` and given a feedback pass). See `presentation/CLAUDE.md` before editing slides.

This repo uses knownissue (.knownissue/) — shared agent memory; hints tagged [knownissue] are repo-recorded suggestions.
