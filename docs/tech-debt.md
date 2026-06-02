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

## Real-time is polling; local notifications only, no remote push

**Logged:** 2026-06-01 · **Updated:** 2026-06-02 · **Area:** `apps/mobile` · **Severity:** low

**What:** The convergence model's "live" feel (the moment countdown, the "It's coming together"
banner, the reveal) is driven by **~5s polling** (`setInterval` re-querying `events.mine` /
`events.get` in `Dashboard.tsx` and `EventDetail.tsx`).

Iteration 3 added **local *scheduled* notifications** (`expo-notifications`, the "ding taste" this
entry anticipated): `apps/mobile/src/lib/notifications.ts` schedules device-local reminders for the
lock-in deadline approaching, the moment opening, and an RSVP closing, driven off the `events.mine`
payload (`syncReminders`, called from `Dashboard.tsx`). This works in Expo Go with no dev build.
**But** they are **client-scheduled and device-local**: a device only schedules reminders for plans
it has loaded while the app was open, so a plan created while your app is closed won't remind you
until you next open it. There is still **no remote/server push** - a fully-closed app cannot be
pulled into a moment by the server.

**Why polling, not push:** real remote push needs `expo-notifications` **plus a development
build** (`expo-dev-client`), a physical device, and an Apple Developer account (APNs key) for
iOS. The iOS Simulator cannot receive remote push at all, and Expo Go dropped remote push in
SDK 53+. That is a multi-day detour and collides with the SDK-54 / Expo-Go constraint (see
`CLAUDE.md`). Polling satisfies the DRP "real-time interaction" requirement for a supervised
testing session where participants have the app open.

**Why it's acceptable for now:** M3 testing is a short, supervised session (often co-located or
orchestrated), so in-app live updates are enough; the banner gives the "coming together" cue.

**When to fix:** bundle with the planned **dev-build migration** (the same step that unblocks
bumping the Expo SDK). The *local* notification (the "ding taste") now ships; the remaining work is
a real *remote* push from the server (EAS push / APNs+FCM) so a closed app still gets pulled into
the moment. A WebSocket/SSE subscription could also replace polling for instant in-app updates if
poll load becomes a concern.

## Server phase transitions are lazy (read-triggered), no scheduler

**Logged:** 2026-06-02 · **Area:** `apps/api` · **Severity:** medium (low while supervised)

**What:** Plans advance through their lifecycle only when someone *reads* them. `settlePhase`
(moment -> cleared/fizzled) and the new `settleCollecting` (collecting -> moment via deadline
auto-lock) run inside `events.mine` / `events.get` / `events.resolve` (`apps/api/src/routers/events.ts`),
not on a timer. A plan whose `lockAt` has passed will not actually auto-lock until the next read of
it; the 5s client poll triggers this within seconds *if someone has the screen open*.

**Why it's acceptable for now:** demo/testing is supervised with apps open, so a read always happens
soon after a deadline; it keeps the server stateless (no job runner) and matches the existing
moment-settle pattern. Deadline auto-lock is "real enough" for a session.

**When to fix:** before any unsupervised use - a deadline that fires for a group with no app open
needs a real scheduler (a cron/worker calling the settle path, or the dev-build remote-push step).
This is now load-bearing: the deadline + auto-lock feature depends on it.

## Auto-lock ignores quorum ("lock the best slot anyway")

**Logged:** 2026-06-02 · **Area:** `apps/api` · **Severity:** low

**What:** When a collecting plan hits its deadline, `settleCollecting` locks the most-reacted slot
regardless of whether it meets `quorum` (it only falls back to a silent fizzle when *nobody* has
reacted at all). So a plan can lock with thin support.

**Why it's acceptable for now:** a deliberate product call (keep plans alive rather than dying on a
technicality); quorum tuning was explicitly deferred. The pieces are in place (`quorum`,
`pickWinningCandidate`) to enforce a threshold later.

**When to fix:** when we design a real turnout policy - e.g. require a minimum, a "needs everyone"
option, or a re-poll/extend instead of locking a barely-supported time.

## No DB-integration tests in CI for tRPC procedures

**Logged:** 2026-06-02 · **Area:** `apps/api` · **Severity:** low

**What:** The convergence/lock-in server logic (`settleCollecting`, `setOptOut`, the `addCandidate`
deadline guard, the `momentEndsAt` clamp, auto-lock winner selection) is exercised only by
throwaway in-process `appRouter.createCaller` smoke scripts run by hand against the local DB, then
deleted. CI runs only the pure unit tests in `packages/shared` and the auth/seed checks in
`apps/api`; nothing DB-dependent runs there.

**Why it's acceptable for now:** fast demo iteration, and the hard logic (candidate tally, winner
pick, conditional resolve, default lock-in time) is pure and unit-tested in `packages/shared`.

**When to fix:** stand up a lightweight tRPC-procedure harness (an in-process caller against a
disposable test database) and run it in CI if this graduates past the demo stage.

## `lockAt` is a tz-naive `timestamp`

**Logged:** 2026-06-02 · **Area:** `apps/api` · **Severity:** low

**What:** The new `events.lock_at` column (like `starts_at` / `moment_ends_at`) is a plain
`timestamp` without time zone. It round-trips correctly under a single, consistent server tz, but a
mixed-tz deployment would need `timestamptz`.

**Why it's acceptable for now:** one server, one tz; the client builds instants from numeric
components (the Hermes parse bug is already fixed). Same posture as the existing timestamp columns.

**When to fix:** a `timestamptz` migration if the backend ever runs across time zones.
