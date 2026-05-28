# drp_02

A meetup-coordination app, built as a pnpm monorepo.

## Structure

- `apps/mobile` — Expo / React Native client (TypeScript)
- `apps/api` — Fastify + tRPC backend
- `packages/shared` — shared Zod schemas and types

## Stack

Expo SDK 56 · tRPC · Zod · Drizzle ORM · Postgres · Fastify · pnpm

## Prerequisites

- [Node.js](https://nodejs.org/) 20.x
- [pnpm](https://pnpm.io/) (via `corepack enable pnpm`)
- [Docker](https://www.docker.com/) (for local Postgres)
- [Expo Go](https://expo.dev/client) on your phone (for device preview)

## Setup

```bash
corepack enable pnpm
pnpm install
cp apps/api/.env.example apps/api/.env
```

## Running

```bash
pnpm db:up          # start local Postgres
pnpm dev:api        # start the Fastify + tRPC server (http://localhost:3000)
pnpm dev:mobile     # start the Expo dev server (scan QR with Expo Go)
```

## Testing & typechecking

```bash
pnpm test           # run tests across the workspace
pnpm typecheck      # typecheck across the workspace
```
