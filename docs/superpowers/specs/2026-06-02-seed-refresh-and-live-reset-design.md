# Seed refresh + live reset - design (2026-06-02)

## Context / problem

The live backend (App Runner service `bethere-api`, AWS acct 208569836255, `us-east-1`, behind
private RDS) holds the demo data the team presents from. During the iteration-1/2 work this
session (native pickers, options re-enabled, add-time-while-voting, the voting-screen redesign)
the live DB accumulated ad-hoc test plans/times, so the demo is "out of whack". Two things follow:

1. **The seeded demo should be refreshed** to reflect where the product actually is now
   (iteration 2 = exact + options; fuzzy is hidden in the UI until iteration 3), and to show off
   the new collecting/voting flow.
2. **Resets need to be cheap and repeatable** because the model is changing fast and we will want
   to wipe back to a clean demo often.

Note verified while scoping: `apps/api/src/db/seed.ts` currently still matches
`apps/api/src/db/schema.ts` (it sets every column on every table), and none of this session's
changes altered the data model. So this is a demo-content refresh + reset-ergonomics task, not a
schema-drift fix.

## Goals

- Recraft the seeded demo to an **iteration-matched** set: only `exact` and `options` plans, no
  `fuzzy`/`fizzled` plans, while still filling every dashboard grouping the app renders.
- Add a **token-gated, instant reseed** of the live backend (no redeploy), plus a one-command
  local wrapper and runbook docs.
- Keep the seed honest as the schema evolves via the cheap, already-present guardrails
  (typecheck + reseed-on-local-boot), and write down the "update seed in the same commit as
  schema" convention.

## Non-goals

- No schema/migration changes.
- No CI database / integration-test harness for the seed (noted as a future option only - CI has
  no DB today).
- No change to the mobile app or the convergence model behavior.
- Not deleting the dropped fuzzy demo plans from history - they return in iteration 3.

## Decisions (confirmed with the user)

- **Scope:** refresh the demo + make resets easy (chosen over "just reset" or "drift guardrails only").
- **Seed content:** iteration-matched - exact + options only; drop the fuzzy plans for now.
- **Reset mechanism:** a guarded admin reseed endpoint (instant, no redeploy), chosen over a
  deploy-cycle script or "always reset on deploy".
- **Endpoint shape:** a **raw Fastify route** `POST /admin/reseed` (kept out of the typed tRPC
  surface) rather than a tRPC mutation.
- **Token:** assistant generates `ADMIN_RESET_TOKEN` and sets it on the live App Runner service
  (preserving the other env vars).

## Part 1 - refreshed demo content (`apps/api/src/db/seed.ts`)

Keep the same cast (`DEMO_USERS`) and the same five `GROUPS` so nothing else in the app looks
different. Replace the `PLANS` array with an iteration-matched set. "You" = `u_dev`.

| Plan | Group | Mode / Phase | Your role | Demonstrates |
|---|---|---|---|---|
| **Dune: Part Two** | The Boys (`g_boys`) | options / collecting | **You created it** | Creator voting screen: per-slot counts + the fenced **ORGANIZER** zone with the lock **armed** (one slot meets quorum -> green "Lock in <slot>"). |
| **Pub night** | Climbing Group (`g_climb`) | options / collecting | member, **not yet reacted** | "Action required" nudge -> tap-to-react (auto-save) + the **"+ Add a time"** flow; others have reacted so the creator sees counts. (Reuses the old fuzzy "Pub night" identity, now as concrete option times.) |
| **Bowling** | The Boys (`g_boys`) | exact / moment | awaiting (blind) | The blind timed **moment** + countdown; you have not answered -> action required. |
| **Dinner** | High School Reunion (`g_hs`) | options / cleared | **Going** | The "Going" reveal (who's in). |
| **Football** | The Boys (`g_boys`) | exact / cleared | **Declined** | Populates the **Declined** tab. |

**Dropped for now (return in iteration 3 with fuzzy):** "Pub night" as *fuzzy* (recast to options
above), "Climbing" (fuzzy/cleared), "Baking" (fuzzy/fizzled). Result: no `partOfDay`/fuzzy
candidates and no fizzled plan in the demo.

**Implementation notes:**
- Mirror the existing `Plan`/`Cand`/`Resp` interfaces and the `dayAt(daysFromNow, hour)` /
  `HOUR` helpers already in `seed.ts`; only the `PLANS` array content changes.
- "Pub night" (options/collecting, creator `u_adi`, group `g_climb`): give it ~3 concrete option
  candidates (`c1..c3`, no `partOfDay`), with `reactedBy` for other members but **not `u_dev`**, so
  You land in "Reacting / action required". Ensure quorum vs reactions is set so the creator's
  ready-to-lock state is sensible (does not need to be ready-to-lock for a non-You creator).
- "Dune: Part Two" stays options/collecting with `u_dev` as creator; keep one candidate reacted by
  >= quorum so the ORGANIZER lock renders **armed** for the screenshot.
- Empty groups are fine (e.g. Church Group may have no active plan now) - the Groups tab still
  lists them.
- Update the explanatory comment above `PLANS` to describe the new iteration-matched coverage.
- `reseedDemo()` / `seedDemoIfEmpty()` / `insertDemoData()` need no structural change - they just
  consume the new `PLANS`.

## Part 2 - reseed endpoint (`apps/api/src/index.ts`)

A raw Fastify route registered alongside the existing plugins:

- **Route:** `POST /admin/reseed`.
- **Auth:** read `process.env.ADMIN_RESET_TOKEN`.
  - If the env var is **unset or empty -> respond 403** ("disabled"). This makes the endpoint
    inert anywhere the secret is not configured (e.g. local dev, which already auto-reseeds on boot).
  - Compare the request's `x-admin-token` header to the env value. Use a length-checked,
    constant-time comparison (`crypto.timingSafeEqual` on equal-length buffers; mismatched length
    -> reject) to avoid leaking via timing. On mismatch -> 403 with no detail.
- **Action on success:** `await reseedDemo()` then respond `{ ok: true }`.
- **Logging:** `server.log.warn({ scope: "admin" }, "admin reseed invoked")` before running, and a
  completion line after, so every wipe is traceable in App Runner logs. (Do not log the token.)
- **Placement:** register after the tRPC plugin in `index.ts`; the global `@fastify/rate-limit`
  (100/min/IP) already applies. The route is intentionally NOT in the tRPC router, so it never
  appears in the mobile client's `AppRouter` types.

Pseudo-shape:
```
server.post("/admin/reseed", async (req, reply) => {
  const expected = process.env.ADMIN_RESET_TOKEN;
  if (!expected) return reply.code(403).send({ error: "disabled" });
  const got = req.headers["x-admin-token"];
  if (typeof got !== "string" || !safeEqual(got, expected)) {
    return reply.code(403).send({ error: "forbidden" });
  }
  req.log.warn({ scope: "admin" }, "admin reseed invoked");
  await reseedDemo();
  return { ok: true };
});
```

## Part 3 - reset workflow + staying in sync

**Resetting going forward:**
- **Local:** unchanged - `SEED_ON_BOOT=reset` already wipes+reseeds on every `pnpm dev:api` boot.
- **Live:** one command. Add `infra/reseed-live.sh` (reads `ADMIN_RESET_TOKEN` and the base URL
  from the environment, `curl -X POST "$BASE/admin/reseed" -H "x-admin-token: $ADMIN_RESET_TOKEN"`)
  and a root `package.json` script `reseed:live` that runs it. The token is **never committed** -
  it is read from the shell env (or a gitignored file).
- **Docs:** add a short "Reset live demo data" section to `docs/runbook-deploy.md` (the curl, the
  script, where the token lives, and the "it is gated/disabled without the env var" note).

**Keeping the seed honest as the schema moves (minimal guardrails, already mostly free):**
- The seed is TypeScript built against the Drizzle schema types, so a column rename / new NOT-NULL
  / removed field **breaks `pnpm typecheck`** immediately.
- `reseedDemo()` runs on **every local boot**, so runtime drift (new enum value, unset NOT-NULL
  column) blows up the moment the API starts locally - before it can reach live.
- Convention to document: **change the schema -> update `seed.ts` in the same commit**; typecheck
  + a local boot are the safety net.
- Future option (not built): a CI job with ephemeral Postgres that runs migrate + reseed.

## One-time setup (assistant performs during implementation)

Set the secret on the live service, preserving all existing env vars via `jq` (do not retype
`DATABASE_URL` / `CLERK_*`):

1. Generate a random token (e.g. `openssl rand -hex 24`).
2. `aws apprunner describe-service` -> take the current `SourceConfiguration`, `jq` to add
   `RuntimeEnvironmentVariables.ADMIN_RESET_TOKEN`, `aws apprunner update-service` with the result
   (this triggers one rolling deploy).
3. Wait for `RUNNING` + the operation `SUCCEEDED`; confirm `/trpc/health` is OK.
4. After deploy + after `seed.ts` ships, call `POST /admin/reseed` once to install the fresh demo,
   and verify the data (open the app, or query `events.mine` with `x-user-id: u_dev`).

The token is stored in App Runner env (and shared with the team out-of-band, e.g. a password
manager) - not in the repo.

## Files to change

- `apps/api/src/db/seed.ts` - replace the `PLANS` array with the iteration-matched set; update the
  comment. (No change to `reseedDemo`/`insertDemoData` structure.)
- `apps/api/src/index.ts` - register the `POST /admin/reseed` route + token guard + logging.
- `infra/reseed-live.sh` (new) - one-command live reset wrapper.
- `package.json` (root) - add `reseed:live` script.
- `docs/runbook-deploy.md` - add "Reset live demo data" section.
- App Runner service env - add `ADMIN_RESET_TOKEN` (infra, not a repo file).

## Verification

1. `pnpm typecheck`, `pnpm lint`, `pnpm test` green.
2. **Local:** `pnpm db:up` + `pnpm dev:api` -> boot reseed runs cleanly; query `events.mine` (the
   dashboard query, send `x-user-id: u_dev` under the dev bypass) or open the app and confirm the
   new 5-plan demo and the four dashboard groupings render, with "Dune" showing the armed ORGANIZER
   lock and "Pub night" showing action-required for You.
3. **Endpoint guard (local):** with `ADMIN_RESET_TOKEN` unset, `POST /admin/reseed` -> 403; with it
   set, wrong token -> 403, right token -> `{ ok: true }` and data reset.
4. **Live:** set the token (one deploy), call the reseed once, verify `/trpc/health` + the data.

## Risks / caveats

- **Destructive endpoint in prod.** Mitigated by: disabled-without-env, secret header,
  constant-time compare, loud logging, and the existing IP rate-limit. Still, the token must be
  kept secret; rotate by updating the env var. Acceptable at demo stage (data is throwaway; backend
  is already open via `DEV_AUTH_BYPASS`), revisit before any real data exists.
- **Reseed wipes everything** including any teammate's in-progress test data - expected, that is the
  point, but worth a heads-up to the team.
- **`reseedDemo` deletes then inserts in FK order** (already correct in `seed.ts`); the new content
  must keep referential integrity (every `createdBy`/member/reaction user exists in `DEMO_USERS`).
- The reseed runs synchronously in one request; with the demo's small size this is fine (well under
  any timeout).

## Out of scope / future

- Re-adding fuzzy demo plans in iteration 3.
- CI ephemeral-Postgres seed smoke test.
- Migrating timestamp columns to `timestamptz` (tracked separately).
- Any auth hardening beyond the token gate (the backend's open posture is deliberate for M2).
