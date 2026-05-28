# pnpm Monorepo Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the single-package Expo app into a pnpm-workspace monorepo (`apps/mobile`, `apps/api`, `packages/shared`) with a wired but logic-free tRPC + Zod + Drizzle + Postgres + Fastify skeleton.

**Architecture:** pnpm workspaces. `apps/mobile` is the existing Expo app moved verbatim. `apps/api` is a Fastify server hosting a tRPC router that exposes a single `health` procedure and exports `type AppRouter`. `apps/mobile` imports that type (type-only) to build a fully-typed tRPC client, proving the end-to-end type chain. `packages/shared` is an empty Zod-schema barrel for future shared types.

**Tech Stack:** pnpm, TypeScript, Expo SDK 56, Fastify 5, tRPC 11, Zod, Drizzle ORM, Postgres (docker-compose), node-postgres (`pg`).

**Scope:** Skeleton only. No product/domain logic. The meetup product concept is background context, explicitly NOT implemented.

**Deviations from spec (intentional, lighter):**
- No `packages/tsconfig` package; a root `tsconfig.base.json` is extended via relative paths.
- Mobile uses vanilla `@trpc/client` for the type-chain proof; `@trpc/react-query`/`@tanstack/react-query` deferred to UI work.

**Verification note:** A skeleton has no business logic to unit-test. Verification is via `tsc --noEmit` typechecks (which prove the type chain), the existing mobile Jest test, and a manual `curl` smoke test of the `health` endpoint. No new test runner is added.

---

### Task 1: Root workspace wiring

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `.npmrc`
- Create: `tsconfig.base.json`
- Modify: `package.json` (root — replace contents)
- Modify: `.gitignore`

- [ ] **Step 1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 2: Create `.npmrc`**

Required so Expo/Metro resolves modules under pnpm (pnpm's default symlinked layout breaks Metro).

```ini
node-linker=hoisted
```

- [ ] **Step 3: Create `tsconfig.base.json`**

Shared base for the Node/TS packages (`api`, `shared`). The mobile app keeps extending `expo/tsconfig.base` separately.

```json
{
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "module": "ESNext",
    "target": "ES2022",
    "lib": ["ES2022"],
    "resolveJsonModule": true,
    "declaration": true,
    "noEmit": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Replace root `package.json`**

```json
{
  "name": "drp-monorepo",
  "version": "1.0.0",
  "private": true,
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "dev:mobile": "pnpm --filter @drp/mobile start",
    "dev:api": "pnpm --filter @drp/api dev",
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down"
  }
}
```

- [ ] **Step 5: Replace `.gitignore`**

```gitignore
node_modules/
.expo/
dist/
android/
ios/
.env
*.log
```

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml .npmrc tsconfig.base.json package.json .gitignore
git commit -m "chore: add pnpm workspace root configuration"
```

---

### Task 2: Move the Expo app into `apps/mobile`

**Files:**
- Move: `App.tsx`, `app.json`, `babel.config.js`, `tsconfig.json`, `__tests__/` → `apps/mobile/`
- Create: `apps/mobile/package.json` (written fresh; the original root `package.json` was replaced by the monorepo root in Task 1)

- [ ] **Step 1: Create the directory and move files with git**

Note: `package.json` is NOT moved here — Task 1 already turned the root `package.json` into the monorepo root. The mobile `package.json` is created fresh in Step 2.

```bash
mkdir -p apps/mobile
git mv App.tsx apps/mobile/App.tsx
git mv app.json apps/mobile/app.json
git mv babel.config.js apps/mobile/babel.config.js
git mv tsconfig.json apps/mobile/tsconfig.json
git mv __tests__ apps/mobile/__tests__
```

- [ ] **Step 2: Create `apps/mobile/package.json`**

Renames to `@drp/mobile`, adds a typecheck script, adds the workspace deps (`@drp/shared` for runtime, `@drp/api` type-only, `@trpc/client`). Dependency versions for react/expo/etc. are unchanged from the SDK 56 upgrade.

```json
{
  "name": "@drp/mobile",
  "version": "1.0.0",
  "main": "expo/AppEntry",
  "scripts": {
    "start": "expo start",
    "android": "expo start --android",
    "ios": "expo start --ios",
    "test": "jest --watchAll=false",
    "typecheck": "tsc --noEmit"
  },
  "jest": {
    "preset": "jest-expo"
  },
  "dependencies": {
    "@drp/shared": "workspace:*",
    "@trpc/client": "^11.0.0",
    "expo": "~56.0.6",
    "expo-status-bar": "~56.0.4",
    "react": "19.2.3",
    "react-native": "0.85.3"
  },
  "devDependencies": {
    "@babel/core": "^7.29.7",
    "@drp/api": "workspace:*",
    "@types/jest": "^29.5.14",
    "@types/react": "~19.2.15",
    "jest": "~29.7.0",
    "jest-expo": "~56.0.4",
    "typescript": "~6.0.3"
  },
  "private": true
}
```

- [ ] **Step 3: Delete the stale npm lockfile (pnpm regenerates it in Task 6)**

```bash
git rm package-lock.json
```

- [ ] **Step 4: Verify `apps/mobile/tsconfig.json` is unchanged and correct**

It must still read (moved verbatim from root):

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "types": ["jest"]
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move Expo app into apps/mobile"
```

---

### Task 3: Scaffold `packages/shared`

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `packages/shared/package.json`**

```json
{
  "name": "@drp/shared",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "~6.0.3"
  }
}
```

- [ ] **Step 2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/shared/src/index.ts`**

Empty barrel — Zod domain schemas go here later. The export keeps it a valid module.

```ts
// Shared Zod schemas and inferred types live here.
// Intentionally empty in the skeleton.
export {};
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared
git commit -m "feat: scaffold @drp/shared package"
```

---

### Task 4: Scaffold `apps/api` (Fastify + tRPC + Drizzle, health ping only)

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/.env.example`
- Create: `apps/api/src/trpc.ts`
- Create: `apps/api/src/router.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/db/schema.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/db/migrations/.gitkeep`
- Create: `apps/api/src/routers/.gitkeep`

- [ ] **Step 1: Create `apps/api/package.json`**

```json
{
  "name": "@drp/api",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/router.ts",
  "exports": {
    ".": {
      "types": "./src/router.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate"
  },
  "dependencies": {
    "@drp/shared": "workspace:*",
    "@fastify/cors": "^10.0.1",
    "@trpc/server": "^11.0.0",
    "drizzle-orm": "^0.38.3",
    "fastify": "^5.2.0",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/pg": "^8.11.10",
    "drizzle-kit": "^0.30.1",
    "tsx": "^4.19.2",
    "typescript": "~6.0.3"
  }
}
```

- [ ] **Step 2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Create `apps/api/src/trpc.ts`**

```ts
import { initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

export function createContext(_opts: CreateFastifyContextOptions) {
  return {};
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
```

- [ ] **Step 4: Create `apps/api/src/router.ts`**

The single behavioral piece of the skeleton: a `health` query. Exports `type AppRouter` for the mobile client.

```ts
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Create `apps/api/src/index.ts`**

```ts
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import cors from "@fastify/cors";
import Fastify from "fastify";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });
await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

const port = Number(process.env.PORT ?? 3000);

server.listen({ port, host: "0.0.0.0" }).catch((err) => {
  server.log.error(err);
  process.exit(1);
});
```

- [ ] **Step 6: Create `apps/api/src/db/schema.ts`**

Empty Drizzle schema — tables added later. Empty is valid for drizzle-kit (produces no migration).

```ts
// Drizzle table definitions live here.
// Intentionally empty in the skeleton.
export {};
```

- [ ] **Step 7: Create `apps/api/src/db/client.ts`**

The Drizzle client. Not imported by the router, so the server starts without a live database (Pool connects lazily on first query).

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const db = drizzle(pool, { schema });
```

- [ ] **Step 8: Create `apps/api/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://drp:drp@localhost:5432/drp",
  },
});
```

- [ ] **Step 9: Create `apps/api/.env.example`**

```ini
DATABASE_URL=postgres://drp:drp@localhost:5432/drp
PORT=3000
```

- [ ] **Step 10: Create empty-directory placeholders**

```bash
mkdir -p apps/api/src/db/migrations apps/api/src/routers
touch apps/api/src/db/migrations/.gitkeep apps/api/src/routers/.gitkeep
```

- [ ] **Step 11: Commit**

```bash
git add apps/api
git commit -m "feat: scaffold @drp/api with Fastify + tRPC health route"
```

---

### Task 5: Local Postgres via docker-compose

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: drp
      POSTGRES_PASSWORD: drp
      POSTGRES_DB: drp
    ports:
      - "5432:5432"
    volumes:
      - drp_pgdata:/var/lib/postgresql/data

volumes:
  drp_pgdata:
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add local Postgres docker-compose"
```

---

### Task 6: Install dependencies and generate the pnpm lockfile

**Files:**
- Create: `pnpm-lock.yaml` (generated)

- [ ] **Step 1: Enable pnpm via corepack**

```bash
corepack enable pnpm
```

- [ ] **Step 2: Install the whole workspace**

Run: `pnpm install`
Expected: completes without error; creates `pnpm-lock.yaml`; links `@drp/shared` and `@drp/api` into `apps/mobile/node_modules/@drp/*` (workspace symlinks).

- [ ] **Step 3: Verify workspace links resolved**

Run: `pnpm ls --filter @drp/mobile --depth -1`
Expected: lists `@drp/mobile` with `@drp/shared` and `@drp/api` shown as `link:` workspace deps.

- [ ] **Step 4: Commit**

```bash
git add pnpm-lock.yaml
git commit -m "chore: generate pnpm lockfile for workspace"
```

---

### Task 7: Prove the type chain from the mobile client

**Files:**
- Create: `apps/mobile/src/lib/trpc.ts`

- [ ] **Step 1: Create `apps/mobile/src/lib/trpc.ts`**

Type-only import of `AppRouter` builds a fully-typed client. This file is the proof the chain resolves; it is not yet wired into `App.tsx` (kept light). Because the import is type-only, Metro never bundles the server code.

```ts
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@drp/api";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({ url: "http://localhost:3000/trpc" }),
  ],
});

// Type-chain proof: `health` is known and typed as () => Promise<{ ok: true }>.
export type HealthResult = Awaited<ReturnType<typeof trpc.health.query>>;
```

- [ ] **Step 2: Typecheck the mobile app**

Run: `pnpm --filter @drp/mobile typecheck`
Expected: PASS (exit 0). If `AppRouter` or `trpc.health` were not resolvable, this fails — proving the chain when it passes.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/lib/trpc.ts
git commit -m "feat: typed tRPC client in mobile proving end-to-end type chain"
```

---

### Task 8: Update CI/CD workflows for pnpm + new paths

**Files:**
- Modify: `.github/workflows/node.js.yml`
- Modify: `.github/workflows/cd.yml`

- [ ] **Step 1: Replace `.github/workflows/node.js.yml`**

```yaml
name: Node.js CI

on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["main"]

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [20.x]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - name: Use Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r --if-present typecheck
      - run: pnpm -r --if-present test
```

- [ ] **Step 2: Replace `.github/workflows/cd.yml`**

Android build now runs with `apps/mobile` as the working directory; artifact path shifts accordingly.

```yaml
name: Android CD

on:
  workflow_run:
    workflows: ["Node.js CI"]
    types: [completed]
    branches: [main]

env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true

jobs:
  build-apk:
    runs-on: ubuntu-latest
    if: github.event.workflow_run.conclusion == 'success'
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: "pnpm"

      - run: pnpm install --frozen-lockfile

      - uses: actions/setup-java@v4
        with:
          java-version: "17"
          distribution: "temurin"

      - name: Generate native Android project
        working-directory: apps/mobile
        run: pnpm exec expo prebuild --platform android --no-install

      - name: Build debug APK
        working-directory: apps/mobile
        run: |
          chmod +x android/gradlew
          cd android && ./gradlew assembleDebug -PbundleInDebug=true

      - uses: actions/upload-artifact@v4
        with:
          name: app-debug
          path: apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
          retention-days: 30
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/node.js.yml .github/workflows/cd.yml
git commit -m "ci: switch workflows to pnpm and monorepo paths"
```

---

### Task 9: Update README for the monorepo

**Files:**
- Modify: `README.md` (replace contents)

- [ ] **Step 1: Replace `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README for monorepo structure"
```

---

### Task 10: Full verification

No files changed — this task confirms the skeleton works end to end.

- [ ] **Step 1: Clean install from the lockfile**

Run: `pnpm install --frozen-lockfile`
Expected: completes with no lockfile changes.

- [ ] **Step 2: Typecheck the whole workspace**

Run: `pnpm typecheck`
Expected: `@drp/mobile`, `@drp/api`, `@drp/shared` all PASS (exit 0). This is the primary proof of the type chain.

- [ ] **Step 3: Run the mobile test**

Run: `pnpm --filter @drp/mobile test`
Expected: 1 test passes (the existing `passes` test).

- [ ] **Step 4: Smoke-test the API health route**

The server starts without Postgres (health does not touch the DB).

```bash
pnpm dev:api &
sleep 3
curl -s http://localhost:3000/trpc/health
kill %1
```

Expected output (tRPC envelope):

```json
{"result":{"data":{"ok":true}}}
```

- [ ] **Step 5: Final confirmation commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore: verification fixes for monorepo skeleton" || echo "nothing to commit"
```
```
