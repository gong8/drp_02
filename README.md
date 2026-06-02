# BeThere

A group meetup-coordination app. A creator floats one plan to a group and chooses only how precisely to pin the time; the plan then converges on a blind timed **moment** where members RSVP **yes / no / "I'll go if [people]"**, and either clears (it's on) or quietly fizzles. A per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**, and groups support membership CRUD. Built as a pnpm monorepo: an Expo mobile client talking to a Fastify + tRPC backend over a shared, end-to-end-typed API.

## How a plan works

The only choice the creator makes is how precisely to pin the time:

- **Set a time** (exact) - it's happening; opens straight into the moment and always clears.
- **A few options** - a short menu of times; members react ("works for me"), the creator locks the best-supported slot.
- **Whenever suits** (fuzzy) - a loose window expanded into day candidates; members react, then the creator locks a slot.

Once a slot is locked (or instantly, for an exact time) the plan runs a blind **moment**: members commit, nobody sees who else is in until it ends, and it clears if enough commit (or always, for an exact plan) or silently fizzles. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full model.

## Structure

- `apps/mobile` - Expo / React Native client (TypeScript)
- `apps/api` - Fastify + tRPC backend (Drizzle + Postgres)
- `packages/shared` - shared Zod schemas and types (the single source of truth for the API contract)
- `archive/` - the original standalone loose-availability prototype, excluded from the build; its ideas were folded back into the current convergence model

## Stack

Expo SDK 54 · React Navigation · tRPC v11 · Zod · Drizzle ORM · Postgres · Fastify · Clerk · pnpm

## Prerequisites

- [Node.js](https://nodejs.org/) 20.x
- [pnpm](https://pnpm.io/) (via `corepack enable pnpm`)
- [Docker](https://www.docker.com/) (for local Postgres)
- [Expo Go](https://expo.dev/client) on your phone, for device preview. Use the current App Store build, which must match SDK 54.

## Setup

```bash
corepack enable pnpm
pnpm install
cp apps/api/.env.example apps/api/.env
```

The defaults in `.env.example` run the API fully locally: a Dockerized Postgres and a spoofable dev user (`DEV_AUTH_BYPASS=1`), so no Clerk keys are needed for local development.

## Running

```bash
pnpm db:up          # start local Postgres (host port 5433)
pnpm dev:api        # start the Fastify + tRPC server (http://localhost:3000); reseeds demo data on boot
pnpm dev:mobile     # start the Expo dev server (scan the QR with Expo Go)
```

## Test & typecheck

```bash
pnpm lint           # biome check (pnpm format to auto-fix)
pnpm typecheck      # typecheck across the workspace
pnpm test           # run tests across the workspace
pnpm check          # all of the above in one go
```

Run `pnpm check` before opening any PR.

## Docs

- Branching and contribution workflow: [`CONTRIBUTING.md`](CONTRIBUTING.md)
- Specs, plans, mockups, and runbooks: [`docs/`](docs/)
- Guidance for AI coding agents in this repo: [`CLAUDE.md`](CLAUDE.md)
</content>
</invoke>
