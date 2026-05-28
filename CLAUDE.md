# CLAUDE.md

Persistent guidance for Claude Code in this repo. These cover things you can't infer from the code — follow them.

## Project

`drp_02` — a group meetup-coordination app (mobile + backend). It is currently a **skeleton**: the monorepo and the end-to-end type chain are wired, but there is **no product/domain logic yet**. Build only what's asked — don't scaffold speculative features.

## Stack & layout

pnpm workspace monorepo. **Use `pnpm` only — never `npm` or `yarn`.** (`.npmrc` sets `node-linker=hoisted`, which Expo/Metro requires.)

- `apps/mobile` — Expo SDK 56 React Native client (`@drp/mobile`)
- `apps/api` — Fastify + tRPC server (`@drp/api`)
- `packages/shared` — shared Zod schemas & types (`@drp/shared`)

Stack: Expo · tRPC v11 · Zod · Drizzle ORM · Postgres · Fastify.

## Commands

```bash
pnpm install                     # install workspace
pnpm typecheck                   # tsc --noEmit, all packages
pnpm test                        # tests, all packages
pnpm dev:api                     # API at http://localhost:3000
pnpm dev:mobile                  # Expo dev server
pnpm db:up / pnpm db:down        # local Postgres (docker-compose)
pnpm --filter @drp/api <script>  # run a script in one package
```

Run `pnpm typecheck` and `pnpm test` before opening any PR.

## Branching — IMPORTANT

`main` is production and protected. **Never push to `main`, and never open a PR from a feature branch into `main`.**

- Branch off `dev`; do work on `feat/*`; PR into `dev`.
- To ship: PR `dev` → `main` (the only branch permitted to merge into `main`).
- CI runs on PRs into `main`; CD (Android build) runs on push to `main`.

Full model: `CONTRIBUTING.md`.

## Conventions

- **Type chain — don't hand-write API types.** Define shapes as Zod schemas in `packages/shared`, expose tRPC procedures in `apps/api/src/router.ts` (+ `routers/`); the mobile client's types follow automatically.
- `apps/api` is ESM (`"type": "module"`) — relative imports need `.js` extensions.
- `apps/mobile` imports `@drp/api` **type-only** (`import type { AppRouter }`) so Metro never bundles server code.
- Drizzle schema: `apps/api/src/db/schema.ts`; migrate via `pnpm --filter @drp/api db:generate` / `db:migrate`.

## Design docs

Specs and implementation plans: `docs/superpowers/`.
```
