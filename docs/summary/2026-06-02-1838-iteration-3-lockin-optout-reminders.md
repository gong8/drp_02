# Iteration 3: lock-in deadlines, auto-lock, private opt-out, local reminders + create-flow QOL - 2026-06-02

**Branch:** `dev` | **PRs:** none opened this session (committed straight to `dev` in 5 modular chunks: `75f09a7`, `a78456d`, `5fc4a47`, `d695dcc`, `60abc3e`) | **Scope:** BeThere "iteration 3" - turn the manual creator-fired lock into a deadline + auto-lock, add a private "I can't make it" opt-out, ship local scheduled reminders, and restructure the create flow (concrete toggle, quick-picks, deadline field, description, obvious optional/mandatory) plus small QOL.

## TL;DR
This session designed and built BeThere's "iteration 3" from three M3 user interviews (Tom, Felicity, Luca). The headline change replaces the old *creator-clicks-whenever* lock with a **deadline + lazy auto-lock**: a collecting plan now carries a `lockAt`, and when it passes the server auto-locks the best-supported slot and opens the blind moment (no manual lock for members; a `__DEV__`-only force-lock remains for demos). A private, reversible **"I can't make it"** opt-out was added (clears reactions, drops you from the tally/quorum, no reminders, shows as Declined). **Local scheduled notifications** (`expo-notifications`, Expo Go compatible, no dev build) now ping for the deadline approaching, the moment opening, and an RSVP closing. The **create screen** was restructured: a Flexible/Fixed toggle (replacing the two whenMode chips), quick-pick time chips, an editable lock-in deadline, a Notes field, and an obvious optional-vs-mandatory treatment. Plus a save-state ("Saving -> Saved") indicator on voting, day-of-week labels on dashboard cards, and a clearer "Change answer" control. Everything is typecheck/lint clean, shared (28) + api (14) tests pass, a 20-assertion in-process backend smoke passed, and the API boots + migrates + reseeds cleanly. Device (Expo Go) verification is the one outstanding step - it could not be run in this environment.

## What was done

### Planning (brainstorm -> approved plan)
- Read the three M3 interviews in `docs/drp-context/interviews/m3 interviews (iteration)/` (Tom, Felicity, Luca) and mapped them against the current code via parallel Explore agents.
- Ran a conversational brainstorm; user decisions captured below. Approved plan lives at `~/.claude/plans/docs-drp-context-interviews-m3-interview-lexical-sprout.md`.
- Iteration 3 was scoped to **lock-in + QOL only**; "float an idea" / fuzzy / anonymous / collaborative-location are explicitly the *next* iteration.

### 1. Backend: deadline + auto-lock + opt-out (commit `75f09a7`)
- **`packages/shared`:** new pure helper `logic/lock.ts` `defaultLockAt(earliestMs, nowMs, momentMs=60m, leadMs=24h)` ("the day before", clamped so `now < lockAt <= earliest - moment`, midpoint fallback for near-term plans) + `lock.test.ts` (5 cases). `schemas.ts`: relaxed `WhenInput` options to `.min(1)` (single flexible time allowed), added optional `lockAt` to `CreateEventInput`, added `SetOptOutInput`. Exported `logic/lock.js` from `index.ts`.
- **`apps/api/src/db/schema.ts`:** added nullable `events.lockAt timestamp` (collecting deadline; null for exact) and a new `eventOptOuts (eventId, userId)` table. One clean migration generated (`0003_red_the_initiative.sql`).
- **`apps/api/src/routers/events.ts`:**
  - `momentEnd(now, minutes, chosenStartsAt)` helper: the moment always ends by the event (`min(now+minutes, chosenStartsAt)`, full window if the start is already past). Applied to both auto-lock and the existing `lock` mutation.
  - `settleCollecting(e)`: lazy, read-triggered auto-lock mirroring `settlePhase`. At/after `lockAt`, picks `pickWinningCandidate ?? most-reacted` ("lock the best anyway"), opens the moment; **fizzles** if there are zero reactions. Called before `settlePhase` in `mine`/`get`/`resolve`.
  - `create`: computes `lockAt` for non-exact plans (`input.lockAt` validated `now < lockAt <= earliest`, else default).
  - `addCandidate`: rejects a slot `<= lockAt`.
  - `setOptOut({eventId, out})`: collecting-only; `out:true` deletes the caller's reactions + upserts an opt-out row; `out:false` deletes it. `react` clears the opt-out when picks are non-empty; `respond` clears it (escape hatch back in).
  - `mine`/`get`: call `settleCollecting`, return `lockAt` + `msLeftToLock`, and reflect opt-out as `myStatus: "declined"` (in every phase); `get` also returns `iOptedOut`.
  - **Privacy:** opt-out is fully private - no count/names exposed; the tally excludes opted-out users automatically because their reactions are cleared.
- **Seed:** `seed-data.ts` gained `lockAt?` on the `Plan` type + a `lockAt <= earliest` integrity check; the two collecting demo plans (`e_movie`, `e_pub`) get safely-future `lockAt`s (tomorrow) so they stay collecting during a demo. `seed.ts` inserts `lockAt`.
- **Verified** with a throwaway in-process `appRouter.createCaller` smoke (20 assertions: default lockAt, single flexible time, override validation, addCandidate guard, opt-out clears/excludes/flips-status, react rejoins, auto-lock picks best + momentEndsAt <= start, fizzle on zero reactions). Smoke deleted after.

### 2. Create-flow restructure (commit `a78456d`)
- **`apps/mobile/src/screens/CreateEvent.tsx`** rewritten: the two whenMode chips became one `Toggle` **Flexible/Fixed** (Fixed = `exact` instant moment; Flexible = `options` that auto-lock). Unified to a single `rows` time list (1-6), `+ Add a time` in flexible mode.
- **Quick-picks:** new pure `lib/quickpicks.ts` `quickPicks(now)` (Tonight if before 7pm, Tomorrow eve, This Sat, Sat eve, Next week) + `__tests__/quickpicks.test.ts`. A chip row fills the next empty time slot (or appends), so an options list builds in a couple taps.
- **Lock-in deadline (flexible only):** shows the computed default via `defaultLockAt` + `formatSlot` ("Auto-locks ... - the evening before"), with a "Change deadline" override (pickers, client-validated before the earliest slot).
- **Notes field** wired (`description` already existed in the API; the form had hard-coded `undefined`).
- **Optional/mandatory clarity:** `ui/Field.tsx` gained an `optional` prop (muted "optional" tag); a top helper line and a "what's missing" hint below the button; Location + Notes tagged optional.

### 3. Opt-out UI + save-state + change-answer (commit `5fc4a47`)
- **`apps/mobile/src/screens/EventDetail.tsx`:** `CollectingView` gained a distinct, mutually-exclusive **"I can't make it"** row (dashed border, ink check, not the pink `SelectCheck`) wired to `setOptOut`; tapping a time rejoins. Reworked the empty-state copy.
- **Save-state feedback:** the iteration-2 auto-save now drives a `SaveStatus` ("Saving..." spinner -> "Saved - private to you", or "Couldn't save - tap to retry") for both reactions and opt-out; failures are surfaced + retryable (no longer swallowed).
- **Removed the members' manual lock** (pure deadline). A `__DEV__`-only "Force lock now (dev)" button remains for demos; everyone sees a "Locks {when} - the best-supported time wins, automatically" line.
- The moment "Change" link became a clear **"Change answer"** `Chip`.

### 4. Local reminders + dashboard (commit `d695dcc`)
- **`apps/mobile/src/lib/notifications.ts`** (new, `expo-notifications@~0.32.17`): `ensurePermission()` (+ Android channel) and `syncReminders(events)` - cancel-all + reschedule device-local DATE-trigger reminders from `events.mine` ("Locks soon", "Who's in?", "RSVP closing"), suppressed for opted-out/declined plans, signature-guarded so the 5s poll is a no-op unless something changed. Foreground banner handler set.
- **`Dashboard.tsx`:** calls `syncReminders` after each fetch; opted-out collecting plans leave the Action-required tray (`myStatus !== "declined"`) and read "You're sitting this out" with no sticker; cards now show the weekday via `formatSlot` (Felicity: "is it a Monday?").

### 5. Docs (commit `60abc3e`)
- `docs/tech-debt.md`: updated the polling/push entry (local notifications now ship, device-local only) and added: lazy read-triggered phase transitions (now load-bearing for auto-lock), auto-lock ignores quorum, no DB-integration tests in CI, tz-naive `lockAt`.

## Key decisions & rationale
- **Deadline + auto-lock over manual lock** (Tom: "by this date everyone must be locked in"). Removes the asymmetric "someone has to push." Implemented as a *lazy* settle (read-triggered, no scheduler) to match the existing `settlePhase` pattern and keep the server stateless.
- **Pure deadline, no member early-lock; `__DEV__` force-lock for demos** (user's explicit call). Real creators can't insta-lock; the dev button keeps the flow demoable on stage.
- **Lock the best slot anyway under weak support; fizzle only on zero reactions** (user: "lock the best slot anyway for now... think about quorum later"). Keeps plans alive; the zero-reaction fizzle avoids opening an empty moment.
- **Overlap invariant `now < lockAt <= earliest`, moment ends by the event** (`momentEnd` clamp). Prevents the "lock-in date and proposed dates overlap the wrong way" problem the user flagged; `addCandidate` enforces "after the deadline."
- **Opt-out = full, reversible, private exit** (user). Clears reactions (so tally/quorum exclusion is automatic), shows as Declined, no reminders; reacting/responding rejoins. **Fully private** (system-only) - the creator can't distinguish "opted out" from "hasn't looked", consistent with reactions being private and the M3 "no public no" principle.
- **Opt-out UI = a special row that unticks the times** (user's exact spec): "a tickbox called 'I can't make it' with a slightly different style... ticking it unticks all the other boxes." Implemented as a dashed, ink-checked row distinct from the pink time checks.
- **Save-state indicator** (user: live update "feels unresponsive"). Surfaces persistence so a tap is acknowledged; errors now retryable instead of swallowed.
- **Local notifications over remote push** (user, constrained by Expo-Go-no-dev-build). Local scheduled notifications work in Expo Go (SDK 53+ only dropped *remote* push); device-local + seen-only is acceptable for supervised demos.
- **Concrete toggle = Flexible/Fixed** mapping onto the existing `exact`/`options` engine; default **Flexible** (showcases the convergence + deadline path, the iteration's headline). `whenMode` is derived, so the backend is unchanged. Default flagged for veto in the plan; not yet vetoed.
- **`defaultLockAt` in `packages/shared`** (pure + unit-tested, like `candidates.ts`), so the same "evening before, clamped" logic is shared by the server (default) and the create screen (display).
- **Batched the opt-out *backend* into the slice-1 commit** (it shares `events.ts`); the opt-out *UI* stayed in the slice-3 commit. Avoided an unused-import churn and a second pass over `events.ts`.
- **Modular commits** (per a mid-session CLAUDE.md rule the user added): five logical commits instead of one, each leaving the tree building.

## Things learned / discovered
- **`expo-notifications@0.32.17`** (SDK 54): DATE trigger is `{ type: Notifications.SchedulableTriggerInputTypes.DATE, date }`; `NotificationBehavior` now needs `shouldShowBanner`/`shouldShowList` (not the deprecated `shouldShowAlert`). Local scheduled notifications work in Expo Go; only *remote* push was dropped in SDK 53. `expo install` did **not** add a plugin to `app.json` (none needed for Expo Go local notifications).
- **`__DEV__`** is a recognised global in the RN Tս types - no import or declaration needed; it is `true` in Expo Go dev sessions (so the force-lock shows in demos) and stripped from production builds.
- **`drizzle-kit generate` was non-interactive** here because the change was a pure add (new nullable column + new table) - no rename ambiguity to prompt on. Migration `0003_red_the_initiative.sql` + `meta/0003_snapshot.json` + `_journal.json`.
- **jest-expo hangs / does not flush its summary** to a captured output file in this sandbox (it still exits 0 = tests pass). Verified the pure `quickPicks` logic directly via a `tsx` script (8/8) and relied on the jest exit code; do not block on jest stdout here.
- **The harness auto-backgrounds long Bash commands** and blocks plain foreground `sleep`; use an `until <grep>; do sleep N; done` loop or `run_in_background` + the completion notification.
- **API boot is the real runtime check:** `pnpm dev:api` logs `[boot] migrations applied` + `[boot] seeded demo data (reset)` - confirming the new schema + seed work end-to-end. A stale API instance already on port 3000 caused an incidental `EADDRINUSE` (migrate+seed had already succeeded).

## Current state
- All five commits are on **`dev`** (not yet PR'd to `main`). Tip: `60abc3e`.
- **Verified:** `pnpm typecheck` + `pnpm lint` clean (all packages); `packages/shared` 28 tests, `apps/api` 14 tests pass; 20/20 in-process lock-in/opt-out smoke; `defaultLockAt` + `quickPicks` unit-tested; API migrates + reseeds + (would) boot cleanly.
- **Not verified (sandbox can't):** anything on a real device/Expo Go. The interactive flows (auto-lock flipping the screen via polling, local notifications firing, the opt-out row + Saving->Saved, quick-pick prefills, `__DEV__` force-lock, day-of-week, optional/mandatory) need an Expo Go pass.
- **Uncommitted / left for the user:** `CLAUDE.md` (the user's own "commit in modular chunks" edit) and two prior-session summary docs (`...-1553-...`, `...-1822-...`) that this session did not create.
- **Linear:** not updated (MCP not authenticated this session) - DRP_02 issue tracking is stale for this work.

## Conventions, commands & workflows
- **Commit in modular chunks** (new CLAUDE.md rule): commit each self-contained working step as you go; don't pile into one giant commit. Work directly on `dev`; PR `dev` -> `main` to ship.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before any PR. `pnpm format` auto-fixes. **No em dashes** anywhere.
- Install Expo native deps with `pnpm --filter @bethere/mobile exec expo install <pkg>` (SDK-54-compatible). **Do not upgrade Expo above SDK 54.**
- DB: `pnpm db:up` (docker Postgres, host 5433), `pnpm --filter @bethere/api db:generate` / `db:migrate`; API boots with `SEED_ON_BOOT=reset` locally. Backend smoke pattern: a throwaway `appRouter.createCaller({ userId, log })` script run with `pnpm --filter @bethere/api exec tsx <file>`, deleted after.
- Type chain: Zod in `packages/shared` -> tRPC in `apps/api` -> mobile types follow. Mobile pure logic lives in `apps/mobile/src/lib/*` (testable without RN).

## Known issues / caveats / risks
- **Device verification outstanding** - the highest risk; all UI/interaction is unverified on Expo Go.
- **Lazy auto-lock fires only on read** - fine for a supervised demo (5s poll triggers it), but a deadline for a group with no app open won't fire until someone reads it. Needs a scheduler before unsupervised use. (`docs/tech-debt.md`)
- **Local notifications are device-local + seen-only** - a plan created while your app is closed won't remind you until you reopen it; no remote push. (`docs/tech-debt.md`)
- **Auto-lock ignores quorum** ("lock the best anyway") - a plan can lock with thin support; quorum policy deferred. (`docs/tech-debt.md`)
- **No DB-integration tests in CI** - the new server logic is covered only by the (deleted) manual smoke. (`docs/tech-debt.md`)
- **Concrete-toggle default = Flexible** is an assumption, easy to flip if the user prefers fixed-by-default.
- A **stale API process on port 3000** was observed; if doing live testing, kill leftovers first.

## Next steps
1. **Device test in Expo Go (iOS):** local notification fires at a near-term `lockAt`; auto-lock flips collecting -> moment via polling; the "I can't make it" mutual-exclusion + Declined movement; Saving->Saved + error/retry; `__DEV__` force-lock; quick-pick prefills; create-screen optional/mandatory clarity; weekdays on cards.
2. **Decide the concrete-toggle default** (Flexible vs Fixed) with the user.
3. **Update Linear** (DRP_02) once the MCP is authenticated; reference commits `75f09a7`..`60abc3e`.
4. **When ready to ship:** PR `dev` -> `main`.
5. **Next iteration:** "float an idea" - re-enable `fuzzy`, plus anonymous + collaborative-location suggestion (deferred this iteration).

## References
- Plan: `~/.claude/plans/docs-drp-context-interviews-m3-interview-lexical-sprout.md`
- Interviews: `docs/drp-context/interviews/m3 interviews (iteration)/{tom,felicity,luca} interview.txt`
- Backend: `apps/api/src/routers/events.ts` (`settleCollecting`, `momentEnd`, `setOptOut`, `create` lockAt, `addCandidate` guard), `apps/api/src/db/schema.ts` (`events.lockAt`, `eventOptOuts`), `apps/api/src/db/seed-data.ts` / `seed.ts`.
- Shared: `packages/shared/src/logic/lock.ts` (+ test), `packages/shared/src/schemas.ts`.
- Mobile: `apps/mobile/src/screens/CreateEvent.tsx`, `EventDetail.tsx`, `Dashboard.tsx`; `apps/mobile/src/lib/{quickpicks,notifications}.ts` (+ quickpicks test); `apps/mobile/src/ui/Field.tsx`.
- Tech debt: `docs/tech-debt.md`. Prior context: `docs/summary/2026-06-02-1553-iteration-1-2-pickers-and-voting-ux.md`, `ARCHITECTURE.md`, `CLAUDE.md`.
