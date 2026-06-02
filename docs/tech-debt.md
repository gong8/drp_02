# Technical debt

Known shortcuts we've taken deliberately. Each entry says *why it's OK for now* and
*what would trigger fixing it*, so we don't fix the wrong thing or fix it too early.

## API auth runs in dev-bypass on the live backend

**Logged:** 2026-05-28 · **Updated:** 2026-06-02 · **Area:** `apps/api` · **Severity:** medium (low while in private testing)

**What:** Clerk bearer-token verification is wired (`createContext` in `apps/api/src/trpc.ts`,
`auth/clerk.ts`) and `protectedProcedure` 401s unauthenticated callers. **But** the M2 backend
runs with `DEV_AUTH_BYPASS=1` and no `CLERK_JWT_KEY`, so identity still falls back to the
spoofable `x-user-id` header (default `u_dev`). Anyone who knows the URL
(`https://96mgvmgcbj.us-east-1.awsapprunner.com`) can still impersonate any user and read/write
data with a plain `curl`. CORS is also wide open (`origin: true` in `apps/api/src/index.ts`).
A global IP-keyed rate-limit (`@fastify/rate-limit`) is the only abuse guard while the API is open.

**Why CORS is *not* the fix here:** CORS is a *browser* mechanism, enforced by the browser,
not the server. Our only client is the Expo **React Native** app (`platforms: [ios, android]`),
which does not enforce CORS at all - so tightening `origin` changes nothing for the app and
does nothing to stop `curl`/scripts/other clients. The real lever is authentication, not CORS.

**Why it's acceptable for now:**
- Walking-skeleton / M2 stage - no real user accounts or sensitive data, only demo content
  that re-seeds when empty (`SEED_ON_BOOT=if-empty`).
- RDS is **private** (not internet-exposed); only App Runner can reach it.
- Short, supervised real-user-testing window, not a public launch.

**When to fix:** before any public/unsupervised release, or as soon as we store real personal
data. Options, cheapest → proper:
1. **CORS allowlist** (`origin` from an env list, default closed) - hygiene only, ~5 lines.
   Worth doing if/when we add an Expo-web or admin dashboard.
2. **Shared `x-api-key` gate** - a Fastify hook checking a secret header; the app sends it.
   ~15 lines. Deters casual abuse but the key is extractable from a shipped app, so it is
   *not* real security.
3. **Turn off the dev bypass** (the actual fix) - set `CLERK_JWT_KEY` and drop
   `DEV_AUTH_BYPASS` on the live backend so only verified Clerk tokens authenticate. The
   verification path already exists; this is a config + rollout step plus removing the
   `x-user-id` fallback, not new auth plumbing.

## Real-time is polling; no real push notifications

**Logged:** 2026-06-01 · **Area:** `apps/mobile` · **Severity:** low

**What:** The convergence model's "live" feel (the moment countdown, the "It's coming together"
banner, the reveal) is driven by **~5s polling** (`setInterval` re-querying `events.mine` /
`events.get` in `Dashboard.tsx` and `EventDetail.tsx`). There is no OS-level notification - the
blind moment cannot "ding" a phone that has the app closed, and we ship no local notification
either.

**Why polling, not push:** real remote push needs `expo-notifications` **plus a development
build** (`expo-dev-client`), a physical device, and an Apple Developer account (APNs key) for
iOS. The iOS Simulator cannot receive remote push at all, and Expo Go dropped remote push in
SDK 53+. That is a multi-day detour and collides with the SDK-54 / Expo-Go constraint (see
`CLAUDE.md`). Polling satisfies the DRP "real-time interaction" requirement for a supervised
testing session where participants have the app open.

**Why it's acceptable for now:** M3 testing is a short, supervised session (often co-located or
orchestrated), so in-app live updates are enough; the banner gives the "coming together" cue.

**When to fix:** bundle with the planned **dev-build migration** (the same step that unblocks
bumping the Expo SDK). Then add `expo-notifications`: a *local* notification when a moment opens
for you (the "ding taste"), and later a real *remote* push from the server (EAS push / APNs+FCM)
so a closed app still gets pulled into the moment. A WebSocket/SSE subscription could also
replace polling for instant in-app updates if poll load becomes a concern.
