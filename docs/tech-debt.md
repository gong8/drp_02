# Technical debt

Known shortcuts we've taken deliberately. Each entry says *why it's OK for now* and
*what would trigger fixing it*, so we don't fix the wrong thing or fix it too early.

## API is unauthenticated / open

**Logged:** 2026-05-28 · **Area:** `apps/api` · **Severity:** medium (low while in private testing)

**What:** The live backend has no authentication. `createContext` defaults the user to
`u_dev` from an `x-user-id` header (`apps/api/src/trpc.ts`), so anyone who knows the URL
(`https://96mgvmgcbj.us-east-1.awsapprunner.com`) can impersonate any user and read/write
data with a plain `curl`. CORS is also wide open (`origin: true` in `apps/api/src/index.ts`).

**Why CORS is *not* the fix here:** CORS is a *browser* mechanism, enforced by the browser,
not the server. Our only client is the Expo **React Native** app (`platforms: [ios, android]`),
which does not enforce CORS at all — so tightening `origin` changes nothing for the app and
does nothing to stop `curl`/scripts/other clients. The real lever is authentication, not CORS.

**Why it's acceptable for now:**
- Walking-skeleton / M2 stage — no real user accounts or sensitive data, only demo content
  that re-seeds when empty (`SEED_ON_BOOT=if-empty`).
- RDS is **private** (not internet-exposed); only App Runner can reach it.
- Short, supervised real-user-testing window, not a public launch.

**When to fix:** before any public/unsupervised release, or as soon as we store real personal
data. Options, cheapest → proper:
1. **CORS allowlist** (`origin` from an env list, default closed) — hygiene only, ~5 lines.
   Worth doing if/when we add an Expo-web or admin dashboard.
2. **Shared `x-api-key` gate** — a Fastify hook checking a secret header; the app sends it.
   ~15 lines. Deters casual abuse but the key is extractable from a shipped app, so it is
   *not* real security.
3. **Per-user auth** (real tokens / sessions) — the actual fix. Its own piece of work; ties
   into a real `users` identity instead of the `u_dev` stub.
