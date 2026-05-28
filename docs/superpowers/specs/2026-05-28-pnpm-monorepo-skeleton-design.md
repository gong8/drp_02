# pnpm Monorepo Skeleton — Design

**Date:** 2026-05-28
**Status:** Approved (design), pending implementation plan

## Goal

Restructure the existing single-package Expo app into a **pnpm-workspace monorepo**
containing a mobile client, a backend API, and shared packages. Deliver a **super-light
skeleton only**: directory structure plus minimal wiring, with **no domain/product logic**.

The product concept (a meetup-coordination app) is **background context only** and is
explicitly out of scope for this work. No availability, group, proposal, or response logic
is to be implemented.

## Stack (decided)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Mobile | Expo / React Native (existing, SDK 56) + `@trpc/react-query` | Already built; moved into the workspace |
| API transport | **tRPC** | Maximum end-to-end type safety with a single first-party TS client; no hand-maintained API types |
| API host | **Fastify** | Most canonical, stable tRPC host; most reliable for a mostly-Claude-coded project; real-time not needed (push-based, blind-response design) |
| Validation | **Zod** (shared) | Runtime + static safety at the network boundary; schemas shared by both ends |
| ORM | **Drizzle** | Code-first TS schema; row types flow through tRPC to the client with no codegen; thin "own your SQL" layer |
| Database | **Postgres**, self-hosted via `docker-compose` | User wants their own database, not a managed service (Supabase) |
| Monorepo | **pnpm workspaces** | Standard, efficient; workspace management for shared packages |

## Directory layout

```
drp_02/
├── apps/
│   ├── mobile/              # existing Expo app, moved here verbatim (@drp/mobile)
│   │   ├── App.tsx, app.json, babel.config.js, tsconfig.json
│   │   ├── __tests__/
│   │   └── package.json     # deps: @drp/shared; type-only dep: @drp/api
│   └── api/                 # @drp/api — Fastify + tRPC
│       ├── src/
│       │   ├── index.ts             # Fastify bootstrap (stub)
│       │   ├── trpc.ts              # tRPC init: context + base procedure (stub)
│       │   ├── router.ts            # appRouter; exports `type AppRouter`; one health ping
│       │   ├── routers/             # empty — domain routers added later
│       │   └── db/
│       │       ├── client.ts        # drizzle client (stub)
│       │       ├── schema.ts        # Drizzle schema (empty)
│       │       └── migrations/      # empty (drizzle-kit output)
│       ├── drizzle.config.ts
│       ├── tsconfig.json
│       └── package.json
├── packages/
│   ├── shared/              # @drp/shared — Zod schemas + inferred types (empty barrel)
│   │   ├── src/index.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── tsconfig/            # @drp/tsconfig — shared base tsconfigs
│       ├── base.json
│       └── package.json
├── pnpm-workspace.yaml      # packages: apps/*, packages/*
├── package.json            # root, private, workspace scripts only
├── tsconfig.base.json
├── .npmrc                  # node-linker=hoisted (REQUIRED for Expo/Metro + pnpm)
├── docker-compose.yml      # local Postgres
└── .github/workflows/      # updated for new paths
```

## Type-chain design (the core reason for this stack)

1. `packages/shared` defines Zod schemas → inferred TS types.
2. `apps/api` builds the tRPC router using those schemas and exports `type AppRouter`.
3. `apps/mobile` imports `type AppRouter` (type-only workspace dependency) to construct a
   fully-typed tRPC client.

Result: an unbroken type chain from Postgres column (Drizzle) through the API (tRPC + Zod)
to the React Native component. No codegen, no hand-synced types.

## Key decisions

- **Both `apps/` and `packages/`.** `apps/{mobile,api}` are deployables; `packages/{shared,tsconfig}`
  are libraries. This is the standard split and resolves the earlier "apps vs packages" question — it is both.
- **`.npmrc` with `node-linker=hoisted`.** Required so Expo/Metro resolves modules under pnpm
  (pnpm's default symlinked layout breaks Metro).
- **No Turborepo.** Plain pnpm workspace scripts to stay light; can be added later if builds slow.
- **Super-light stubs.** Config files are wired enough that `pnpm install` succeeds and the type
  chain resolves; the only behavioral code is a single `health` tRPC procedure to prove the
  wiring end-to-end. All other source files are empty barrels / TODO stubs. No domain logic.
- **npm → pnpm.** Replace `package-lock.json` with `pnpm-lock.yaml`. (npm was chosen earlier only
  to resolve a lock conflict; this supersedes that decision now that we are going monorepo.)

## CI/CD impact

Both existing workflows assume the app is at the repo root and use npm; both must be updated:

- `node.js.yml` (Node CI): switch to pnpm (`pnpm/action-setup`, `pnpm install --frozen-lockfile`),
  run against the workspace; point test/typecheck at `apps/mobile` (and `apps/api` once it exists).
- `cd.yml` (Android CD): `expo prebuild` / Gradle steps must run with `apps/mobile` as the working
  directory; artifact paths shift to `apps/mobile/android/...`.

The `--legacy-peer-deps` flag is dropped (the SDK 56 upgrade already resolved the peer conflict).

## Documentation

- Update the root `README.md` for the new monorepo: pnpm prerequisite, `pnpm install` at root,
  per-app run/test commands (`apps/mobile`, `apps/api`), and local Postgres via `docker-compose`.

## Out of scope

- Any product/domain logic (availability, groups, proposals, responses, push, AI suggestions).
- Authentication, deployment infrastructure beyond local `docker-compose`.
- Turborepo / build caching.
- Web client.

## Success criteria

- `pnpm install` succeeds at the repo root.
- The Expo app still runs from `apps/mobile` and its existing test passes.
- `apps/api` type-checks and the mobile client can import `type AppRouter` with the `health`
  procedure visible/typed (proving the chain).
- CI/CD workflows are updated to the new paths and pnpm.
