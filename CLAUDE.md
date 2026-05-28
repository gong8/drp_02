# CLAUDE.md

Persistent guidance for Claude Code in this repo. These cover things you can't infer from the code - follow them.

## Project

`drp_02` - a group meetup-coordination app (mobile + backend). It is currently a **skeleton**: the monorepo and the end-to-end type chain are wired, but there is **no product/domain logic yet**. Build only what's asked - don't scaffold speculative features.

## Stack & layout

pnpm workspace monorepo. **Use `pnpm` only - never `npm` or `yarn`.** (`.npmrc` sets `node-linker=hoisted`, which Expo/Metro requires.)

- `apps/mobile` - Expo SDK 56 React Native client (`@bethere/mobile`)
- `apps/api` - Fastify + tRPC server (`@bethere/api`)
- `packages/shared` - shared Zod schemas & types (`@bethere/shared`)

Stack: Expo · tRPC v11 · Zod · Drizzle ORM · Postgres · Fastify.

## Commands

```bash
pnpm install                     # install workspace
pnpm typecheck                   # tsc --noEmit, all packages
pnpm test                        # tests, all packages
pnpm dev:api                     # API at http://localhost:3000
pnpm dev:mobile                  # Expo dev server
pnpm db:up / pnpm db:down        # local Postgres (docker-compose)
pnpm --filter @bethere/api <script>  # run a script in one package
```

Run `pnpm typecheck` and `pnpm test` before opening any PR.

## Branching - IMPORTANT

`main` is production and protected. **Never push to `main`, and never open a PR from a feature branch into `main`.**

- **Default: work directly on `dev`.** For routine changes, bug fixes, and incremental work, commit straight to `dev` - no feature branch needed.
- **Only branch (`feat/*` → PR into `dev`) for a massive feature** - something large, risky, or worth isolating/reviewing on its own.
- To ship: PR `dev` → `main` (the only branch permitted to merge into `main`).
- CI runs on PRs into `main`; CD (Android build) runs on push to `main`.

Full model: `CONTRIBUTING.md`.

## Issue tracking - IMPORTANT

Track all work in Linear via the Linear MCP, religiously. Keep it current - it is the source of truth for what's in flight.

- **Before starting work**, find or create the Linear issue for it; move it to **In Progress**.
- **While working**, log meaningful progress, decisions, and blockers as comments on the issue.
- **When done**, mark the issue **Done** and reference the commit/PR.
- If the user asks for something not yet tracked, create the issue first, then do the work.
- Keep issue status in sync with reality at all times - never leave finished work marked open or in-flight work marked todo.

## Conventions

- **Type chain - don't hand-write API types.** Define shapes as Zod schemas in `packages/shared`, expose tRPC procedures in `apps/api/src/router.ts` (+ `routers/`); the mobile client's types follow automatically.
- `apps/api` is ESM (`"type": "module"`) - relative imports need `.js` extensions.
- `apps/mobile` imports `@bethere/api` **type-only** (`import type { AppRouter }`) so Metro never bundles server code.
- Drizzle schema: `apps/api/src/db/schema.ts`; migrate via `pnpm --filter @bethere/api db:generate` / `db:migrate`.

## Design docs

Specs and implementation plans: `docs/superpowers/`.
```
