# CLAUDE.md

Persistent guidance for Claude Code in this repo. These cover things you can't infer from the code - follow them.

## Project

`drp_02` is **BeThere**, a group meetup-coordination app (Expo mobile + Fastify/tRPC backend). Model: a creator posts a **concrete event** (title, date, time, place) to a group; members RSVP **yes / no / "I'll go if [people]"**; a per-user dashboard groups events by **Awaiting / Going / Declined**, and groups support membership CRUD.

> An earlier **loose-availability** model (availability -> auto-match -> blind timed moment) is **archived in `archive/loose-availability/`**: excluded from the build, do not edit it, but it may be restored in a later iteration. Authoritative M2 design: `docs/mockups/m2/ALL_MOCKUPS.pdf`.

## Stack & layout

pnpm workspace monorepo. **Use `pnpm` only - never `npm` or `yarn`.** (`.npmrc` sets `node-linker=hoisted`, required by Expo/Metro.)

- `apps/mobile` - Expo SDK 56 React Native client (`@bethere/mobile`); navigation via `@react-navigation`
- `apps/api` - Fastify + tRPC server (`@bethere/api`)
- `packages/shared` - shared Zod schemas & types (`@bethere/shared`)

Stack: Expo · React Navigation · tRPC v11 · Zod · Drizzle ORM · Postgres · Fastify.

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
- **Auth is a dev stub:** `ctx.userId` comes from an optional `x-user-id` header (default `u_dev`) and is spoofable. The open/unauthenticated API + open CORS are deliberate (see `docs/tech-debt.md`) - don't "fix" them as bugs.

## Docs

Specs and plans: `docs/superpowers/`. Mockups: `docs/mockups/`. Session summaries: `docs/summary/`.
