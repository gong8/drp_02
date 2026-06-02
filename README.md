# BeThere

A group meetup-coordination app: a creator posts a concrete event (title, date, time, place) to a group, and members RSVP **yes / no / "I'll go if [people]"**. A per-user dashboard groups events by **Awaiting / Going / Declined**, and groups support membership CRUD. Built as a pnpm monorepo: an Expo mobile client talking to a Fastify + tRPC backend over a shared, end-to-end-typed API.

## Structure

- `apps/mobile` - Expo / React Native client (TypeScript)
- `apps/api` - Fastify + tRPC backend (Drizzle + Postgres)
- `packages/shared` - shared Zod schemas and types (the single source of truth for the API contract)
- `archive/` - earlier loose-availability prototype, excluded from the build, kept for a later iteration

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
