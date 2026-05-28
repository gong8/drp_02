# BeThere

A group meetup-coordination app: post a concrete meet (title, time, place) to a group, and everyone RSVPs **yes / no / "I'll go if [people]"**. A per-user dashboard groups events by Awaiting / Going / Declined. Built as a pnpm monorepo (Expo mobile + Fastify/tRPC backend).

## Structure

- `apps/mobile` - Expo / React Native client (TypeScript)
- `apps/api` - Fastify + tRPC backend
- `packages/shared` - shared Zod schemas and types
- `archive/` - earlier loose-availability prototype, kept for a later iteration

## Stack

Expo SDK 56 · React Navigation · tRPC · Zod · Drizzle ORM · Postgres · Fastify · pnpm

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

## Test & typecheck

```bash
pnpm lint           # biome check
pnpm typecheck      # typecheck across the workspace
pnpm test           # run tests across the workspace
```

## Docs

Specs and plans live in `docs/`; contributor and branching guidance in `CONTRIBUTING.md`.
