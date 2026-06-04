# BeThere

A group meetup-coordination app. A creator sends one plan to a group; the group publicly +1s candidate **times** and **activities** (no names shown - it's the group's), then the plan runs a blind timed **moment** where members RSVP **yes / no / "I'll go if [people]"**, and either clears (it's on) or quietly fizzles. A per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**, and groups support membership CRUD. Built as a pnpm monorepo: an Expo mobile client talking to a Fastify + tRPC backend over a shared, end-to-end-typed API.

## How a plan works

One create flow, one votable plan. The creator gives the plan an optional title, location, and two candidate lists - **times** (when) and **activities** (what/where) - either of which may be empty. They set two flags, both off by default:

- **lockTimes** - leave it off and members can add their own times; turn it on to fix the time list to vote-only.
- **lockThings** - leave it off and members can add their own activities; turn it on to fix the activity list to vote-only.

During **collecting**, members add to the open lists and tap **+1** on any candidate. Counts are public (momentum) but voter names are never shown. A "Decides by" deadline (editable, defaulting from the candidate spread) ends collecting: the most-voted time wins and - if no title was set - the most-voted activity becomes the title.

Shortcut: exactly one time with **lockTimes** on skips collecting and opens straight into the moment (this is the old "set a time" / exact plan). Once collecting ends (or instantly, for that shortcut) the plan runs a blind **moment**: members commit, nobody sees who else is in until it ends, and it clears if enough commit (or always, for the contingent-free shortcut) or silently fizzles. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full model.

## Structure

- `apps/mobile` - Expo / React Native client (TypeScript)
- `apps/api` - Fastify + tRPC backend (Drizzle + Postgres)
- `packages/shared` - shared Zod schemas and types (the single source of truth for the API contract)
- `archive/` - the original standalone loose-availability prototype, excluded from the build; its ideas were folded back into the current unified suggest flow

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
