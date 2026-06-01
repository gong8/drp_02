# Clerk Auth + Web Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Clerk (Google OAuth) authentication and a Vercel-hostable web build to BeThere from one Expo codebase, with a dev-bypass that signs in as seed user `u_dev`.

**Architecture:** One Expo app renders the same screens on native and web (react-native-web). Clerk handles sign-in on both targets via `@clerk/clerk-expo`. The Fastify/tRPC API verifies Clerk session tokens networklessly (`@clerk/backend`), resolving a nullable `userId`; a `protectedProcedure` enforces auth while `health` stays public. When `DEV_AUTH_BYPASS` is set and no token is present, the API falls back to the existing `x-user-id` stub, which is what the APK's dev-bypass button uses.

**Tech Stack:** Expo SDK 56, react-native-web, React Navigation, tRPC v11, Drizzle/Postgres, Fastify, `@clerk/clerk-expo`, `@clerk/backend`. Node `node:test` via `tsx` for API tests; jest-expo for the one client unit test.

**Spec:** `docs/superpowers/specs/2026-06-01-clerk-auth-and-web-target-design.md`

**Design deltas from the spec (intentional):**
- Auth is enforced via a `protectedProcedure`, not by throwing inside `createContext` (keeps `/trpc/health` public for App Runner's health check).
- No `App.web.tsx`; a single `App.tsx` applies the web max-width shell with `Platform.OS === 'web'` (fewer files, more in sync).
- API tests use `node:test` run through `tsx` (no vitest; avoids Vite resolving `.js` import specifiers to `.ts`).

---

## File map

**Backend (`apps/api`)**
- Modify `src/db/schema.ts` - add nullable `email` to `users`.
- Create `src/db/migrations/XXXX_*.sql` - generated.
- Create `src/auth/resolve.ts` - pure auth-decision logic (verify injected).
- Create `src/auth/resolve.test.ts` - `node:test` unit tests.
- Create `src/auth/clerk.ts` - `@clerk/backend` verify wrapper (IO).
- Create `src/db/users.ts` - `upsertUser` helper.
- Modify `src/trpc.ts` - async `createContext`, `protectedProcedure`, logging null-safe.
- Modify `src/routers/events.ts`, `src/routers/groups.ts` - use `protectedProcedure`.
- Modify `package.json` - add `@clerk/backend`, add `test` script.
- Modify `.env.example` / docs - new env vars.

**Client (`apps/mobile`)**
- Modify `package.json` - add Clerk + web deps (via `expo install`).
- Modify `app.json` - add `web` platform + `scheme`.
- Create `src/lib/auth.ts` - token holder, `buildAuthHeaders`, `DevAuthProvider`, `AuthBridge`.
- Create `src/lib/auth.test.ts`? No - client test lives in `__tests__` (jest). Create `__tests__/buildAuthHeaders.test.ts`.
- Create `src/lib/clerk.ts` - `tokenCache` + publishable key.
- Modify `src/lib/trpc.ts` - inject headers from the holder.
- Create `src/screens/SignIn.tsx` - Google button + flag-gated dev button.
- Create `src/components/AccountButton.tsx` - sign-out control.
- Modify `App.tsx` - ClerkProvider + gate + web shell + header sign-out.
- Add `build:web` script + `vercel.json`.

**CD / ops**
- Modify `.github/workflows/cd.yml` - bake Clerk publishable key + `EXPO_PUBLIC_DEV_AUTH=1`.
- Manual checklist (Clerk dashboard, GitHub secret, Vercel project, App Runner env).

---

## Task B1: Add backend Clerk dependency and test script

**Files:**
- Modify: `apps/api/package.json`

- [ ] **Step 1: Add the dependency**

Run from repo root:

```bash
pnpm --filter @bethere/api add @clerk/backend
```

- [ ] **Step 2: Add a `test` script using node:test via tsx**

In `apps/api/package.json`, add to `"scripts"` (after `"start"`):

```json
    "test": "node --import tsx --test src/**/*.test.ts",
```

If your shell/node does not expand the `src/**/*.test.ts` glob, this still works on Node 20+ which expands `--test` globs internally. Verify in Step 3.

- [ ] **Step 3: Verify the script runs (no tests yet = exit 0)**

Run:

```bash
pnpm --filter @bethere/api test
```

Expected: completes with "tests 0" / no failures (exit 0). If it errors that no files matched, change the script to `"node --import tsx --test"` and re-run; we add explicit files next task regardless.

- [ ] **Step 4: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add @clerk/backend and node:test runner"
```

---

## Task B2: Add `email` column to users

**Files:**
- Modify: `apps/api/src/db/schema.ts:6-10`
- Create: `apps/api/src/db/migrations/<generated>.sql`

- [ ] **Step 1: Add the column**

In `apps/api/src/db/schema.ts`, change the `users` table to:

```ts
export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatarColor: text("avatar_color").notNull(),
  email: text("email"),
});
```

- [ ] **Step 2: Generate the migration**

Run:

```bash
pnpm --filter @bethere/api db:generate
```

Expected: a new file under `apps/api/src/db/migrations/` adding the `email` column. `drizzle-kit generate` for a pure column-add is non-interactive (it only prompts on ambiguous renames), so it will not hang.

- [ ] **Step 3: Apply locally to confirm it is valid**

Ensure local DB is up (`pnpm db:up`), then:

```bash
pnpm --filter @bethere/api db:migrate
```

Expected: migration applies cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations
git commit -m "feat(api): add nullable email column to users"
```

---

## Task B3: Pure auth-resolution logic (TDD)

This module decides `userId` from request inputs with the `verify` function injected, so it is testable with no Clerk and no DB.

**Files:**
- Create: `apps/api/src/auth/resolve.ts`
- Create: `apps/api/src/auth/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/auth/resolve.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveAuth, type VerifiedClaims } from "./resolve.js";

const okVerify = async (token: string): Promise<VerifiedClaims> => {
  if (token === "good") return { sub: "user_123", name: "Ada", email: "ada@x.com" };
  throw new Error("bad token");
};

test("bearer token resolves to its sub and claims", async () => {
  const r = await resolveAuth(
    { authHeader: "Bearer good", userIdHeader: undefined, devBypass: false },
    okVerify,
  );
  assert.equal(r.userId, "user_123");
  assert.equal(r.claims?.email, "ada@x.com");
});

test("invalid bearer token resolves to null (unauthenticated)", async () => {
  const r = await resolveAuth(
    { authHeader: "Bearer nope", userIdHeader: undefined, devBypass: false },
    okVerify,
  );
  assert.equal(r.userId, null);
  assert.equal(r.claims, null);
});

test("dev bypass with no token uses x-user-id header", async () => {
  const r = await resolveAuth(
    { authHeader: undefined, userIdHeader: "u_lily", devBypass: true },
    okVerify,
  );
  assert.equal(r.userId, "u_lily");
  assert.equal(r.claims, null);
});

test("dev bypass with no header defaults to u_dev", async () => {
  const r = await resolveAuth(
    { authHeader: undefined, userIdHeader: undefined, devBypass: true },
    okVerify,
  );
  assert.equal(r.userId, "u_dev");
});

test("no token and no bypass resolves to null", async () => {
  const r = await resolveAuth(
    { authHeader: undefined, userIdHeader: "u_dev", devBypass: false },
    okVerify,
  );
  assert.equal(r.userId, null);
});

test("a valid bearer token wins even when dev bypass is on", async () => {
  const r = await resolveAuth(
    { authHeader: "Bearer good", userIdHeader: "u_dev", devBypass: true },
    okVerify,
  );
  assert.equal(r.userId, "user_123");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @bethere/api test
```

Expected: FAIL - cannot find module `./resolve.js` (or `resolveAuth` undefined).

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/auth/resolve.ts`:

```ts
// Pure auth-decision logic. The token verifier is injected so this is testable with no
// network and no DB. Returns a nullable userId; enforcement lives in protectedProcedure.

export type VerifiedClaims = { sub: string; name?: string; email?: string };

export type VerifyFn = (token: string) => Promise<VerifiedClaims>;

export type AuthInputs = {
  authHeader?: string; // raw "Authorization" header, e.g. "Bearer <jwt>"
  userIdHeader?: string; // raw "x-user-id" header (dev stub)
  devBypass: boolean; // true when DEV_AUTH_BYPASS is enabled
};

export type AuthResult = { userId: string | null; claims: VerifiedClaims | null };

const BEARER = "Bearer ";

export async function resolveAuth(inputs: AuthInputs, verify: VerifyFn): Promise<AuthResult> {
  const token = inputs.authHeader?.startsWith(BEARER)
    ? inputs.authHeader.slice(BEARER.length).trim()
    : undefined;

  if (token) {
    try {
      const claims = await verify(token);
      return { userId: claims.sub, claims };
    } catch {
      // Invalid/expired token: treat as unauthenticated rather than a server error.
      return { userId: null, claims: null };
    }
  }

  if (inputs.devBypass) {
    return { userId: inputs.userIdHeader ?? "u_dev", claims: null };
  }

  return { userId: null, claims: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @bethere/api test
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth/resolve.ts apps/api/src/auth/resolve.test.ts
git commit -m "feat(api): pure auth resolution logic with tests"
```

---

## Task B4: Clerk verify wrapper and user upsert

**Files:**
- Create: `apps/api/src/auth/clerk.ts`
- Create: `apps/api/src/db/users.ts`

- [ ] **Step 1: Write the Clerk verify wrapper**

Create `apps/api/src/auth/clerk.ts`:

```ts
import { verifyToken } from "@clerk/backend";
import type { VerifiedClaims } from "./resolve.js";

// Networkless verification: checks the JWT signature against the instance public key
// (CLERK_JWT_KEY) without a round-trip to Clerk. name/email are present only if added to
// the session-token claims in the Clerk dashboard (see the manual ops checklist).
export async function verifyClerkToken(token: string): Promise<VerifiedClaims> {
  const jwtKey = process.env.CLERK_JWT_KEY;
  if (!jwtKey) throw new Error("CLERK_JWT_KEY is not set");

  const claims = await verifyToken(token, { jwtKey });
  const c = claims as Record<string, unknown>;
  return {
    sub: claims.sub,
    name: typeof c.name === "string" ? c.name : undefined,
    email: typeof c.email === "string" ? c.email : undefined,
  };
}
```

- [ ] **Step 2: Write the upsert helper**

Create `apps/api/src/db/users.ts`:

```ts
import { db } from "./client.js";
import { users } from "./schema.js";

// Deterministic avatar colour so a user looks the same across sessions/devices.
const PALETTE = ["#5F9472", "#C77D54", "#5B7DB1", "#7E6BB0", "#B0654F", "#3F7BA8"];
function colorFor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Insert a first-seen Clerk user; leave existing rows untouched. Name refresh on profile
// change is out of scope for M2 (onConflictDoNothing keeps this a no-op for known users).
export async function upsertUser(u: { id: string; name?: string; email?: string }): Promise<void> {
  await db
    .insert(users)
    .values({
      id: u.id,
      name: u.name ?? "Member",
      email: u.email ?? null,
      avatarColor: colorFor(u.id),
    })
    .onConflictDoNothing({ target: users.id });
}
```

- [ ] **Step 3: Typecheck**

Run:

```bash
pnpm --filter @bethere/api typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/auth/clerk.ts apps/api/src/db/users.ts
git commit -m "feat(api): clerk token verify wrapper and user upsert"
```

---

## Task B5: Wire the context, add protectedProcedure, protect routers

**Files:**
- Modify: `apps/api/src/trpc.ts`
- Modify: `apps/api/src/routers/events.ts:14`
- Modify: `apps/api/src/routers/groups.ts:8`

- [ ] **Step 1: Rewrite `createContext` and add `protectedProcedure`**

Replace the top of `apps/api/src/trpc.ts` (the import block through `createContext` and the `Context` type) with:

```ts
import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { verifyClerkToken } from "./auth/clerk.js";
import { resolveAuth } from "./auth/resolve.js";
import { upsertUser } from "./db/users.js";

function headerString(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  // Server-authoritative identity. A verified Clerk bearer token wins; otherwise, when
  // DEV_AUTH_BYPASS is set, fall back to the spoofable x-user-id stub (default u_dev).
  // userId is nullable here - protectedProcedure does the rejecting.
  const devBypass =
    process.env.DEV_AUTH_BYPASS === "1" || process.env.DEV_AUTH_BYPASS === "true";

  const { userId, claims } = await resolveAuth(
    {
      authHeader: headerString(req.headers.authorization),
      userIdHeader: headerString(req.headers["x-user-id"]),
      devBypass,
    },
    verifyClerkToken,
  );

  // First-seen real users get a row so groups/RSVPs can reference them.
  if (claims) await upsertUser({ id: claims.sub, name: claims.name, email: claims.email });

  return { userId, log: req.log };
}

type Context = Awaited<ReturnType<typeof createContext>>;
```

- [ ] **Step 2: Make the logging middleware null-safe**

In `apps/api/src/trpc.ts`, in `loggingMiddleware`, change the two lines that build `base`/`tail` to tolerate a null user:

```ts
  const who = ctx.userId ?? "anon";
  const base = { scope: "trpc", path, type, userId: who, ms };
  const tail = `user=${who} ${ms}ms`;
```

- [ ] **Step 3: Add `protectedProcedure` at the bottom of `trpc.ts`**

Replace the final export lines with:

```ts
export const router = t.router;
export const publicProcedure = t.procedure.use(loggingMiddleware);

// Rejects unauthenticated callers and narrows ctx.userId to a non-null string for the
// procedure body.
const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.userId } });
});
export const protectedProcedure = publicProcedure.use(requireAuth);
```

- [ ] **Step 4: Protect the events router**

In `apps/api/src/routers/events.ts`:
- Change the import on line 14 from `import { publicProcedure, router } from "../trpc.js";` to `import { protectedProcedure, router } from "../trpc.js";`
- Replace every `publicProcedure` in this file with `protectedProcedure` (5 occurrences: `create`, `mine`, `get`, `respond`, `resolve`).

- [ ] **Step 5: Protect the groups router**

In `apps/api/src/routers/groups.ts`:
- Change the import on line 8 to `import { protectedProcedure, router } from "../trpc.js";`
- Replace every `publicProcedure` with `protectedProcedure` (7 occurrences).

Leave `health` in `apps/api/src/router.ts` on `publicProcedure` (App Runner's health check hits `/trpc/health` unauthenticated).

- [ ] **Step 6: Typecheck**

Run:

```bash
pnpm --filter @bethere/api typecheck
```

Expected: PASS. (If `ctx.userId` is flagged as possibly-null inside any procedure body, that procedure is still on `publicProcedure` - switch it to `protectedProcedure`.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/trpc.ts apps/api/src/routers/events.ts apps/api/src/routers/groups.ts
git commit -m "feat(api): verify Clerk tokens in context, gate routers with protectedProcedure"
```

---

## Task B6: Local env + manual smoke test

**Files:**
- Modify: `apps/api/.env` (gitignored; create if absent)
- Modify: `apps/api/.env.example` (if present) or `docs/runbook-deploy.md`

- [ ] **Step 1: Set local dev env**

Add to `apps/api/.env` (create the file if it does not exist):

```
DEV_AUTH_BYPASS=1
```

This keeps `pnpm dev:api`, `curl`, and existing flows working without Clerk. Do NOT set `CLERK_JWT_KEY` locally unless testing real tokens.

- [ ] **Step 2: Document the new env vars**

Add an env note to `docs/runbook-deploy.md` (or `apps/api/.env.example`):

```
# Auth
DEV_AUTH_BYPASS=1            # accept x-user-id stub when no bearer token (local + M2 prod)
CLERK_JWT_KEY=...            # PEM public key for networkless Clerk token verification
CLERK_SECRET_KEY=sk_...      # Clerk backend key (reserved; not required for verifyToken)
```

- [ ] **Step 3: Smoke test the three auth paths**

Start the API (`pnpm dev:api`) in another shell, then:

```bash
# health is public -> ok
curl -fsS localhost:3000/trpc/health
# dev bypass on + x-user-id -> works (groups for u_lily)
curl -fsS -H "x-user-id: u_lily" localhost:3000/trpc/groups.mine
```

Expected: health returns `{"result":{"data":{"ok":true}}}`; `groups.mine` returns Lily's groups.

Then stop the server, set `DEV_AUTH_BYPASS=` (empty) in `.env`, restart, and:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "x-user-id: u_lily" localhost:3000/trpc/groups.mine
```

Expected: `401`. Restore `DEV_AUTH_BYPASS=1` afterward.

- [ ] **Step 4: Commit docs**

```bash
git add docs/runbook-deploy.md apps/api/.env.example 2>/dev/null
git commit -m "docs(api): document auth env vars and dev bypass"
```

---

## Task C1: Add client dependencies and configure platforms/scheme

**Files:**
- Modify: `apps/mobile/package.json`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Install Clerk + web deps with expo (SDK-matched versions)**

Run from repo root:

```bash
pnpm --filter @bethere/mobile exec expo install @clerk/clerk-expo expo-web-browser expo-auth-session expo-secure-store react-native-web react-dom @expo/metro-runtime
```

- [ ] **Step 2: Add the web platform and a URL scheme**

Replace `apps/mobile/app.json` with:

```json
{
  "expo": {
    "name": "drp-02",
    "slug": "drp-02",
    "version": "1.0.0",
    "scheme": "bethere",
    "orientation": "portrait",
    "platforms": ["ios", "android", "web"],
    "web": {
      "bundler": "metro",
      "output": "single"
    }
  }
}
```

- [ ] **Step 3: Typecheck (sanity)**

Run:

```bash
pnpm --filter @bethere/mobile typecheck
```

Expected: PASS (no code uses the new deps yet).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json apps/mobile/app.json pnpm-lock.yaml
git commit -m "chore(mobile): add Clerk + web deps, enable web platform and scheme"
```

---

## Task C2: Auth holder + `buildAuthHeaders` (TDD)

This is the only piece of client auth logic worth unit-testing: turning auth state into request headers.

**Files:**
- Create: `apps/mobile/src/lib/auth.ts` (holder + header builder only in this task)
- Create: `apps/mobile/__tests__/buildAuthHeaders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/buildAuthHeaders.test.ts`:

```ts
import { buildAuthHeaders, type AuthHolder } from "../src/lib/auth";

it("returns x-user-id in dev mode", async () => {
  const holder: AuthHolder = { mode: "dev", devUserId: "u_dev", getToken: null };
  expect(await buildAuthHeaders(holder)).toEqual({ "x-user-id": "u_dev" });
});

it("returns a bearer header in clerk mode", async () => {
  const holder: AuthHolder = { mode: "clerk", devUserId: null, getToken: async () => "jwt123" };
  expect(await buildAuthHeaders(holder)).toEqual({ Authorization: "Bearer jwt123" });
});

it("returns no auth headers when signed out", async () => {
  const holder: AuthHolder = { mode: null, devUserId: null, getToken: null };
  expect(await buildAuthHeaders(holder)).toEqual({});
});

it("returns no headers if clerk getToken yields null", async () => {
  const holder: AuthHolder = { mode: "clerk", devUserId: null, getToken: async () => null };
  expect(await buildAuthHeaders(holder)).toEqual({});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @bethere/mobile test
```

Expected: FAIL - cannot resolve `../src/lib/auth`.

- [ ] **Step 3: Write the holder + builder (logic only)**

Create `apps/mobile/src/lib/auth.ts`:

```ts
// Module-level auth state, updated by <AuthBridge/> (added in a later task) and read by the
// tRPC client. Kept outside React so the non-React tRPC client can attach the right header.

export type AuthMode = "clerk" | "dev" | null;

export type AuthHolder = {
  mode: AuthMode;
  devUserId: string | null;
  getToken: (() => Promise<string | null>) | null;
};

export const holder: AuthHolder = { mode: null, devUserId: null, getToken: null };

export async function buildAuthHeaders(h: AuthHolder): Promise<Record<string, string>> {
  if (h.mode === "dev" && h.devUserId) return { "x-user-id": h.devUserId };
  if (h.mode === "clerk" && h.getToken) {
    const token = await h.getToken();
    if (token) return { Authorization: `Bearer ${token}` };
  }
  return {};
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm --filter @bethere/mobile test
```

Expected: PASS (4 tests + the existing trivial test).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/auth.ts apps/mobile/__tests__/buildAuthHeaders.test.ts
git commit -m "feat(mobile): auth holder and request header builder with tests"
```

---

## Task C3: Clerk config, providers, and tRPC header injection

**Files:**
- Create: `apps/mobile/src/lib/clerk.ts`
- Modify: `apps/mobile/src/lib/auth.ts` (add React providers/bridge)
- Modify: `apps/mobile/src/lib/trpc.ts`

- [ ] **Step 1: Clerk config + native token cache**

Create `apps/mobile/src/lib/clerk.ts`:

```ts
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";

// Native persists the session token in the secure enclave; web uses Clerk's own storage,
// so we pass undefined there.
export const tokenCache =
  Platform.OS === "web"
    ? undefined
    : {
        getToken: (key: string) => SecureStore.getItemAsync(key),
        saveToken: (key: string, value: string) => SecureStore.setItemAsync(key, value),
      };

// Shown the dev-bypass button only in CD/dev builds.
export const devAuthEnabled = process.env.EXPO_PUBLIC_DEV_AUTH === "1";
```

- [ ] **Step 2: Add the DevAuth context and AuthBridge to `auth.ts`**

Append to `apps/mobile/src/lib/auth.ts`:

```ts
import { useAuth } from "@clerk/clerk-expo";
import { createContext, createElement, useContext, useEffect, useMemo, useState } from "react";

type DevAuth = { devUser: string | null; signInDev: () => void; signOutDev: () => void };
const DevAuthContext = createContext<DevAuth>({
  devUser: null,
  signInDev: () => {},
  signOutDev: () => {},
});

export function DevAuthProvider({ children }: { children: React.ReactNode }) {
  const [devUser, setDevUser] = useState<string | null>(null);
  const value = useMemo<DevAuth>(
    () => ({
      devUser,
      signInDev: () => setDevUser("u_dev"),
      signOutDev: () => setDevUser(null),
    }),
    [devUser],
  );
  return createElement(DevAuthContext.Provider, { value }, children);
}

export function useDevAuth(): DevAuth {
  return useContext(DevAuthContext);
}

// Keeps the module-level holder in sync with Clerk + dev state. Render once inside both
// ClerkProvider and DevAuthProvider. Returns whether the app should consider the user authed.
export function useAuthBridge(): boolean {
  const { isSignedIn, getToken } = useAuth();
  const { devUser } = useDevAuth();

  useEffect(() => {
    if (devUser) {
      holder.mode = "dev";
      holder.devUserId = devUser;
      holder.getToken = null;
    } else if (isSignedIn) {
      holder.mode = "clerk";
      holder.devUserId = null;
      holder.getToken = () => getToken();
    } else {
      holder.mode = null;
      holder.devUserId = null;
      holder.getToken = null;
    }
  }, [devUser, isSignedIn, getToken]);

  return !!devUser || !!isSignedIn;
}
```

- [ ] **Step 3: Inject headers into the tRPC client**

Replace `apps/mobile/src/lib/trpc.ts` with:

```ts
import type { AppRouter } from "@bethere/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { buildAuthHeaders, holder } from "./auth";

// EXPO_PUBLIC_* vars are inlined by Metro at build time. Set EXPO_PUBLIC_API_URL to the
// deployed backend; falls back to the local dev server.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      headers: () => buildAuthHeaders(holder),
    }),
  ],
});

// Type-chain proof: `health` is known and typed as () => Promise<{ ok: true }>.
export type HealthResult = Awaited<ReturnType<typeof trpc.health.query>>;
```

- [ ] **Step 4: Typecheck**

Run:

```bash
pnpm --filter @bethere/mobile typecheck && pnpm --filter @bethere/mobile test
```

Expected: PASS (types compile; the buildAuthHeaders test still passes).

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/clerk.ts apps/mobile/src/lib/auth.ts apps/mobile/src/lib/trpc.ts
git commit -m "feat(mobile): Clerk providers, auth bridge, tRPC header injection"
```

---

## Task C4: Sign-in screen (Google + flag-gated dev button)

**Files:**
- Create: `apps/mobile/src/screens/SignIn.tsx`

- [ ] **Step 1: Write the screen**

Create `apps/mobile/src/screens/SignIn.tsx`:

```tsx
import { useSSO } from "@clerk/clerk-expo";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useDevAuth } from "../lib/auth";
import { devAuthEnabled } from "../lib/clerk";
import { colors, radius, space } from "../theme";

// Completes any pending OAuth redirect (web/native handoff back into the app).
WebBrowser.maybeCompleteAuthSession();

export function SignIn() {
  const { startSSOFlow } = useSSO();
  const { signInDev } = useDevAuth();
  const [busy, setBusy] = useState(false);

  const onGoogle = async () => {
    setBusy(true);
    try {
      const { createdSessionId, setActive } = await startSSOFlow({
        strategy: "oauth_google",
        // Web defaults to current path; native must use the app scheme.
        redirectUrl:
          Platform.OS === "web" ? undefined : AuthSession.makeRedirectUri({ scheme: "bethere" }),
      });
      if (createdSessionId && setActive) await setActive({ session: createdSessionId });
    } catch (err) {
      console.error("sign-in failed", JSON.stringify(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.brand}>BeThere</Text>
        <Text style={styles.sub}>Plan real meetups with your groups.</Text>

        <Pressable style={styles.primary} onPress={onGoogle} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.primaryText}>Continue with Google</Text>
          )}
        </Pressable>

        {devAuthEnabled ? (
          <Pressable style={styles.secondary} onPress={signInDev} disabled={busy}>
            <Text style={styles.secondaryText}>Continue as test user</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  card: { width: "100%", maxWidth: 360, paddingHorizontal: space.xl, gap: space.md },
  brand: { fontSize: 34, fontWeight: "700", color: colors.ink, textAlign: "center" },
  sub: { fontSize: 15, color: colors.muted, textAlign: "center", marginBottom: space.lg },
  primary: {
    backgroundColor: colors.accentInk,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryText: { color: colors.surface, fontSize: 16, fontWeight: "600" },
  secondary: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 14,
    alignItems: "center",
  },
  secondaryText: { color: colors.ink, fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @bethere/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/screens/SignIn.tsx
git commit -m "feat(mobile): Clerk Google sign-in screen with dev-bypass button"
```

---

## Task C5: Account/sign-out control

**Files:**
- Create: `apps/mobile/src/components/AccountButton.tsx`

- [ ] **Step 1: Write the control**

Create `apps/mobile/src/components/AccountButton.tsx`:

```tsx
import { useAuth, useUser } from "@clerk/clerk-expo";
import { Pressable, StyleSheet, Text } from "react-native";
import { useDevAuth } from "../lib/auth";
import { colors, space } from "../theme";

// Header control: shows the signed-in name and signs out (Clerk session or dev bypass).
export function AccountButton() {
  const { signOut } = useAuth();
  const { user } = useUser();
  const { devUser, signOutDev } = useDevAuth();

  const label = devUser ? "Test user" : (user?.firstName ?? user?.username ?? "Account");

  const onPress = async () => {
    if (devUser) {
      signOutDev();
      return;
    }
    await signOut();
  };

  return (
    <Pressable style={styles.btn} onPress={onPress} hitSlop={8}>
      <Text style={styles.text}>{label} - Sign out</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: space.sm, paddingVertical: space.xs },
  text: { color: colors.accentInk, fontSize: 13, fontWeight: "600" },
});
```

- [ ] **Step 2: Typecheck**

Run:

```bash
pnpm --filter @bethere/mobile typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/src/components/AccountButton.tsx
git commit -m "feat(mobile): account sign-out header control"
```

---

## Task C6: Wire the root - providers, gate, web shell, header sign-out

**Files:**
- Modify: `apps/mobile/App.tsx`

- [ ] **Step 1: Rewrite `App.tsx`**

Replace `apps/mobile/App.tsx` with the following. The existing navigator is preserved verbatim; it is wrapped in providers, an auth gate, and a web max-width shell, and `AccountButton` is added to the shared stack header.

```tsx
import { ClerkProvider } from "@clerk/clerk-expo";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { Platform, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AccountButton } from "./src/components/AccountButton";
import { DevAuthProvider, useAuthBridge } from "./src/lib/auth";
import { publishableKey, tokenCache } from "./src/lib/clerk";
import { CreateEvent } from "./src/screens/CreateEvent";
import { CreateGroup } from "./src/screens/CreateGroup";
import { Dashboard } from "./src/screens/Dashboard";
import { EventDetail } from "./src/screens/EventDetail";
import { GroupDetail } from "./src/screens/GroupDetail";
import { GroupsList } from "./src/screens/GroupsList";
import { SignIn } from "./src/screens/SignIn";
import { colors } from "./src/theme";

export type MeetupsStackParams = {
  Dashboard: undefined;
  EventDetail: { eventId: string };
  CreateEvent: undefined;
};
export type GroupsStackParams = {
  GroupsList: undefined;
  GroupDetail: { groupId: string };
  CreateGroup: undefined;
};

const stackHeader = {
  headerStyle: { backgroundColor: colors.bg },
  headerShadowVisible: false,
  headerTintColor: colors.ink,
  headerTitleStyle: { color: colors.ink },
  contentStyle: { backgroundColor: colors.bg },
  headerRight: () => <AccountButton />,
} as const;

const MeetupsStack = createNativeStackNavigator<MeetupsStackParams>();
function MeetupsStackScreen() {
  return (
    <MeetupsStack.Navigator screenOptions={stackHeader}>
      <MeetupsStack.Screen name="Dashboard" component={Dashboard} options={{ title: "Meetups" }} />
      <MeetupsStack.Screen name="EventDetail" component={EventDetail} options={{ title: "" }} />
      <MeetupsStack.Screen
        name="CreateEvent"
        component={CreateEvent}
        options={{ title: "Suggest a Meet" }}
      />
    </MeetupsStack.Navigator>
  );
}

const GroupsStack = createNativeStackNavigator<GroupsStackParams>();
function GroupsStackScreen() {
  return (
    <GroupsStack.Navigator screenOptions={stackHeader}>
      <GroupsStack.Screen
        name="GroupsList"
        component={GroupsList}
        options={{ title: "Your Groups" }}
      />
      <GroupsStack.Screen name="GroupDetail" component={GroupDetail} options={{ title: "" }} />
      <GroupsStack.Screen
        name="CreateGroup"
        component={CreateGroup}
        options={{ title: "New group" }}
      />
    </GroupsStack.Navigator>
  );
}

const Tab = createBottomTabNavigator();
function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentInk,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontSize: 13, fontWeight: "600" },
        tabBarIconStyle: { display: "none" },
      }}
    >
      <Tab.Screen name="Meetups" component={MeetupsStackScreen} />
      <Tab.Screen name="Groups" component={GroupsStackScreen} />
    </Tab.Navigator>
  );
}

// Auth gate. useAuthBridge keeps the tRPC header holder in sync and tells us whether to
// show the app or the sign-in screen.
function Gate() {
  const authed = useAuthBridge();
  return (
    <NavigationContainer>
      {authed ? <MainTabs /> : <SignIn />}
      <StatusBar style="dark" />
    </NavigationContainer>
  );
}

// On web, constrain to a centered phone-width column so desktop looks intentional.
function Shell({ children }: { children: React.ReactNode }) {
  if (Platform.OS !== "web") return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: "center", backgroundColor: colors.line }}>
      <View style={{ flex: 1, width: "100%", maxWidth: 480, backgroundColor: colors.bg }}>
        {children}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <DevAuthProvider>
        <SafeAreaProvider>
          <Shell>
            <Gate />
          </Shell>
        </SafeAreaProvider>
      </DevAuthProvider>
    </ClerkProvider>
  );
}
```

- [ ] **Step 2: Typecheck + tests + lint**

Run:

```bash
pnpm --filter @bethere/mobile typecheck && pnpm --filter @bethere/mobile test && pnpm lint
```

Expected: PASS. (If lint flags the `headerRight` arrow or `Shell` fragment, run `pnpm format`.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/App.tsx
git commit -m "feat(mobile): auth gate, providers, web shell, header sign-out"
```

---

## Task C7: Web build script + Vercel config + local smoke

**Files:**
- Modify: `apps/mobile/package.json`
- Create: `apps/mobile/vercel.json`

- [ ] **Step 1: Add the web build script**

In `apps/mobile/package.json` `"scripts"`, add:

```json
    "build:web": "expo export --platform web",
```

- [ ] **Step 2: Add Vercel SPA config**

Create `apps/mobile/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "cd ../.. && pnpm install --frozen-lockfile && pnpm --filter @bethere/mobile build:web",
  "outputDirectory": "dist",
  "installCommand": "echo skip",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 3: Smoke test the web export locally**

Run:

```bash
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_placeholder pnpm --filter @bethere/mobile build:web
```

Expected: a `apps/mobile/dist/` directory containing `index.html` and JS bundles. (A placeholder key is fine for the build; sign-in needs a real key at runtime.) Optionally serve it: `npx serve apps/mobile/dist`.

- [ ] **Step 4: Ensure `dist/` is ignored**

Confirm `dist` is gitignored (add `apps/mobile/dist/` to `.gitignore` if not). Then:

```bash
git add apps/mobile/package.json apps/mobile/vercel.json .gitignore
git commit -m "build(mobile): web export script and Vercel SPA config"
```

---

## Task D1: CD - bake Clerk key and dev flag into the APK

**Files:**
- Modify: `.github/workflows/cd.yml:42-45`

- [ ] **Step 1: Add build env to the build-apk job**

In `.github/workflows/cd.yml`, extend the `env:` block under `jobs.build-apk` (which currently sets only `EXPO_PUBLIC_API_URL`) to:

```yaml
    env:
      # Bake the live backend URL into the APK (EXPO_PUBLIC_* is inlined at build time).
      EXPO_PUBLIC_API_URL: https://96mgvmgcbj.us-east-1.awsapprunner.com
      # Clerk publishable key for real Google sign-in in the APK (safe to expose; it is a
      # publishable key). Stored as a repo secret.
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: ${{ secrets.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY }}
      # Show the "Continue as test user" dev-bypass button in sideloaded builds.
      EXPO_PUBLIC_DEV_AUTH: "1"
```

- [ ] **Step 2: Validate workflow YAML**

Run:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/cd.yml')); print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cd.yml
git commit -m "ci(cd): bake Clerk publishable key and dev-auth flag into the APK"
```

---

## Task D2: Manual ops checklist (no code)

These are one-time external configuration steps. Check each off as completed.

- [ ] **Clerk dashboard - create app + Google:** create a Clerk application; under SSO connections enable **Google** (Clerk's shared dev credentials are fine for testing).
- [ ] **Clerk dashboard - redirects/origins:** add allowed origins/redirect URLs: `http://localhost:8081`, `http://localhost:19006`, the Vercel web URL (once known), and the native scheme `bethere://`.
- [ ] **Clerk dashboard - session token claims:** in Sessions -> customize the session token, add `name` and `email` claims so the API's user upsert can store them. (Without this, users insert with name "Member" and null email.)
- [ ] **Clerk dashboard - keys:** copy the **Publishable key** and the **JWKS public key / PEM** (for `CLERK_JWT_KEY`) and the **Secret key**.
- [ ] **GitHub secret:** add repo secret `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` = the publishable key.
- [ ] **App Runner env:** set `CLERK_JWT_KEY` (PEM), `CLERK_SECRET_KEY`, and `DEV_AUTH_BYPASS=1` on the `bethere-api` service. Confirm a redeploy succeeds and `/trpc/health` stays green.
- [ ] **Vercel project:** new project, root directory `apps/mobile`, framework preset **Other**; it picks up `vercel.json`. Set env `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `EXPO_PUBLIC_API_URL` (the App Runner URL). Do NOT set `EXPO_PUBLIC_DEV_AUTH` (web is Google-only). Deploy and note the URL; add it back to Clerk allowed origins.

---

## Task V1: Full verification

- [ ] **Step 1: Repo-wide checks**

Run:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all PASS.

- [ ] **Step 2: Local web sign-in (real key)**

With a real publishable key, run the web dev server:

```bash
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... pnpm --filter @bethere/mobile exec expo start --web
```

Verify: the SignIn screen shows only "Continue with Google" (no dev button, since `EXPO_PUBLIC_DEV_AUTH` is unset). Google sign-in completes and lands on the Meetups dashboard. Sign out returns to SignIn.

- [ ] **Step 3: Dev-bypass path (simulating the APK)**

Run with the dev flag and an API that has `DEV_AUTH_BYPASS=1`:

```bash
EXPO_PUBLIC_DEV_AUTH=1 EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_... pnpm --filter @bethere/mobile exec expo start --web
```

Verify: "Continue as test user" appears, taps straight into the app as `u_dev` with the seeded groups/RSVPs visible, and RSVP flows work end-to-end. Sign out returns to SignIn.

- [ ] **Step 4: Final commit (if any formatting/fixups)**

```bash
git add -A && git commit -m "chore: verification fixups for Clerk auth + web target" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** one-app-web-target (C1,C6,C7), Clerk Google on both targets (C3,C4), identity = Clerk id + first-sign-in upsert (B4,B5), backend verify + DEV_AUTH_BYPASS fallback (B3,B5,B6), APK both-paths with dev button -> u_dev (C4,D1), Vercel deploy (C7,D2), Clerk dashboard/claims/redirects (D2), tests (B3,C2), schema email (B2). All covered.
- **Health stays public:** B5 Step 5 explicitly keeps `health` on `publicProcedure` (App Runner check at `/trpc/health`).
- **Type consistency:** `AuthHolder`/`holder`/`buildAuthHeaders` (C2) reused unchanged in `trpc.ts` (C3) and `auth.ts` bridge (C3); `VerifiedClaims`/`resolveAuth` (B3) reused in `clerk.ts` (B4) and `trpc.ts` (B5); `useAuthBridge`/`DevAuthProvider`/`useDevAuth` defined in C3 and consumed in C4/C5/C6.
- **Known risk:** native Custom Tab OAuth redirect can vary by device; the dev button is the reliable demo path. `DEV_AUTH_BYPASS=1` on prod is an accepted M2 trade-off.
