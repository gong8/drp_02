# CLAUDE.md

Persistent guidance for Claude Code in this repo. These cover things you can't infer from the code - follow them.

## Project

`drp_02` is **BeThere**, a group meetup-coordination app (Expo mobile + Fastify/tRPC backend). The current model is the **convergence model** (M3, merged to `dev` via DRP-29): a creator floats one plan to a group and the only fork they choose is how precisely to pin the time (`whenMode`):

- **exact** - a fixed time; skips collecting, opens straight into a blind timed **moment**, always happens.
- **options** - a short menu of fixed times; members react ("works for me"), best-supported wins.
- **fuzzy** - a loose window (timescale + part-of-day band) expanded into day candidates members react to.

Everything after the `when` is shared: a plan moves `collecting -> moment -> cleared` (or a silent `fizzled`); during the moment members RSVP **yes / no / "I'll go if [people]"** (conditionals resolved server-side); a per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**; groups support membership CRUD. Full design: `ARCHITECTURE.md`.

> The original standalone **loose-availability** prototype still lives in `archive/loose-availability/` (excluded from the build, do not edit it); its ideas were folded back into the convergence model. M2 concrete-event mockups: `docs/mockups/m2/ALL_MOCKUPS.pdf`.

## Stack & layout

pnpm workspace monorepo. **Use `pnpm` only - never `npm` or `yarn`.** (`.npmrc` sets `node-linker=hoisted`, required by Expo/Metro.)

- `apps/mobile` - Expo SDK 54 React Native client (`@bethere/mobile`); navigation via `@react-navigation`
- `apps/api` - Fastify + tRPC server (`@bethere/api`)
- `packages/shared` - shared Zod schemas & types (`@bethere/shared`)

Stack: Expo · React Navigation · tRPC v11 · Zod · Drizzle ORM · Postgres · Fastify.

> **Do NOT upgrade the Expo SDK above 54.** The team tests on the App Store build of Expo Go, which only runs the latest SDK *it* shipped with (currently SDK 54). Pinning higher (we tried 56, then 55) makes Expo Go reject the project with "requires a newer version of Expo Go" - there is no newer Expo Go to install; the store build simply lags new SDK releases. Stay on SDK 54 until the team's installed Expo Go actually advances, then bump to match it (never ahead). The real long-term fix is a dev build (`expo-dev-client`), which removes this constraint - do that before bumping the SDK. When changing the SDK, use `npx expo install --fix` to align `react-native`/`react`/native modules; note pre-SDK-55 packages like `expo-status-bar` use their own version line (e.g. `~3.0.9`), not the SDK number. Entry point is `apps/mobile/index.ts` (`main: "index.ts"`), not `expo/AppEntry` - the latter's relative `../../App` import breaks under pnpm's hoisted node_modules.

## Commands

```bash
pnpm install                     # install workspace
pnpm lint                        # biome check (use `pnpm format` to auto-fix)
pnpm typecheck                   # tsc --noEmit, all packages
pnpm test                        # tests, all packages
pnpm dev:api                     # API at http://localhost:3000
pnpm dev:mobile                  # Expo dev server
pnpm db:up / pnpm db:down        # local Postgres (docker compose, host port 5433)
pnpm --filter @bethere/api <script>  # run a script in one package
```

Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening any PR.

## Conventions - IMPORTANT

- **No em dashes anywhere** (code, docs, comments) - use hyphens.
- **Type chain:** define data shapes as Zod schemas in `packages/shared`, expose tRPC procedures in `apps/api/src/router.ts` (+ `routers/`); the mobile client's types follow automatically. Don't hand-write API types.
- `apps/api` is ESM (`"type": "module"`) - relative imports need `.js` extensions.
- `apps/mobile` imports `@bethere/api` **type-only** (`import type { AppRouter }`) so Metro never bundles server code.

## Branching - IMPORTANT

`main` is production and protected. **Never push to `main`, and never open a PR from a feature branch into `main`.**

- **Default: work directly on `dev`** - commit routine work straight to `dev`, no feature branch.
- **Only branch (`feat/*` → PR into `dev`) for a massive feature** worth isolating.
- To ship: PR `dev` → `main` (the only branch permitted to merge into `main`).
- CI runs on PRs into `main`; CD (backend deploy + Android build) runs on push to `main`.
- **Commit in modular chunks - IMPORTANT.** When a big task is underway, don't pile everything into one giant commit at the end. Commit each self-contained, working step as you go (one logical change per commit), so history stays bisectable and progress is never at risk. If you've completed a coherent unit of work, commit it.

Full model: `CONTRIBUTING.md`.

## Issue tracking - IMPORTANT

Track all work in Linear (team **DRP_02**) via the Linear MCP, religiously - it is the source of truth for what's in flight.

- **Before starting work**, find or create the issue; move it to **In Progress**.
- **While working**, log decisions and blockers as comments.
- **When done**, mark it **Done** and reference the commit/PR.
- Never leave finished work open, or in-flight work marked todo.

## Database & gotchas

- Drizzle schema: `apps/api/src/db/schema.ts`. Generate/apply: `pnpm --filter @bethere/api db:generate` / `db:migrate`. The API also runs `migrate` + seed on boot (`SEED_ON_BOOT`: `reset` local default / `if-empty` live / `off`).
- **`drizzle-kit generate` is interactive** and hangs in a non-TTY when it can't tell a rename from a create. If you reset the migration baseline, reset the local DB too (`docker compose down -v && pnpm db:up`).
- **Auth: Clerk + a dev bypass.** `createContext` (`apps/api/src/trpc.ts`) verifies a Clerk bearer token when `CLERK_JWT_KEY` is set; `protectedProcedure` 401s unauthenticated callers. For local dev and M2 prod, `DEV_AUTH_BYPASS=1` falls back to a spoofable `x-user-id` header (default `u_dev`) when no valid token is present. The open CORS (`origin: true`) and the bypass are deliberate for M2 (see `docs/tech-debt.md`) - don't "fix" them as bugs. A global rate-limit (`@fastify/rate-limit`, keyed on client IP) is the guard against abuse while the API is open.

## Docs

Specs and plans: `docs/superpowers/`. Mockups: `docs/mockups/`. Session summaries: `docs/summary/`.
