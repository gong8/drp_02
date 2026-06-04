# Unified Suggest Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the float / flexible / concrete create modes into one create flow and one votable plan that owns a time-candidate list and an activity (what/where) list, both with public +1 counts and hidden names, gated by two creator locks.

**Architecture:** A plan is a single `events` row plus `event_candidates` of two `kind`s (`time`, `activity`); members toggle public per-candidate reactions; the creator optionally locks either list. A `decidesBy` deadline auto-locks the winning time (and resolves the winning activity into the title) and opens the existing blind moment. The float tables, router, and frontend are removed; their behavior folds into `events.*` and the evolved collecting board. Anonymity of the creator is always on (hidden from the group; still authorized server-side via `createdByUserId`).

**Tech Stack:** pnpm workspace; `@bethere/shared` (Zod + pure logic); `@bethere/api` (Fastify + tRPC v11 + Drizzle + Postgres, ESM); `@bethere/mobile` (Expo SDK 54 RN, React Navigation, type-only `AppRouter` import). Tests: node:test (api), vitest/jest per package. Biome lint. Spec: `docs/superpowers/specs/2026-06-04-unified-suggest-flow-design.md`. Tracking: DRP-41.

---

## Canonical contract (every task uses these exact names)

This is the single source of truth for names and shapes across all phases. If a task ever disagrees with this section, this section wins.

### Shared types (`packages/shared/src/schemas.ts`)
- ADD `CandidateKind = z.enum(["time", "activity"])` (replaces `FloatAxis`; `idea` becomes `activity`).
- CHANGE `PlanPhase = z.enum(["collecting","moment","cleared","fizzled"])` (drop `floating`).
- ADD `TimeCandidateInput = z.object({ startsAt: z.string(), partOfDay: PartOfDay.optional() })`.
- REPLACE `CreateEventInput` with:
  - `groupId`, `title?` (max 80), `description?`, `location?`, `timeCandidates?: TimeCandidateInput[]` (max 10), `activityCandidates?: string[]` (max 10, each 1..80), `lockTimes` (default false), `lockThings` (default false), `decidesBy?` (ISO), `quorum?`.
- ADD `ToggleReactionInput = ByEvent.extend({ candidateId: z.string() })` (one public +1 toggle, either kind).
- REPLACE `AddCandidateInput = ByEvent.extend({ kind: CandidateKind, startsAt?: string, partOfDay?: PartOfDay, text?: string })` (time needs `startsAt`; activity needs `text`).
- DELETE `WhenMode`, `WhenInput`, `FloatAxis`, `FloatWindow`, `CreateFloatInput`, `AddIdeaInput`, `AddTimeInput`, `ToggleVoteInput`, `ReactInput`.
- KEEP `ByEvent`, `SetOptOutInput`, `LockInput`, `RespondInput`, `ResolveInput`, `ByIdInput`, group inputs, `ResponseKind`, `Conditional`, `PartOfDay`.

### DB (`apps/api/src/db/schema.ts`) + hand-authored migrations
- `events`: ADD `lockTimes` (bool, notNull, default false), `lockThings` (bool, notNull, default false); RENAME `lock_at` -> `decides_by`; `isAnonymous` default true; DROP `min_heat`, DROP `when_mode`; KEEP `contingent`, `createdByUserId`.
- `event_candidates`: ADD `kind` (`candidate_kind` enum, default `time`); make `starts_at` NULLABLE; reuse `label` for activity text; keep `part_of_day`.
- `candidate_reactions`: shape unchanged; now references both kinds; counts are PUBLIC.
- `plan_phase` enum: drop `floating` (back-migrate to `collecting`, then rebuild the type).
- `float_axis` enum: `ALTER TYPE ... RENAME VALUE 'idea' TO 'activity'; ALTER TYPE float_axis RENAME TO candidate_kind;`.
- DROP `float_suggestions`, `float_votes` (after copying into `event_candidates` / `candidate_reactions`).
- Migrations are HAND-AUTHORED (drizzle-kit generate hangs on renames in non-TTY). Additive first, destructive last. Copy-then-drop. Local reset: `docker compose down -v && pnpm db:up`.

### Backend (`apps/api/src/routers/events.ts`)
- `create`: build `time` candidates (startsAt + partOfDay hint) and `activity` candidates (label=text, startsAt null); `isAnonymous` always true; concrete shortcut = exactly one time candidate AND `lockTimes` => phase `moment` (contingent false) else `collecting` (contingent true); `decidesBy` from input or `defaultDecidesByForCandidates`; title optional.
- `toggleReaction` (NEW, replaces `react`): add/remove one `(eventId, candidateId, userId)` row; public; either kind; adding clears the caller's opt-out.
- `addCandidate` (reshaped): kind-gated by `lockTimes` / `lockThings`; time needs valid deduped `startsAt`; activity needs deduped `text`; adding +1s it for the author.
- `setOptOut`: KEEP.
- `lock`: REMOVE the `isAnonymous` FORBIDDEN guard; authorize by `createdByUserId === ctx.userId`; pick winning time; if `title===''` resolve winning activity into `events.title`; open moment.
- `mine` / `get`: drop `phase==='floating'` early-returns; `isCreator = createdByUserId === ctx.userId` (boolean only, never the id); return PUBLIC per-candidate counts for BOTH kinds; rename `lockAt`->`decidesBy`, `msLeftToLock`->`msLeftToDecide`. `get` returns `timeCandidates[]` and `activityCandidates[]` plus `lockTimes`, `lockThings`, `decidesBy`, `msLeftToDecide`.
- `settleCollecting`: read `decidesBy`; at lock resolve winning activity into the title if empty.
- DELETE `settleFloating`, `FLOAT_STALE_MS`; `settleLifecycle` drops the floating step; DELETE `apps/api/src/routers/floats.ts`; unmount `floats` from `appRouter`.

### Shared logic
- `candidates.ts`: KEEP (kind-agnostic; public count = `userIds.length`).
- `lock.ts`: rename `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`; drop `defaultLockAtForWindow`; `addCandidateHorizon` drops the `isFuzzy` arg (horizon from the time-candidate spread only).
- `reconcile.ts` + `reconcile.test.ts`: DELETE. `reveal.ts`, `resolve.ts`: KEEP.
- `window.ts`: KEEP `PART_HOUR`, `atBand`, `addDays` (reused client-side); DROP `expandWindow`, `Timescale`, `WindowSlot` from the server create path (the wizard resolves part-of-day to concrete candidates client-side).

### Mobile
- DELETE `FloatBoard.tsx`, `NewDial.tsx`, `FloatChip.tsx` (repurpose its look into `src/ui/VoteChip.tsx`), Dashboard `FloatCard`.
- `App.tsx`: remove `NewDial` + `FloatBoard` from `MeetupsStackParams` + Navigator; `CreateWizard` route param becomes `undefined`; Dashboard "New meetup" goes straight to `CreateWizard`.
- `CreateWizard.tsx`: one flow - group -> activities -> times -> options (`lockTimes`/`lockThings` + editable "Decides by") -> confirm mirror; one `trpc.events.create` call.
- `EventDetail.tsx` CollectingView: render time AND activity lists with public +1 (`VoteChip`, `trpc.events.toggleReaction`); gated "+ add a time" / "+ add a place/thing" (`trpc.events.addCandidate`); anonymity footer; "decides by" countdown.
- `Dashboard.tsx`: remove `floats.mine`, `FloatCard`, Brewing band. `notifications.ts`: drop float scheduling.
- Vocabulary: auto-tips/Brewing/spark/"the moment" -> "Decides by"/"Catching on"/"what do you fancy?"/"who's in?". `lockAt`->`decidesBy`, `msLeftToLock`->`msLeftToDecide`.

### Commands
- Typecheck: `pnpm typecheck` (or `pnpm --filter @bethere/<pkg> typecheck`).
- Tests: `pnpm --filter @bethere/shared test`, `pnpm --filter @bethere/api test`. Mobile jest leaks a handle and hangs the aggregate `pnpm test`; run per package and `pkill -f jest` afterward.
- DB: hand-author migrations; `pnpm --filter @bethere/api db:migrate`; local reset `docker compose down -v && pnpm db:up`.
- Lint: `pnpm lint` / `pnpm format`.
- Branch: `feat/*` off `dev`, PR into `dev`. Frontend + backend + shared land in ONE PR (trpc type chain couples them).

---

## File structure (what each touched file is responsible for)

- `packages/shared/src/schemas.ts` - the unified network contract (one create input, one reaction toggle, one add-candidate input, `CandidateKind`, shrunk `PlanPhase`).
- `packages/shared/src/logic/lock.ts` - the single `decidesBy` default + candidate horizon (no fuzzy branch).
- `packages/shared/src/logic/candidates.ts` - kind-agnostic tally/winner picking (unchanged).
- `apps/api/src/db/schema.ts` - the reshaped tables (locks, candidate `kind`, nullable time, public reactions).
- `apps/api/migrations/*` - the additive then destructive hand-authored SQL.
- `apps/api/src/routers/events.ts` - the one plan router (create, toggleReaction, addCandidate, setOptOut, lock, mine, get, respond, resolve, settle\*).
- `apps/api/src/router.ts` - app router with `floats` unmounted.
- `apps/api/src/db/seed-data.ts` / `seed.ts` - the demo plan as a dual-list collecting plan.
- `apps/mobile/App.tsx` - navigation without the dial / float board / branch param.
- `apps/mobile/src/screens/CreateWizard.tsx` - the single create flow + confirm mirror.
- `apps/mobile/src/screens/EventDetail.tsx` - the unified voting board (time + activity, public +1, gated add).
- `apps/mobile/src/screens/Dashboard.tsx` - dashboard without the Brewing band.
- `apps/mobile/src/ui/VoteChip.tsx` - the public +1 chip (repurposed from `FloatChip`).
- `README.md`, `CLAUDE.md`, `ARCHITECTURE.md` - the one-flow/two-locks description.

---

## Execution order (foundation-first; build stays green at each commit)

1. Phase 1 (shared) additive: new types alongside old, nothing consumes them yet.
2. Phase 2 (DB) additive migration: columns, `kind`, copy float data, back-migrate phase; no drops.
3. Phase 3 (backend) extend `events.*` to the unified contract, flip counts public, creator-self lock; keep `floats` mounted-but-redundant so typecheck stays green.
4. Phases 3 (deletions) + 4 + 5 land together (this is where `trpc.floats.*` leaves the type chain): delete float backend + frontend, switch the wizard and board.
5. Phase 1 cleanup: remove the now-dead shared schemas, vocabulary sweep.
6. Phase 2 destructive migration: drop float tables, `min_heat`, `when_mode`; rebuild `plan_phase`.
7. Phase 6 seed + tests; Phase 7 docs. Run lint + typecheck + per-package tests before the PR.

---

<!-- TASK PHASES APPENDED BELOW FROM DRAFTING -->

## Phase 1: Shared schemas + logic

This is the FOUNDATION phase for the unified-suggest refactor. It edits only `packages/shared`. The strategy is additive-first: new symbols are added and the dead-but-still-imported ones are kept until the very last task of this phase, so that `pnpm --filter @bethere/shared typecheck` and `pnpm --filter @bethere/shared test` stay green throughout. The API and mobile consumers (`apps/api/src/routers/events.ts`, `floats.ts`, `db/seed-data.ts`, `apps/mobile/...`) still import the soon-to-be-deleted symbols; those are migrated in later phases. Phase 1 leaves the shared package self-consistently green even though the aggregate `pnpm typecheck` will still fail until consumers switch - that is expected and called out at the phase boundary.

All commands run from the repo root `/Users/gong/Programming/drp_02`. No em dashes anywhere.

### Task 1.1: Add `CandidateKind` enum and shrink `PlanPhase`

**Files:**
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/schemas.ts` (add `CandidateKind` near line 22; edit `PlanPhase` at line 37)

- [ ] **Step 1: Add the `CandidateKind` enum.** In `/Users/gong/Programming/drp_02/packages/shared/src/schemas.ts`, immediately AFTER the `PartOfDay` block (after line 17, before the existing `FloatAxis` block at line 19), insert:
  ```ts
  // The two candidate lists a unified plan owns: a "time" (a concrete instant) or an "activity" (a
  // fused what+where). Single source of truth for the DB candidate_kind enum and the mobile mirror.
  // Replaces the old FloatAxis (idea -> activity).
  export const CandidateKind = z.enum(["time", "activity"]);
  export type CandidateKind = z.infer<typeof CandidateKind>;
  ```
  Leave the old `FloatAxis` declaration (lines 19-22) in place for now - it is deleted in Task 1.6.

- [ ] **Step 2: Shrink `PlanPhase` to drop `floating`.** Replace the `PlanPhase` block (lines 33-38) with:
  ```ts
  // A plan's lifecycle. An exact, locked-time plan opens straight into `moment`; every other plan
  // starts `collecting` public +1s, then a lock (creator or the auto "decides by") opens the
  // `moment`, which ends `cleared` (quorum committed) or `fizzled` (not - silent for contingent).
  export const PlanPhase = z.enum(["collecting", "moment", "cleared", "fizzled"]);
  export type PlanPhase = z.infer<typeof PlanPhase>;
  ```

- [ ] **Step 3: Typecheck the shared package.** Run:
  ```bash
  pnpm --filter @bethere/shared typecheck
  ```
  Expected: PASS (exit 0). `CandidateKind` is additive; dropping `"floating"` from the enum value list does not break the shared package's own code (no shared file references the literal `"floating"`).

- [ ] **Step 4: Commit.**
  ```bash
  git add packages/shared/src/schemas.ts && git commit -m "feat(shared): add CandidateKind enum, drop floating from PlanPhase (DRP-41)"
  ```

### Task 1.2: Add the new unified create inputs (`TimeCandidateInput`, `CreateEventInput`)

The contract REPLACES the existing `CreateEventInput` (lines 53-67). Because the old shape is still imported by `apps/api` and `apps/mobile`, we replace it in this same task (it is a same-named export, so consumers keep compiling against the name; their field usage breaks in later phases, not in shared's own typecheck).

**Files:**
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/schemas.ts` (replace `CreateEventInput` lines 53-67; the old `WhenInput` at lines 40-51 stays until Task 1.6)

- [ ] **Step 1: Replace `CreateEventInput` with the unified shape and add `TimeCandidateInput`.** Replace the entire block at lines 53-67 (the comment line `// Network boundary for events.create ...` through `export type CreateEventInput = z.infer<typeof CreateEventInput>;`) with:
  ```ts
  // One time candidate the wizard sends: a concrete instant plus an optional part-of-day hint (the
  // wizard resolves part-of-day chips to concrete days CLIENT-side, so the server only sees instants).
  export const TimeCandidateInput = z.object({
    startsAt: z.string(),
    partOfDay: PartOfDay.optional(),
  });
  export type TimeCandidateInput = z.infer<typeof TimeCandidateInput>;

  // Network boundary for events.create - ONE unified flow. A plan owns two candidate lists, TIME and
  // ACTIVITY, both optional. Two creator locks (default false = open) decide who may add to each list.
  // `decidesBy` is the editable auto-lock instant; `quorum` defaults server-side.
  export const CreateEventInput = z.object({
    groupId: z.string(),
    title: z.string().max(80).optional(),
    description: z.string().max(500).optional(),
    location: z.string().max(120).optional(),
    timeCandidates: z.array(TimeCandidateInput).max(10).optional(),
    activityCandidates: z.array(z.string().min(1).max(80)).max(10).optional(),
    lockTimes: z.boolean().optional().default(false),
    lockThings: z.boolean().optional().default(false),
    decidesBy: z.string().optional(),
    quorum: z.number().int().min(1).max(50).optional(),
  });
  export type CreateEventInput = z.infer<typeof CreateEventInput>;
  ```
  Note: `WhenInput` (lines 40-51) is referenced by the OLD `CreateEventInput` only; once removed here it is unused inside shared but is still imported by consumers, so leave its declaration until Task 1.6.

- [ ] **Step 2: Typecheck the shared package.** Run:
  ```bash
  pnpm --filter @bethere/shared typecheck
  ```
  Expected: PASS. `PartOfDay` (line 16) is in scope; `z.array(...).max(10)`, `.optional().default(false)` are valid Zod v3. `WhenInput` being declared-but-unused inside shared is not a type error (it is an exported symbol).

- [ ] **Step 3: Commit.**
  ```bash
  git add packages/shared/src/schemas.ts && git commit -m "feat(shared): unified CreateEventInput + TimeCandidateInput (DRP-41)"
  ```

### Task 1.3: Reshape the per-event inputs (`ToggleReactionInput`, `AddCandidateInput`)

`AddCandidateInput` already exists at lines 84-87 (the old time-only shape); it is reshaped in place. `ToggleReactionInput` is brand new. `ReactInput` (lines 76-80) is still imported by `apps/api` so it stays until Task 1.6.

**Files:**
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/schemas.ts` (reshape `AddCandidateInput` lines 82-87; add `ToggleReactionInput`)

- [ ] **Step 1: Add `ToggleReactionInput` and reshape `AddCandidateInput`.** Replace the existing `AddCandidateInput` block (lines 82-87, the comment `// Network boundary for events.addCandidate ...` through `export type AddCandidateInput = z.infer<typeof AddCandidateInput>;`) with:
  ```ts
  // Network boundary for events.toggleReaction - ONE public +1 toggle on a single candidate of EITHER
  // kind. Inserting/removing the caller's row; counts are public during collecting (momentum).
  export const ToggleReactionInput = ByEvent.extend({ candidateId: z.string() });
  export type ToggleReactionInput = z.infer<typeof ToggleReactionInput>;

  // Network boundary for events.addCandidate - any member adds to a list while collecting, kind-gated
  // server-side by the creator's locks. A "time" candidate needs `startsAt` (+ optional partOfDay
  // hint); an "activity" candidate needs `text`. Adding a candidate +1s it for the author.
  export const AddCandidateInput = ByEvent.extend({
    kind: CandidateKind,
    startsAt: z.string().optional(),
    partOfDay: PartOfDay.optional(),
    text: z.string().min(1).max(80).optional(),
  });
  export type AddCandidateInput = z.infer<typeof AddCandidateInput>;
  ```
  `CandidateKind` is defined above (Task 1.1) so it is in scope; `ByEvent` is at line 72.

- [ ] **Step 2: Typecheck the shared package.** Run:
  ```bash
  pnpm --filter @bethere/shared typecheck
  ```
  Expected: PASS. The reshaped `AddCandidateInput` keeps the same export name; `apps/api`'s usage breaks only in its own typecheck (later phase), not in shared.

- [ ] **Step 3: Commit.**
  ```bash
  git add packages/shared/src/schemas.ts && git commit -m "feat(shared): add ToggleReactionInput, reshape AddCandidateInput to kind-gated (DRP-41)"
  ```

### Task 1.4: Rename `defaultLockAtForOptions` -> `defaultDecidesByForCandidates` and drop the `isFuzzy` branch from `addCandidateHorizon`

The contract: rename `defaultLockAtForOptions`->`defaultDecidesByForCandidates`; DROP `defaultLockAtForWindow` (deleted in Task 1.5 once the reconcile/window cluster goes); make `addCandidateHorizon` compute the options-style horizon with no `isFuzzy` boolean. To keep shared green during the rename, the rename is TDD-driven against `lock.test.ts`, and we keep `defaultLockAtForWindow` and `addCandidateHorizon` callable for now (their tests are trimmed in this task).

**Files:**
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.ts` (rename function line 18; rewrite `addCandidateHorizon` lines 58-66)
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.test.ts` (update imports and `describe` blocks)

- [ ] **Step 1: Update the test to drive the rename and the new `addCandidateHorizon` signature (failing test).** In `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.test.ts`:
  - Replace the import block (lines 2-8) with:
    ```ts
    import {
      addCandidateHorizon,
      DAY_MS,
      defaultDecidesByForCandidates,
      defaultLockAtForWindow,
      MAX_REACT_MS,
    } from "./lock.js";
    ```
  - Rename the first `describe` (line 14) from `"defaultLockAtForOptions"` to `"defaultDecidesByForCandidates"`, and replace every call of `defaultLockAtForOptions(` inside it (lines 18, 24, 30, 38) with `defaultDecidesByForCandidates(`.
  - Replace the entire `describe("addCandidateHorizon", ...)` block (lines 68-85) with the no-`isFuzzy` form:
    ```ts
    describe("addCandidateHorizon", () => {
      it("allows a small slack past the spread, capped at two days", () => {
        const earliest = now + DAY_MS;
        const latest = now + 3 * DAY_MS; // span 2 days
        expect(addCandidateHorizon(earliest, latest)).toBe(latest + 2 * DAY_MS);
        const tight = now + DAY_MS + HOUR; // span 1h -> slack 1h
        expect(addCandidateHorizon(now + DAY_MS, tight)).toBe(tight + HOUR);
        // span = 5d -> slack capped at 2d, not 5d
        const wide = now + 6 * DAY;
        expect(addCandidateHorizon(now + DAY, wide)).toBe(wide + 2 * DAY);
      });
    });
    ```

- [ ] **Step 2: Run the test (expected FAIL).** Run:
  ```bash
  pnpm --filter @bethere/shared test lock
  ```
  Expected: FAIL - vitest reports `defaultDecidesByForCandidates is not exported` (or `is not a function`) and an arity error on `addCandidateHorizon` (the old impl still requires the `isFuzzy` arg).

- [ ] **Step 3: Implement the rename in `lock.ts`.** In `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.ts`, rename the function at line 18. Replace:
  ```ts
  export function defaultLockAtForOptions(
  ```
  with:
  ```ts
  export function defaultDecidesByForCandidates(
  ```
  and update its doc comment (lines 13-17) to:
  ```ts
  /**
   * Default "decides by" instant for a collecting plan, anchored to its earliest TIME candidate. The
   * notice lead scales as a third of the time-to-earliest (so the active reacting phase gets the
   * larger share) and caps at one day. Returns an instant strictly in (now, earliest).
   */
  ```

- [ ] **Step 4: Rewrite `addCandidateHorizon` to drop `isFuzzy`.** Replace the whole `addCandidateHorizon` block (lines 53-66) with:
  ```ts
  /**
   * Upper bound (epoch ms) for a member-added TIME candidate. Allows a small slack past the creator's
   * spread - the spread length, capped at two days - so a member can suggest a slightly later time
   * without an absurd jump. (The old fuzzy/window branch is gone: the wizard sends concrete times.)
   */
  export function addCandidateHorizon(earliestMs: number, latestMs: number): number {
    const span = latestMs - earliestMs;
    return latestMs + Math.min(span, 2 * DAY_MS);
  }
  ```
  Leave `defaultLockAtForWindow` (lines 40-51) untouched in this task - it is deleted in Task 1.5.

- [ ] **Step 5: Run the test (expected PASS).** Run:
  ```bash
  pnpm --filter @bethere/shared test lock
  ```
  Expected: PASS - all `defaultDecidesByForCandidates`, `defaultLockAtForWindow`, and the new single-arg `addCandidateHorizon` cases green.

- [ ] **Step 6: Commit.**
  ```bash
  git add packages/shared/src/logic/lock.ts packages/shared/src/logic/lock.test.ts && git commit -m "refactor(shared): defaultLockAtForOptions -> defaultDecidesByForCandidates, drop addCandidateHorizon isFuzzy (DRP-41)"
  ```

### Task 1.5: Delete the float-only logic (`reconcile.ts` + its test) and drop `defaultLockAtForWindow`

`reconcile.ts` is float-only and superseded by `settleCollecting`'s most-voted-wins (handled in the API phase). `defaultLockAtForWindow` is the fuzzy default-deadline helper, no longer needed once the server fuzzy path is gone. Both are still imported by `apps/api`, so deleting them here makes the AGGREGATE typecheck red - that is expected and resolved in the API phase. We delete them here because the barrel (Task 1.6) must not re-export a removed file.

**Files:**
- Delete `/Users/gong/Programming/drp_02/packages/shared/src/logic/reconcile.ts`
- Delete `/Users/gong/Programming/drp_02/packages/shared/src/logic/reconcile.test.ts`
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.ts` (remove `defaultLockAtForWindow`, lines 34-51; remove now-unused constants if orphaned)
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.test.ts` (remove the `defaultLockAtForWindow` describe block + import)

- [ ] **Step 1: Delete the reconcile files.** Run:
  ```bash
  git rm packages/shared/src/logic/reconcile.ts packages/shared/src/logic/reconcile.test.ts
  ```

- [ ] **Step 2: Remove `defaultLockAtForWindow` from `lock.test.ts`.** In `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.test.ts`:
  - In the import block, remove the `defaultLockAtForWindow,` line and the `MAX_REACT_MS,` line (both become unused).
  - Delete the entire `describe("defaultLockAtForWindow", ...)` block (the 25-line block running from `describe("defaultLockAtForWindow"` through its closing `});`).
  The remaining import block should read:
  ```ts
  import { addCandidateHorizon, DAY_MS, defaultDecidesByForCandidates } from "./lock.js";
  ```

- [ ] **Step 3: Remove `defaultLockAtForWindow` and orphaned constants from `lock.ts`.** In `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.ts`:
  - Delete the entire `defaultLockAtForWindow` function and its doc comment (lines 34-51).
  - Delete the now-unused constants `MIN_REACT_MS` (line 3) and `MAX_REACT_MS` (line 4) - they were used only by `defaultLockAtForWindow`. Verify nothing else uses them first:
    ```bash
    grep -rn "MIN_REACT_MS\|MAX_REACT_MS" packages/shared/src
    ```
    Expected after deletion: no remaining references in `packages/shared/src`. (`DAY_MS`, `MOMENT_MS`, `DEFAULT_MOMENT_MINUTES`, `clamp` are still used and stay.)

- [ ] **Step 4: Run the shared tests (expected PASS).** Run:
  ```bash
  pnpm --filter @bethere/shared test
  ```
  Expected: PASS - reconcile tests gone, `lock.test.ts` green, `candidates`/`window`/`resolve`/`reveal` untouched and green. (`window.test.ts` still tests `expandWindow`, which we keep - see contract: `expandWindow`/`Timescale` are dropped from the server CREATE path but the function and tests are left for now; their removal, if any, is out of scope for this foundation phase since `PART_HOUR`/`atBand`/`addDays` must stay and the mobile mirror reuses them.)

- [ ] **Step 5: Commit.**
  ```bash
  git add packages/shared/src/logic/lock.ts packages/shared/src/logic/lock.test.ts && git commit -m "refactor(shared): delete reconcile.ts + test, drop defaultLockAtForWindow + react-window constants (DRP-41)"
  ```

### Task 1.6: Delete the dead schemas and fix the barrel

Now flip the remaining dead declarations. The contract DELETE list: `WhenMode`, `WhenInput`, `FloatAxis`, `FloatWindow`, `CreateFloatInput`, `AddIdeaInput`, `AddTimeInput`, `ToggleVoteInput`, `ReactInput`. KEEP: `ByEvent`, `SetOptOutInput`, `LockInput`, `RespondInput`, `ResolveInput`, `ByIdInput`, group inputs, `ResponseKind`, `Conditional`, `PartOfDay`, `Timescale`. `Timescale` is KEPT (it is still imported by `window.ts` for `expandWindow`, which remains). The barrel must stop re-exporting `reconcile.js`.

**Files:**
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/schemas.ts` (delete dead schema blocks)
- Modify `/Users/gong/Programming/drp_02/packages/shared/src/index.ts` (remove the `reconcile.js` re-export, line 3)

- [ ] **Step 1: Fix the barrel.** In `/Users/gong/Programming/drp_02/packages/shared/src/index.ts`, delete line 3:
  ```ts
  export * from "./logic/reconcile.js";
  ```
  The remaining file is:
  ```ts
  export * from "./logic/candidates.js";
  export * from "./logic/lock.js";
  export * from "./logic/resolve.js";
  export * from "./logic/reveal.js";
  export * from "./logic/window.js";
  export * from "./schemas.js";
  ```

- [ ] **Step 2: Delete `FloatAxis` and `WhenMode`.** In `/Users/gong/Programming/drp_02/packages/shared/src/schemas.ts`:
  - Delete the `FloatAxis` block (the `// The two axes of a float's suggestion chips ...` comment through `export type FloatAxis = z.infer<typeof FloatAxis>;`, originally lines 19-22).
  - Delete the `WhenMode` block (the `// How precisely the creator pinned the when ...` comment through `export type WhenMode = z.infer<typeof WhenMode>;`, originally lines 28-31).
  Keep `Timescale` (originally lines 24-26) - it is consumed by `window.ts`.

- [ ] **Step 3: Delete `WhenInput`.** Delete the `WhenInput` discriminated-union block (the `// The when the creator expresses at creation ...` comment through `export type WhenInput = z.infer<typeof WhenInput>;`, originally lines 40-51).

- [ ] **Step 4: Delete `ReactInput`.** Delete the `ReactInput` block (the `// Network boundary for events.react ...` comment through `export type ReactInput = z.infer<typeof ReactInput>;`, originally lines 75-80).

- [ ] **Step 5: Delete the float input cluster.** Delete, in order, these four blocks near the end of the file (originally lines 142-172):
  - `FloatWindow` (`// The loose window a float lives in ...` through `export type FloatWindow = z.infer<typeof FloatWindow>;`)
  - `CreateFloatInput` (`// Network boundary for floats.create ...` through `export type CreateFloatInput = z.infer<typeof CreateFloatInput>;`)
  - `AddIdeaInput` (`// Network boundary for floats.addIdea ...` through `export type AddIdeaInput = z.infer<typeof AddIdeaInput>;`)
  - `AddTimeInput` (`// Network boundary for floats.addTime ...` through `export type AddTimeInput = z.infer<typeof AddTimeInput>;`)
  - `ToggleVoteInput` (`// Network boundary for floats.toggleVote ...` through `export type ToggleVoteInput = z.infer<typeof ToggleVoteInput>;`)

- [ ] **Step 6: Confirm no dangling references inside shared.** Run:
  ```bash
  grep -rn "FloatAxis\|WhenMode\|WhenInput\|ReactInput\|FloatWindow\|CreateFloatInput\|AddIdeaInput\|AddTimeInput\|ToggleVoteInput\|reconcileFloat\|defaultLockAtForWindow\|defaultLockAtForOptions" packages/shared/src
  ```
  Expected: NO output (every deleted symbol is gone from shared; the only `addCandidateHorizon`/`defaultDecidesByForCandidates` references remain and are not in the grep). If `ByIdInput`'s comment still mentions `floats.get`, update that comment to drop the float reference (cosmetic, no type impact).

- [ ] **Step 7: Typecheck + test the shared package.** Run:
  ```bash
  pnpm --filter @bethere/shared typecheck && pnpm --filter @bethere/shared test
  ```
  Expected: BOTH PASS. Shared is now internally self-consistent on the unified contract.

- [ ] **Step 8: Confirm the expected aggregate breakage is consumer-only.** Run:
  ```bash
  pnpm typecheck 2>&1 | tail -40
  ```
  Expected: FAIL, but ONLY in `apps/api` and `apps/mobile` (e.g. `events.ts` / `floats.ts` / `seed-data.ts` / `CreateWizard.tsx` / `EventDetail.tsx` cannot find `ReactInput`, `reconcileFloat`, `defaultLockAtForOptions`, `WhenMode`, etc.). This is the deliberate hand-off: the type chain is now red until the API and mobile phases switch consumers. Note this in the Linear issue as the Phase 1 -> Phase 2 boundary; do NOT attempt to fix consumers here.

- [ ] **Step 9: Commit.**
  ```bash
  git add packages/shared/src/schemas.ts packages/shared/src/index.ts && git commit -m "feat(shared)!: delete float/whenMode/react schemas, drop reconcile from barrel (DRP-41)"
  ```

---

Phase 1 exit state: `packages/shared` typechecks and tests green on the unified contract; the new canonical names `CandidateKind`, `TimeCandidateInput`, `CreateEventInput`, `ToggleReactionInput`, `AddCandidateInput`, `defaultDecidesByForCandidates`, and the single-arg `addCandidateHorizon` are exported; `PlanPhase` no longer has `floating`; `reconcile.ts`/`defaultLockAtForWindow`/the float input cluster are gone. The aggregate `pnpm typecheck` is intentionally red on `apps/api` + `apps/mobile` only, to be cleared by the DB/backend and mobile phases.

Note for the plan author: replace `DRP-41` in every commit message with the real Linear issue id before execution.

---

## Phase 2: DB schema + hand-authored migration

Two hand-authored forward migrations are appended to `apps/api/src/db/migrations/`: `0005` (additive + copy + back-migrate, runs BEFORE the code switch) and `0006` (destructive, runs AFTER the code switch is merged and deployed). The runtime migrator (`drizzle-orm/node-postgres/migrator` in `apps/api/src/index.ts:95`) is driven entirely by `meta/_journal.json` plus the raw `.sql` files - it does NOT read the `meta/*_snapshot.json` files at runtime (those only feed `drizzle-kit generate`'s diffing). So we hand-author the `.sql` AND append journal entries by hand; `drizzle-kit generate` is NEVER run (it HANGS in a non-TTY on the `idea`->`activity` value rename and the `lock_at`->`decides_by` column rename, unable to tell a rename from a drop+create).

Drizzle splits one migration file into statements on the literal token `--> statement-breakpoint`; each statement runs separately, so every standalone SQL statement below MUST be followed by `--> statement-breakpoint` except the last.

### Task 2.1: Author migration 0005 - additive columns, enum, copy, back-migrate

This migration is non-destructive and safe to run against live data (`SEED_ON_BOOT=if-empty`). It must land and deploy BEFORE the code switch removes float reads, because the old code still reads `float_axis`/`min_heat`/`when_mode`/`floating`. Order within the file: rename enum type+value -> add `event_candidates.kind` + make `starts_at` nullable -> add `events` columns + rename `lock_at` -> copy float data -> back-migrate `floating` rows.

**Files:**
- Create: `apps/api/src/db/migrations/0005_unify_suggest_additive.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json` (append entry idx 5)

Steps:

- [ ] **Step 1: Write the 0005 SQL file.** Create `apps/api/src/db/migrations/0005_unify_suggest_additive.sql` with EXACTLY this content (note: `ALTER TYPE ... RENAME VALUE` and `RENAME TO` cannot run inside the same transaction block as a later use of the renamed type in some PG versions, but drizzle's migrator wraps each statement-breakpoint chunk in its own statement, not one giant txn - so splitting on breakpoints is sufficient):

```sql
-- Unify float (fuzzy) / flexible / concrete into one votable plan.
-- ADDITIVE + COPY + BACK-MIGRATE only. Destructive drops are deferred to 0006,
-- which runs only after the code switch is merged + deployed. Safe under SEED_ON_BOOT=if-empty.

-- 1. float_axis enum -> candidate_kind, value 'idea' -> 'activity'. Rename in place so existing
--    columns typed on it (event_candidates.kind below) keep working; PG ALTER TYPE handles this.
ALTER TYPE "public"."float_axis" RENAME VALUE 'idea' TO 'activity';--> statement-breakpoint
ALTER TYPE "public"."float_axis" RENAME TO "candidate_kind";--> statement-breakpoint

-- 2. event_candidates: add kind (default 'time' - existing rows are all concrete time candidates),
--    make starts_at NULLABLE (activity candidates carry text in `label`, no time).
ALTER TABLE "event_candidates" ADD COLUMN "kind" "candidate_kind" DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_candidates" ALTER COLUMN "starts_at" DROP NOT NULL;--> statement-breakpoint

-- 3. events: add lock flags (default false = open), rename lock_at -> decides_by.
ALTER TABLE "events" ADD COLUMN "lock_times" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lock_things" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "lock_at" TO "decides_by";--> statement-breakpoint

-- 4. Copy float_suggestions -> event_candidates. TIME suggestions become kind 'time' (startsAt set);
--    IDEA suggestions become kind 'activity' (label = text, startsAt NULL). axis was renamed to the
--    candidate_kind type, whose 'idea' value is now 'activity', so axis already reads 'time'/'activity'.
INSERT INTO "event_candidates" ("id", "event_id", "starts_at", "part_of_day", "label", "kind")
SELECT "id", "event_id", "starts_at", "part_of_day", "text", "axis"
FROM "float_suggestions";--> statement-breakpoint

-- 5. Copy float_votes -> candidate_reactions. suggestion_id maps 1:1 to the copied candidate id.
INSERT INTO "candidate_reactions" ("event_id", "candidate_id", "user_id")
SELECT "event_id", "suggestion_id", "user_id"
FROM "float_votes";--> statement-breakpoint

-- 6. Back-migrate phase: floating plans (former floats) now collect like everything else.
UPDATE "events" SET "phase" = 'collecting' WHERE "phase" = 'floating';
```

- [ ] **Step 2: Append the journal entry for 0005.** Edit `apps/api/src/db/migrations/meta/_journal.json`: inside the `entries` array, after the `0004_parched_rage` object (idx 4), add a comma then this object. Use a `when` value strictly greater than `1780432796787` (e.g. `1780500000000`):

```json
    {
      "idx": 5,
      "version": "7",
      "when": 1780500000000,
      "tag": "0005_unify_suggest_additive",
      "breakpoints": true
    }
```

  (No `meta/0005_snapshot.json` is needed - the runtime migrator ignores snapshots; only `drizzle-kit generate` would, and we never run it.)

- [ ] **Step 3: Reset the local DB and apply.** drizzle-kit generate is never run; apply the hand-authored file directly:

```bash
docker compose -f /Users/gong/Programming/drp_02/docker-compose.yml down -v && pnpm --filter @bethere/api db:up 2>/dev/null; pnpm db:up
```
  then from repo root:
```bash
pnpm --filter @bethere/api db:migrate
```
  Expected: drizzle-kit migrate logs applying `0005_unify_suggest_additive` with no error and exits 0. (If `db:up` is a root script, just `pnpm db:up`; the contract's local-reset command is `docker compose down -v && pnpm db:up`.)

- [ ] **Step 4: Verify the additive shape applied.** Run a psql check (host port 5433, creds from drizzle.config default `postgres://drp:drp@localhost:5433/drp`):

```bash
PGPASSWORD=drp psql -h localhost -p 5433 -U drp -d drp -c "\d event_candidates" -c "\d events" -c "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=pg_enum.enumtypid WHERE pg_type.typname='candidate_kind' ORDER BY enumsortorder;"
```
  Expected: `event_candidates` has a `kind` column of type `candidate_kind` and `starts_at` shown nullable (no `not null`); `events` has `lock_times`, `lock_things`, `decides_by` (and NO `lock_at`); the enum lists `time` and `activity` (NOT `idea`). FAIL means re-check the SQL.

- [ ] **Step 5: Commit migration 0005.**
```bash
git -C /Users/gong/Programming/drp_02 add apps/api/src/db/migrations/0005_unify_suggest_additive.sql apps/api/src/db/migrations/meta/_journal.json && git -C /Users/gong/Programming/drp_02 commit -m "feat(db): 0005 additive migration for unified suggest flow (DRP)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: Update drizzle schema.ts to match the post-0005 shape

The Drizzle schema must reflect the live columns the code reads. This is the additive-compatible shape (float tables still declared so old code typechecks until the code switch lands; they are deleted in Task 2.4 alongside 0006). Line numbers below are from the current `apps/api/src/db/schema.ts`.

**Files:**
- Modify: `apps/api/src/db/schema.ts`

Steps:

- [ ] **Step 1: Rename `floatAxisEnum` to `candidateKindEnum` with new values.** Replace line 30:
```ts
// Which list a candidate sits on: a concrete TIME, or a free-text ACTIVITY (what/where, fused).
export const candidateKindEnum = pgEnum("candidate_kind", ["time", "activity"]);
```
  (Removes `floatAxisEnum`/`float_axis`/`idea`. The DB type was renamed in 0005, so name + values now match.)

- [ ] **Step 2: Add `kind` to `eventCandidates` and make `startsAt` nullable.** Replace the `eventCandidates` table body (lines 99-107) with:
```ts
export const eventCandidates = pgTable("event_candidates", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  // TIME candidates set startsAt; ACTIVITY candidates leave it null and use `label` for the text.
  kind: candidateKindEnum("kind").notNull().default("time"),
  startsAt: timestamp("starts_at"),
  partOfDay: partOfDayEnum("part_of_day"),
  label: text("label"),
});
```

- [ ] **Step 3: Add lock flags + rename `lockAt` -> `decidesBy` on `events`; flip `isAnonymous` default to true.** In the `events` table (lines 63-95): change line 83 `isAnonymous` default from `.default(false)` to `.default(true)`; replace line 90 `lockAt: timestamp("lock_at"),` with the lock flags + decidesBy:
```ts
  lockTimes: boolean("lock_times").notNull().default(false),
  lockThings: boolean("lock_things").notNull().default(false),
  // Editable "Decides by" deadline. When collecting auto-locks the winning candidates and opens the
  // moment. Null until set. Drives the deadline + auto-lock; settled lazily on read. (was lock_at)
  decidesBy: timestamp("decides_by"),
```
  Leave `minHeat` (line 86) and `whenMode` (line 77) in place for now - 0005 has NOT dropped those columns yet, so the schema must still declare them or the code reading them breaks. They are removed in Task 2.4 with 0006.

- [ ] **Step 4: Typecheck the shared+api chain compiles against the new schema names.** This will surface every call site still using `lockAt`/`floatAxisEnum` (those are fixed in Phase 3/4, expected here):
```bash
pnpm --filter @bethere/api typecheck
```
  Expected at THIS step: FAIL with errors only about `lockAt`/`floatAxisEnum`/`whenMode` usages in `routers/events.ts`, `routers/floats.ts`, `db/seed.ts` (the renamed/removed identifiers). No errors should reference `schema.ts` itself. Those call-site errors are resolved in later phases - do NOT fix them here. (If schema.ts itself errors, the edit is wrong.)

- [ ] **Step 5: Commit the schema additive edits.**
```bash
git -C /Users/gong/Programming/drp_02 add apps/api/src/db/schema.ts && git -C /Users/gong/Programming/drp_02 commit -m "feat(db): schema kind/decidesBy/lock flags to match 0005 (DRP)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2.3: Author migration 0006 - destructive drops + rebuild plan_phase

This migration is destructive and MUST NOT be committed-and-run until the code switch (Phases 3-5: backend no longer reads `float_suggestions`/`float_votes`/`min_heat`/`when_mode`, and no row is ever written with phase `floating`) has landed on the branch. Sequence it as the LAST migration so the float data copied in 0005 is dropped only after the new code is reading from `event_candidates`/`candidate_reactions`. Postgres cannot `DROP` an enum value, so `plan_phase` is rebuilt: create a new enum, swap the column over, drop the old type, rename the new one back.

**Files:**
- Create: `apps/api/src/db/migrations/0006_unify_suggest_destructive.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json` (append entry idx 6)

Steps:

- [ ] **Step 1: Write the 0006 SQL file.** Create `apps/api/src/db/migrations/0006_unify_suggest_destructive.sql` with EXACTLY:

```sql
-- Destructive half of the unified-suggest migration. Run ONLY after the code switch is deployed:
-- by now nothing reads float_suggestions / float_votes / min_heat / when_mode, and no row is ever
-- written with phase 'floating'. 0005 already copied float data into event_candidates / candidate_reactions.

-- 1. Drop float tables (votes first - FK to suggestions). Data already copied in 0005.
DROP TABLE "float_votes";--> statement-breakpoint
DROP TABLE "float_suggestions";--> statement-breakpoint

-- 2. Drop dead event columns.
ALTER TABLE "events" DROP COLUMN "min_heat";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "when_mode";--> statement-breakpoint

-- 3. Drop the now-unused when_mode enum type (no column references it after step 2).
DROP TYPE "public"."when_mode";--> statement-breakpoint

-- 4. Rebuild plan_phase without 'floating' (PG cannot DROP an enum value). 0005 already
--    back-migrated every 'floating' row to 'collecting', so the cast is total.
ALTER TABLE "events" ALTER COLUMN "phase" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."plan_phase_new" AS ENUM('collecting', 'moment', 'cleared', 'fizzled');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "phase" TYPE "public"."plan_phase_new" USING "phase"::text::"public"."plan_phase_new";--> statement-breakpoint
DROP TYPE "public"."plan_phase";--> statement-breakpoint
ALTER TYPE "public"."plan_phase_new" RENAME TO "plan_phase";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "phase" SET DEFAULT 'collecting';
```

- [ ] **Step 2: Append the journal entry for 0006.** Edit `apps/api/src/db/migrations/meta/_journal.json`: after the 0005 entry, add a comma then:
```json
    {
      "idx": 6,
      "version": "7",
      "when": 1780500001000,
      "tag": "0006_unify_suggest_destructive",
      "breakpoints": true
    }
```
  (`when` strictly greater than 0005's.)

- [ ] **Step 3: Do NOT apply or commit yet.** Leave 0006 + its journal entry staged-but-uncommitted OR commit it separately and last. It is applied as the final step of Task 2.4 after the code switch typechecks clean. Note in the commit/PR that 0006 is the destructive half.

### Task 2.4: Apply 0006 and finalize schema after the code switch

Executed ONLY after Phases 3-5 (shared + backend + mobile code switch) typecheck and test clean - i.e. nothing references `floatSuggestions`, `floatVotes`, `minHeat`, `whenMode`, or phase `floating`. This removes the float-table declarations and dead columns from `schema.ts` and applies 0006.

**Files:**
- Modify: `apps/api/src/db/schema.ts` (delete `whenModeEnum`, `floatSuggestions`, `floatVotes`, `minHeat`; drop `floating` from `planPhaseEnum`)

Steps:

- [ ] **Step 1: Confirm no live references remain.** Run:
```bash
grep -rn "floatSuggestions\|floatVotes\|minHeat\|min_heat\|whenMode\|when_mode\|floating\|floatAxisEnum" /Users/gong/Programming/drp_02/apps/api/src --include="*.ts" | grep -v "/migrations/"
```
  Expected: NO output (only the historical `.sql` migration files may mention them, and grep already excludes `/migrations/`). Any hit means a Phase 3-5 task is incomplete - stop and finish it before applying 0006.

- [ ] **Step 2: Remove dead enum + tables + columns from schema.ts.** In `apps/api/src/db/schema.ts`: delete the `whenModeEnum` declaration (line 17 + its comment line 16); remove `"floating",` from the `planPhaseEnum` array (line 25) leaving `["collecting","moment","cleared","fizzled"]` and update the comment on lines 18-19; delete the `minHeat` line (line 86) and its comment (lines 84-85); delete the `whenMode` line (line 77) and its comment (lines 16, 58-62 references); delete the entire `floatSuggestions` table block (lines 143-162) and `floatVotes` table block (lines 164-181). Confirm `whenMode` is gone from `events` and the only enums left are `eventStatusEnum`, `responseKindEnum`, `planPhaseEnum`, `partOfDayEnum`, `candidateKindEnum`.

- [ ] **Step 3: Update seed.ts to stop writing dropped fields.** In `apps/api/src/db/seed.ts`: remove the `floatSuggestions`/`floatVotes` imports (lines 8-9), remove `whenMode: p.whenMode` (line 51), `minHeat: p.minHeat ?? 2` (line 55), rename `lockAt:` -> `decidesBy:` (line 57), set `isAnonymous: true` (line 54), delete the float-suggestion insert loop (lines 77-93) and the two float deletes (lines 111-112). (Detailed seed rewrite belongs to the backend phase; this step only ensures the destructive migration does not break boot-seed.)

- [ ] **Step 4: Typecheck.**
```bash
pnpm --filter @bethere/api typecheck
```
  Expected: PASS (exit 0). FAIL means a dropped identifier is still referenced.

- [ ] **Step 5: Reset local DB and apply BOTH migrations from clean.** Verifies 0005 then 0006 apply in sequence on a fresh DB (mirrors a fresh RDS boot):
```bash
docker compose -f /Users/gong/Programming/drp_02/docker-compose.yml down -v && pnpm db:up && pnpm --filter @bethere/api db:migrate
```
  Expected: applies `0005_unify_suggest_additive` then `0006_unify_suggest_destructive`, exit 0, no error.

- [ ] **Step 6: Verify final DB shape.**
```bash
PGPASSWORD=drp psql -h localhost -p 5433 -U drp -d drp -c "\dt" -c "\d events" -c "SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid=pg_enum.enumtypid WHERE pg_type.typname='plan_phase' ORDER BY enumsortorder;"
```
  Expected: NO `float_suggestions` / `float_votes` tables; `events` has `lock_times`, `lock_things`, `decides_by`, `is_anonymous` and NO `lock_at` / `min_heat` / `when_mode`; `plan_phase` enum lists exactly `collecting, moment, cleared, fizzled` (no `floating`). No `when_mode` type in `\dT`.

- [ ] **Step 7: Boot the API to confirm migrate+seed on boot is green.**
```bash
SEED_ON_BOOT=reset pnpm --filter @bethere/api start &
sleep 6; curl -s http://localhost:3000/health || true; pkill -f "tsx src/index.ts"
```
  Expected: logs `migrations applied` and `seeded demo data (reset)` with no migration/seed error; health responds.

- [ ] **Step 8: Commit the destructive half + schema/seed cleanup together.**
```bash
git -C /Users/gong/Programming/drp_02 add apps/api/src/db/migrations/0006_unify_suggest_destructive.sql apps/api/src/db/migrations/meta/_journal.json apps/api/src/db/schema.ts apps/api/src/db/seed.ts && git -C /Users/gong/Programming/drp_02 commit -m "feat(db): 0006 destructive migration + drop float schema (DRP)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

**Gotchas (apply throughout Phase 2):**
- NEVER run `pnpm --filter @bethere/api db:generate` (drizzle-kit generate) - it HANGS in a non-TTY on the `idea`->`activity` value rename and `lock_at`->`decides_by` column rename. All SQL here is hand-authored and applied via `db:migrate` only.
- The runtime migrator (`apps/api/src/index.ts:95`) reads `meta/_journal.json` + the `.sql` files, NOT the `meta/*_snapshot.json` files; appending a journal entry + the SQL file is sufficient. Do not regenerate snapshots.
- Local reset is destructive: `docker compose down -v && pnpm db:up` (Postgres on host port 5433). Live DB uses `SEED_ON_BOOT=if-empty`, hence copy-then-drop (0005 copies, 0006 drops) - never drop-only.
- Each standalone SQL statement is terminated by `--> statement-breakpoint` (drizzle's split token) except the final one in each file.

Relevant files: `/Users/gong/Programming/drp_02/apps/api/src/db/schema.ts`, `/Users/gong/Programming/drp_02/apps/api/src/db/migrations/meta/_journal.json`, `/Users/gong/Programming/drp_02/apps/api/src/db/migrations/0004_parched_rage.sql` (pattern reference), `/Users/gong/Programming/drp_02/apps/api/src/index.ts:95` (migrator), `/Users/gong/Programming/drp_02/apps/api/drizzle.config.ts`, `/Users/gong/Programming/drp_02/apps/api/src/db/seed.ts`.

---

## Phase 3: Backend events router reshape + float deletion

This phase reshapes `apps/api/src/routers/events.ts` to the unified candidate model (TIME + ACTIVITY lists, public counts, two creator locks, `decidesBy`), then deletes `floats.ts` and unmounts the float router. It depends on Phase 1 (shared schema: `CreateEventInput`, `ToggleReactionInput`, `AddCandidateInput`, `CandidateKind`, `TimeCandidateInput`, `PlanPhase` without `"floating"`, removed `WhenMode`/`ReactInput`/float inputs) and Phase 2 (DB: `lockTimes`/`lockThings` columns, `decidesBy` rename, `kind` on `eventCandidates`, nullable `startsAt`, `candidate_kind` enum, dropped float tables / `min_heat` / `when_mode`, `isAnonymous` default true). It also depends on the shared-logic rename `defaultLockAtForOptions` -> `defaultDecidesByForCandidates` and `addCandidateHorizon(earliestMs, latestMs)` losing its `isFuzzy` boolean (done in the shared-logic phase); this phase consumes those names.

The API test harness is `node --test` over `src/**/*.test.ts` using `node:test` + `node:assert/strict` (see `apps/api/src/auth/resolve.test.ts`). All existing API tests are pure (no DB); there is no `createCaller` harness and router procedures require a live Postgres, so router behaviour here is exercised by extracting pure helpers and unit-testing them, plus a final `pnpm --filter @bethere/api typecheck` gate. Do NOT add DB-bound integration tests in this phase.

> Note: `apps/api` is ESM - every relative import needs a `.js` extension. No em dashes anywhere (use hyphens).

### Task 3.1: Strip float-only lifecycle from the events router (settleFloating, FLOAT_STALE_MS, reconcileFloat)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (delete lines 169-272 `FLOAT_STALE_MS` + `settleFloating`; edit `settleLifecycle` lines 340-347; edit `insertCandidates` lines 103-118; edit imports lines 1-45)

- [ ] **Step 1: Drop the float lifecycle imports.** In the import block (lines 2-27) remove `addDays`, `DAY_MS`, `defaultLockAtForWindow`, `expandWindow`, `reconcileFloat`, and `defaultLockAtForOptions`. Add `defaultDecidesByForCandidates` (the renamed helper) in their place. Also remove `floatSuggestions` and `floatVotes` from the `../db/schema.js` import (lines 32-42). After this step the import list of `@bethere/shared` reads:
  ```ts
  import {
    AddCandidateInput,
    addCandidateHorizon,
    ByIdInput,
    CandidateKind,
    CreateEventInput,
    clears,
    DEFAULT_MOMENT_MINUTES,
    defaultDecidesByForCandidates,
    LockInput,
    MOMENT_MS,
    type MomentResponse,
    type PartOfDay,
    pickWinnerOrBestId,
    pickWinningCandidate,
    ResolveInput,
    RespondInput,
    resolveIn,
    revealGoing,
    SetOptOutInput,
    ToggleReactionInput,
  } from "@bethere/shared";
  ```
  (`ReactInput` removed; `ToggleReactionInput` and `CandidateKind` added; `addDays`/`DAY_MS`/`expandWindow`/`reconcileFloat`/`defaultLockAtForWindow`/`defaultLockAtForOptions` gone.)

- [ ] **Step 2: Delete `FLOAT_STALE_MS` and `settleFloating`.** Remove the entire block from the comment on line 169 (`// A float left this far past its tip deadline...`) through the end of `settleFloating` at line 272 (the closing `}` of the function, followed by the trailing `// TODO push` comment on line 271). This removes the only consumer of `floatSuggestions`, `floatVotes`, `reconcileFloat`, `addDays`, `e.minHeat`, and `defaultLockAtForWindow` inside this file.

- [ ] **Step 3: Drop the floating step from `settleLifecycle`.** Edit the function (now near line 240 after the deletion) so it no longer calls `settleFloating`:
  ```ts
  // Run the convergence pass in its load-bearing order: a collecting round locks, then a moment
  // clears/fizzles. Each step no-ops unless the row is in its phase, so it is safe on any row.
  async function settleLifecycle(e: EventRow): Promise<void> {
    await settleCollecting(e);
    await settlePhase(e);
  }
  ```

- [ ] **Step 4: Add `kind` to the candidate-insert helper.** `insertCandidates` (lines 103-118) currently writes time-only rows with `label: null`. Generalise it to carry `kind` and a nullable `startsAt` so the unified create can use it for both kinds:
  ```ts
  // Persist a plan's candidate slate (one row per slot). Time candidates carry a startsAt + optional
  // part-of-day hint; activity candidates carry a label and a null startsAt. Single source for the
  // candidate row shape across create and the addCandidate mutation.
  async function insertCandidates(
    eventId: string,
    rows: {
      id: string;
      kind: CandidateKind;
      startsAt: Date | null;
      partOfDay: PartOfDay | null;
      label: string | null;
    }[],
  ): Promise<void> {
    for (const r of rows) {
      await db.insert(eventCandidates).values({
        id: r.id,
        eventId,
        kind: r.kind,
        startsAt: r.startsAt,
        partOfDay: r.partOfDay,
        label: r.label,
      });
    }
  }
  ```

- [ ] **Step 5: Fix `candidatesFor` sort for nullable startsAt.** `candidatesFor` (lines 65-68) sorts by `a.startsAt.getTime()`, which now NPEs on activity rows (null startsAt). Make it null-safe so activity candidates sort last and time candidates stay chronological:
  ```ts
  async function candidatesFor(eventId: string): Promise<(typeof eventCandidates.$inferSelect)[]> {
    const rows = await db.select().from(eventCandidates).where(eq(eventCandidates.eventId, eventId));
    return rows.sort((a, b) => {
      const at = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return at - bt;
    });
  }
  ```

- [ ] **Step 6: Typecheck (expected FAIL, transitional).** Run:
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect errors: `floats.ts` still imports `settleFloating` from `./events.js` (now gone), `create`/`react`/`addCandidate`/`lock`/`mine`/`get` still reference removed imports and old schema columns (`whenMode`, `lockAt`, `minHeat`). This is expected mid-phase; the next tasks resolve them.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/api/src/routers/events.ts
  git commit -m "refactor(api): drop settleFloating + float lifecycle from events router (DRP-41)"
  ```

### Task 3.2: Extract and unit-test the create-phase decision helper

The unified `create` has two pure decisions worth isolating: (a) the concrete shortcut (exactly one time candidate AND `lockTimes` true => open the moment, skip collecting) and (b) the default `decidesBy` when the creator gives none. Extract a pure helper and test it with `node:test` (no DB).

**Files:**
- Create: `apps/api/src/routers/create-plan.ts`
- Create: `apps/api/src/routers/create-plan.test.ts`

- [ ] **Step 1: Write the failing test.** Create `apps/api/src/routers/create-plan.test.ts`:
  ```ts
  import assert from "node:assert/strict";
  import { test } from "node:test";
  import { planOpensMoment } from "./create-plan.js";

  test("one time candidate with lockTimes opens the moment (concrete shortcut)", () => {
    assert.equal(planOpensMoment(1, true), true);
  });

  test("one time candidate without lockTimes still collects", () => {
    assert.equal(planOpensMoment(1, false), false);
  });

  test("multiple time candidates never short-cut, even when locked", () => {
    assert.equal(planOpensMoment(3, true), false);
  });

  test("zero time candidates never short-cut", () => {
    assert.equal(planOpensMoment(0, true), false);
  });
  ```

- [ ] **Step 2: Run it (expected FAIL).**
  ```bash
  pnpm --filter @bethere/api exec node --import tsx --test src/routers/create-plan.test.ts
  ```
  Expect: `Cannot find module './create-plan.js'` (the helper does not exist yet).

- [ ] **Step 3: Implement the helper.** Create `apps/api/src/routers/create-plan.ts`:
  ```ts
  // The concrete shortcut: a plan with exactly ONE time candidate AND lockTimes set opens straight
  // into the blind moment (it always happens, contingent false) - there is nothing left to converge.
  // Any other shape (multiple times, no lock, or zero times) starts a collecting round.
  export function planOpensMoment(timeCandidateCount: number, lockTimes: boolean): boolean {
    return timeCandidateCount === 1 && lockTimes;
  }
  ```

- [ ] **Step 4: Run it (expected PASS).**
  ```bash
  pnpm --filter @bethere/api exec node --import tsx --test src/routers/create-plan.test.ts
  ```
  Expect: `# pass 4`, `# fail 0`.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/api/src/routers/create-plan.ts apps/api/src/routers/create-plan.test.ts
  git commit -m "feat(api): planOpensMoment concrete-shortcut helper + tests (DRP-41)"
  ```

### Task 3.3: Rebuild `create` for the unified input (two candidate lists, isAnonymous always, decidesBy)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`create` mutation, lines 365-459; `DEFAULT_QUORUM` line 50)

- [ ] **Step 1: Replace the `create` mutation body.** Swap the whole `create` block (the leading comment at lines 366-367 through the closing `}),` at line 459) for the unified build. Note the names: `input.timeCandidates` (array of `{ startsAt, partOfDay? }`), `input.activityCandidates` (array of strings), `input.lockTimes`/`input.lockThings` (default false), `input.decidesBy`, `input.title` optional.
  ```ts
  // Create one plan. It owns two candidate lists - TIME and ACTIVITY - each react-able with public
  // +1 counts. The creator is ALWAYS anonymous. The only real fork is the concrete shortcut: one time
  // candidate that the creator locks opens the blind moment immediately; everything else collects.
  create: protectedProcedure.input(CreateEventInput).mutation(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const id = `e_${randomUUID()}`;

    const timeInputs = input.timeCandidates ?? [];
    const activityInputs = input.activityCandidates ?? [];

    const timeCands = timeInputs
      .map((t, i) => ({
        id: `${id}_t${i + 1}`,
        kind: "time" as const,
        startsAt: new Date(t.startsAt),
        partOfDay: t.partOfDay ?? null,
        label: null,
      }))
      .filter((c) => !Number.isNaN(c.startsAt.getTime()))
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const activityCands = activityInputs.map((text, i) => ({
      id: `${id}_a${i + 1}`,
      kind: "activity" as const,
      startsAt: null,
      partOfDay: null,
      label: text,
    }));

    const opensMoment = planOpensMoment(timeCands.length, input.lockTimes);
    const quorum = input.quorum ?? (opensMoment ? 1 : DEFAULT_QUORUM);

    // Time anchors. With no time candidates a plan still collects (on activities), so anchor the
    // placeholder start + the default decides-by to a sensible horizon instead of a candidate.
    const now = Date.now();
    const earliestMs = timeCands.length > 0 ? timeCands[0].startsAt.getTime() : now + DEFAULT_HORIZON_MS;
    const lastMs =
      timeCands.length > 0 ? timeCands[timeCands.length - 1].startsAt.getTime() : earliestMs;
    const startsAt = new Date(earliestMs); // the chosen time when opensMoment; a placeholder otherwise

    // The concrete shortcut opens the blind moment now and runs until the event itself; respond stays
    // open the whole time and the crowd reveals when it starts. If that time is already here, fall
    // back to a short window so there is always a real moment to answer.
    const momentStartsAt = opensMoment ? new Date() : null;
    let momentEndsAt: Date | null = opensMoment ? startsAt : null;
    if (opensMoment && momentEndsAt && momentEndsAt.getTime() <= now) {
      momentEndsAt = new Date(now + MOMENT_MS);
    }
    const respondByAt = momentEndsAt ?? new Date(lastMs);

    // Collecting plans converge by a fixed deadline ("Decides by"), then auto-pick the winner. The
    // creator may override it; the override must sit after now and leave the blind moment room before
    // the time window. With no time candidates we only have activities, so any future deadline is fine.
    let decidesBy: Date | null = null;
    if (!opensMoment) {
      if (input.decidesBy) {
        const t = new Date(input.decidesBy);
        const tooLate = timeCands.length > 0 && t.getTime() > earliestMs - MOMENT_MS;
        if (Number.isNaN(t.getTime()) || t.getTime() <= now || tooLate) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "decides-by must be after now and leave room before the plan's window",
          });
        }
        decidesBy = t;
      } else {
        decidesBy = new Date(defaultDecidesByForCandidates(earliestMs, now));
      }
    }

    await db.insert(events).values({
      id,
      groupId: input.groupId,
      createdByUserId: ctx.userId,
      title: input.title ?? "",
      description: input.description ?? null,
      location: input.location ?? "",
      startsAt,
      respondByAt,
      status: "open",
      contingent: !opensMoment,
      quorum,
      isAnonymous: true,
      lockTimes: input.lockTimes,
      lockThings: input.lockThings,
      phase: opensMoment ? "moment" : "collecting",
      decidesBy,
      chosenCandidateId: opensMoment && timeCands.length > 0 ? timeCands[0].id : null,
      momentStartsAt,
      momentEndsAt,
    });
    await insertCandidates(id, [...timeCands, ...activityCands]);
    // TODO push: notify group members "a plan went out - what works?" / "you're in a moment".
    return { id };
  }),
  ```
  Key contract points enforced here: `isAnonymous: true` always; `whenMode` is gone (column dropped in Phase 2); `lockAt` renamed to `decidesBy`; `minHeat` gone; the concrete shortcut uses `planOpensMoment`; title defaults to `""`.

- [ ] **Step 2: Add the `planOpensMoment` import and the `DEFAULT_HORIZON_MS` constant.** At the top of the file add `import { planOpensMoment } from "./create-plan.js";` (after the schema import). Near `DEFAULT_QUORUM` (line 50) add:
  ```ts
  const DEFAULT_QUORUM = 2;
  // With no time candidates a plan still collects (on activities); anchor its placeholder start and
  // default decides-by this far out so the deadline is sane without a concrete time to hang it on.
  const DEFAULT_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
  ```

- [ ] **Step 3: Typecheck (expected FAIL, transitional).**
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect remaining errors only in `react`/`addCandidate`/`lock`/`mine`/`get`/`settleCollecting` (old `lockAt`/`whenMode`/`ReactInput` references) and `floats.ts`. `create` itself should now typecheck clean.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/api/src/routers/events.ts
  git commit -m "feat(api): unified create - two candidate lists, isAnonymous always, decidesBy (DRP-41)"
  ```

### Task 3.4: Replace `react` with `toggleReaction` (one public +1 toggle, either kind)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`react` mutation, lines 461-491)

- [ ] **Step 1: Replace the `react` mutation with `toggleReaction`.** Swap the comment + `react` block (lines 462-491) for a single-candidate public toggle. It inserts or deletes ONE `candidateReactions` row for `(eventId, candidateId, userId)`, works for either kind, validates the candidate belongs to the event, and clears the caller's opt-out when adding:
  ```ts
  // Toggle the caller's public +1 on ONE candidate (time or activity) during collecting. Counts are
  // PUBLIC (momentum), but who reacted is never shown. Adding a +1 rejoins anyone who had opted out.
  toggleReaction: protectedProcedure.input(ToggleReactionInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting reactions" });
    }
    const [cand] = await db
      .select()
      .from(eventCandidates)
      .where(eq(eventCandidates.id, input.candidateId));
    if (!cand || cand.eventId !== input.eventId) throw new TRPCError({ code: "NOT_FOUND" });

    const mine = await db
      .select()
      .from(candidateReactions)
      .where(
        and(
          eq(candidateReactions.eventId, input.eventId),
          eq(candidateReactions.candidateId, input.candidateId),
          eq(candidateReactions.userId, ctx.userId),
        ),
      );
    if (mine.length > 0) {
      await db
        .delete(candidateReactions)
        .where(
          and(
            eq(candidateReactions.eventId, input.eventId),
            eq(candidateReactions.candidateId, input.candidateId),
            eq(candidateReactions.userId, ctx.userId),
          ),
        );
      return { reacted: false as const };
    }
    await db
      .insert(candidateReactions)
      .values({ eventId: input.eventId, candidateId: input.candidateId, userId: ctx.userId });
    // A +1 rejoins anyone who had opted out (mutual exclusion with "I can't make it").
    await db
      .delete(eventOptOuts)
      .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));
    return { reacted: true as const };
  }),
  ```

- [ ] **Step 2: Typecheck (expected FAIL, transitional).**
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect remaining errors only in `addCandidate`/`lock`/`mine`/`get`/`settleCollecting` and `floats.ts`. `react`-related errors gone.

- [ ] **Step 3: Commit.**
  ```bash
  git add apps/api/src/routers/events.ts
  git commit -m "feat(api): toggleReaction replaces react - public per-candidate +1, either kind (DRP-41)"
  ```

### Task 3.5: Reshape `addCandidate` to be kind-gated (time vs activity)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`addCandidate` mutation, lines 522-570)

- [ ] **Step 1: Replace the `addCandidate` mutation.** Swap the comment + body (lines 522-570) for the kind-gated version. `kind === "time"` is FORBIDDEN when `e.lockTimes`; `kind === "activity"` is FORBIDDEN when `e.lockThings`. Time requires `startsAt` (validated, deduped by minute, bounded by horizon); activity requires `text` (deduped case-insensitively). Adding +1s the candidate for the author. Note the new `AddCandidateInput` shape: `{ eventId, kind, startsAt?, partOfDay?, text? }`.
  ```ts
  // Any member adds a candidate while collecting - a new time, or a new place/thing - and the crowd
  // gains another row to +1. Kind-gated by the creator's locks: a locked axis rejects new candidates.
  // Time candidates dedupe by minute; activity candidates dedupe case-insensitively. Adding +1s it.
  addCandidate: protectedProcedure.input(AddCandidateInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    if (input.kind === "time" && e.lockTimes) {
      throw new TRPCError({ code: "FORBIDDEN", message: "times are locked on this plan" });
    }
    if (input.kind === "activity" && e.lockThings) {
      throw new TRPCError({ code: "FORBIDDEN", message: "places are locked on this plan" });
    }
    const existing = await candidatesFor(input.eventId);

    let newId: string;
    if (input.kind === "time") {
      if (!input.startsAt) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "a time candidate needs a start time" });
      }
      const startsAt = new Date(input.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "invalid time" });
      }
      // A new slot must sit after the decides-by deadline (still a live choice when we lock) and
      // within the plan's horizon (a small slack past the existing time spread).
      if (e.decidesBy && startsAt.getTime() <= e.decidesBy.getTime()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "that time is before the decides-by deadline" });
      }
      const times = existing
        .filter((c) => c.kind === "time" && c.startsAt)
        .map((c) => (c.startsAt as Date).getTime());
      if (times.length > 0) {
        const horizon = addCandidateHorizon(Math.min(...times), Math.max(...times));
        if (startsAt.getTime() > horizon) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "that time is past this plan's window" });
        }
      }
      const dup = existing.find((c) => c.kind === "time" && c.startsAt?.getTime() === startsAt.getTime());
      if (dup) {
        await reactFor(input.eventId, dup.id, ctx.userId);
        return { id: dup.id };
      }
      newId = `${input.eventId}_t_${randomUUID()}`;
      await db.insert(eventCandidates).values({
        id: newId,
        eventId: input.eventId,
        kind: "time",
        startsAt,
        partOfDay: input.partOfDay ?? null,
        label: null,
      });
    } else {
      if (!input.text) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "a place/thing needs a name" });
      }
      const text = input.text.trim();
      if (!text) throw new TRPCError({ code: "BAD_REQUEST", message: "a place/thing needs a name" });
      const key = text.toLowerCase();
      const dup = existing.find((c) => c.kind === "activity" && (c.label ?? "").trim().toLowerCase() === key);
      if (dup) {
        await reactFor(input.eventId, dup.id, ctx.userId);
        return { id: dup.id };
      }
      newId = `${input.eventId}_a_${randomUUID()}`;
      await db.insert(eventCandidates).values({
        id: newId,
        eventId: input.eventId,
        kind: "activity",
        startsAt: null,
        partOfDay: null,
        label: text,
      });
    }
    await reactFor(input.eventId, newId, ctx.userId);
    return { id: newId };
  }),
  ```

- [ ] **Step 2: Add the `reactFor` idempotent +1 helper.** Adding a candidate (or hitting a dup) implies a +1 from the author, mirroring the old float `castVote`. Add it next to `insertCandidates` (so both `addCandidate` and any future caller share it):
  ```ts
  // The author's own public +1 on a candidate (adding a candidate implies +1'ing it). Idempotent.
  async function reactFor(eventId: string, candidateId: string, userId: string): Promise<void> {
    await db
      .insert(candidateReactions)
      .values({ eventId, candidateId, userId })
      .onConflictDoNothing();
  }
  ```
  > Confirm during implementation that `candidateReactions` has a primary key / unique index over `(eventId, candidateId, userId)` for `onConflictDoNothing` to no-op; this is the Phase 2 shape. If not present, fall back to a select-then-insert guard.

- [ ] **Step 3: Typecheck (expected FAIL, transitional).**
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect remaining errors only in `lock`/`mine`/`get`/`settleCollecting` and `floats.ts`.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/api/src/routers/events.ts
  git commit -m "feat(api): kind-gated addCandidate (time vs activity), locks + dedupe + author +1 (DRP-41)"
  ```

### Task 3.6: Extract and unit-test the winning-time / winning-activity pickers

`lock` and `settleCollecting` both need to (a) split candidates by kind, (b) pick the winning TIME, and (c) resolve a winning ACTIVITY into the title when the title is empty. The picking is pure (`pickWinnerOrBestId` / `pickWinningCandidate` are already kind-agnostic over ids+reactions) - extract the kind-split + title-resolution wiring as pure helpers and test them.

**Files:**
- Modify: `apps/api/src/routers/create-plan.ts`
- Modify: `apps/api/src/routers/create-plan.test.ts`

- [ ] **Step 1: Add failing tests for the title resolver.** Append to `apps/api/src/routers/create-plan.test.ts`:
  ```ts
  import { resolveTitle } from "./create-plan.js";

  test("resolveTitle keeps a non-empty title and ignores activities", () => {
    assert.equal(
      resolveTitle("Dinner", [{ id: "a1", label: "Pizza" }], [{ candidateId: "a1", userId: "u1" }]),
      "Dinner",
    );
  });

  test("resolveTitle picks the most-voted activity when title is empty", () => {
    const acts = [
      { id: "a1", label: "Pizza" },
      { id: "a2", label: "Sushi" },
    ];
    const reactions = [
      { candidateId: "a1", userId: "u1" },
      { candidateId: "a2", userId: "u1" },
      { candidateId: "a2", userId: "u2" },
    ];
    assert.equal(resolveTitle("", acts, reactions), "Sushi");
  });

  test("resolveTitle falls back to empty when there are no activities", () => {
    assert.equal(resolveTitle("", [], []), "");
  });
  ```

- [ ] **Step 2: Run it (expected FAIL).**
  ```bash
  pnpm --filter @bethere/api exec node --import tsx --test src/routers/create-plan.test.ts
  ```
  Expect: import resolves but `resolveTitle is not a function` / failing assertions.

- [ ] **Step 3: Implement `resolveTitle`.** Append to `apps/api/src/routers/create-plan.ts`:
  ```ts
  import { pickWinnerOrBestId } from "@bethere/shared";

  // When a plan locks with no explicit title, the winning ACTIVITY candidate (most public +1s, ties
  // broken by pickWinnerOrBestId's stable order) becomes the title. A non-empty title is kept as-is;
  // with no activity candidates the title stays empty.
  export function resolveTitle(
    title: string,
    activityCandidates: { id: string; label: string | null }[],
    reactions: { candidateId: string; userId: string }[],
  ): string {
    if (title.trim() !== "") return title;
    if (activityCandidates.length === 0) return "";
    const winnerId = pickWinnerOrBestId(
      activityCandidates.map((c) => c.id),
      reactions,
      1,
    );
    return activityCandidates.find((c) => c.id === winnerId)?.label ?? "";
  }
  ```
  > During implementation, confirm `pickWinnerOrBestId(ids, reactions, quorum)` is the exact signature in `packages/shared/src/logic/candidates.ts` (it is already imported by `events.ts`); the public count for a candidate IS `userIds.length` per the contract.

- [ ] **Step 4: Run it (expected PASS).**
  ```bash
  pnpm --filter @bethere/api exec node --import tsx --test src/routers/create-plan.test.ts
  ```
  Expect: `# pass 7`, `# fail 0`.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/api/src/routers/create-plan.ts apps/api/src/routers/create-plan.test.ts
  git commit -m "feat(api): resolveTitle - winning activity becomes title when empty + tests (DRP-41)"
  ```

### Task 3.7: Reshape `lock` (creator-self check, no isAnonymous guard, winning-activity -> title) and `settleCollecting`

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`settleCollecting`, lines 136-167; `lock` mutation, lines 572-614)

- [ ] **Step 1: Add the `lock`+`settleCollecting` import.** Add `resolveTitle` to the create-plan import: `import { planOpensMoment, resolveTitle } from "./create-plan.js";`.

- [ ] **Step 2: Rewrite `lock`.** Replace the comment + body (lines 572-614). Remove the `if (e.isAnonymous) FORBIDDEN` guard entirely; authorize via `createdByUserId === ctx.userId` only (the creator is still anonymous to everyone else). Pick the winning TIME candidate (only time candidates are lockable); if `title === ""` resolve the winning ACTIVITY into the title. Rename `lockAt`/`whenMode` usages.
  ```ts
  // The creator locks the winning TIME, opening the blind moment. The creator is anonymous to others
  // but we still authorize via the stored createdByUserId (a self-check, never surfaced). With no
  // candidateId we pick the best-supported time (most public +1s). If the plan has no title yet, the
  // winning ACTIVITY becomes the title at lock.
  lock: protectedProcedure.input(LockInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    if (e.createdByUserId !== ctx.userId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "only the creator can lock the moment" });
    }
    if (e.phase !== "collecting") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting" });
    }
    const cands = await candidatesFor(input.eventId);
    const timeCands = cands.filter((c) => c.kind === "time" && c.startsAt);
    if (timeCands.length === 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "no time candidates to lock" });
    }
    const reactions = await reactionsFor(input.eventId);
    const timeIds = timeCands.map((c) => c.id);

    const requestedId =
      input.candidateId && timeIds.includes(input.candidateId) ? input.candidateId : null;
    const chosenId = requestedId ?? pickWinnerOrBestId(timeIds, reactions, e.quorum);
    const chosen = timeCands.find((c) => c.id === chosenId);
    if (!chosen || !chosen.startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "unknown candidate" });

    const title = resolveTitle(
      e.title,
      cands
        .filter((c) => c.kind === "activity")
        .map((c) => ({ id: c.id, label: c.label })),
      reactions,
    );

    const minutes = input.momentMinutes ?? DEFAULT_MOMENT_MINUTES;
    const now = new Date();
    const momentEndsAt = computeMomentEnd(now, minutes, chosen.startsAt);
    await db
      .update(events)
      .set({
        phase: "moment",
        title,
        chosenCandidateId: chosenId,
        momentStartsAt: now,
        momentEndsAt,
        startsAt: chosen.startsAt,
        respondByAt: momentEndsAt,
      })
      .where(eq(events.id, input.eventId));
    return { ok: true as const, chosenCandidateId: chosenId };
  }),
  ```

- [ ] **Step 3: Rewrite `settleCollecting` for `decidesBy`, time-only winner, and activity -> title.** Replace the comment + body (lines 131-167). Rename `e.lockAt` -> `e.decidesBy`; pick among TIME candidates only; resolve the winning activity into the title when empty; fizzle if there are no time candidates or no reactions.
  ```ts
  // Lazily auto-lock a collecting plan whose "Decides by" deadline has passed (no scheduler): pick the
  // best-supported TIME candidate (quorum, else most-reacted), resolve the winning activity into the
  // title if empty, and open the blind moment. Opted-out members have no reactions so they drop for
  // free; with no time candidates or zero reactions the plan fizzles silently. Mutates + persists.
  async function settleCollecting(e: EventRow): Promise<void> {
    if (e.phase !== "collecting" || !e.decidesBy || Date.now() < e.decidesBy.getTime()) return;
    const cands = await candidatesFor(e.id);
    const timeCands = cands.filter((c) => c.kind === "time" && c.startsAt);
    const reactions = await reactionsFor(e.id);
    if (timeCands.length === 0 || reactions.length === 0) {
      await fizzle(e);
      return;
    }
    const timeIds = timeCands.map((c) => c.id);
    const chosenId = pickWinnerOrBestId(timeIds, reactions, e.quorum);
    const chosen = timeCands.find((c) => c.id === chosenId) as (typeof timeCands)[number];
    const startsAt = chosen.startsAt as Date;
    const title = resolveTitle(
      e.title,
      cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })),
      reactions,
    );
    const now = new Date();
    const endsAt = computeMomentEnd(now, DEFAULT_MOMENT_MINUTES, startsAt);
    await db
      .update(events)
      .set({
        phase: "moment",
        title,
        chosenCandidateId: chosenId,
        momentStartsAt: now,
        momentEndsAt: endsAt,
        startsAt,
        respondByAt: endsAt,
      })
      .where(eq(events.id, e.id));
    e.phase = "moment";
    e.title = title;
    e.chosenCandidateId = chosenId;
    e.momentStartsAt = now;
    e.momentEndsAt = endsAt;
    e.startsAt = startsAt;
  }
  ```

- [ ] **Step 4: Typecheck (expected FAIL, transitional).**
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect remaining errors only in `mine`/`get` (old `lockAt`/`whenMode`/`isAnonymous`-creator references, candidate read shape) and `floats.ts`.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/api/src/routers/events.ts
  git commit -m "feat(api): lock + settleCollecting - creator-self check, decidesBy, winning activity to title (DRP-41)"
  ```

### Task 3.8: Reshape `mine` and `get` reads (drop floating, public counts both kinds, isCreator self-check, decidesBy rename)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`mine` query, lines 616-692; `get` query, lines 694-776)

- [ ] **Step 1: Rewrite `mine`.** Replace the body (lines 617-692). Remove the `phase === "floating"` early-return (line 629); `isCreator = e.createdByUserId === ctx.userId` (a private self-check returned as a boolean only - never the id, and no longer gated on `!isAnonymous`); rename `lockAt`->`decidesBy` and `msLeftToLock`->`msLeftToDecide`; drop `whenMode`.
  ```ts
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));
    const groupIds = memberships.map((m) => m.groupId);
    if (groupIds.length === 0) return [];

    const rows = await db.select().from(events).where(inArray(events.groupId, groupIds));
    const out = await Promise.all(
      rows.map(async (e) => {
        await settleLifecycle(e);
        if (e.phase === "fizzled") return null; // silent: a fizzle leaves no trace
        const resp = await responsesFor(e.id);
        const revealed = goingFromRow(e, resp);
        const { goingCount, preview } = await goingPreview(revealed);
        // A private self-check: returned as a boolean only, never the id - the creator stays anonymous.
        const isCreator = e.createdByUserId === ctx.userId;
        const iOptedOut = (await optedOut(e.id)).has(ctx.userId);
        const myStatus = computeMyStatus(e.phase, ctx.userId, resp, revealed, iOptedOut);

        let iReacted = false;
        let candidateCount = 0;
        let readyToLock = false;
        if (e.phase === "collecting") {
          const cands = await candidatesFor(e.id);
          candidateCount = cands.length;
          const myReacts = await db
            .select()
            .from(candidateReactions)
            .where(
              and(eq(candidateReactions.eventId, e.id), eq(candidateReactions.userId, ctx.userId)),
            );
          iReacted = myReacts.length > 0;
          if (isCreator) {
            const reactions = await reactionsFor(e.id);
            const timeIds = cands.filter((c) => c.kind === "time").map((c) => c.id);
            readyToLock = pickWinningCandidate(timeIds, reactions, e.quorum) !== null;
          }
        }

        return {
          id: e.id,
          groupName: await getGroupName(e.groupId),
          title: e.title,
          location: e.location,
          phase: e.phase,
          startsAt: e.startsAt.toISOString(),
          createdAt: e.createdAt.toISOString(),
          decidesBy: e.decidesBy?.toISOString() ?? null,
          msLeftToDecide: msLeft(e.decidesBy),
          momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
          momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
          msLeft: msLeft(e.momentEndsAt),
          myStatus,
          iReacted,
          iResponded: resp.some((r) => r.userId === ctx.userId),
          candidateCount,
          isCreator,
          readyToLock,
          goingCount,
          goingPreview: preview,
        };
      }),
    );
    return out.filter((x): x is NonNullable<typeof x> => x !== null);
  }),
  ```

- [ ] **Step 2: Rewrite `get`.** Replace the body (lines 696-776). Remove the `phase === "floating"` early-return (line 701); flip the deliberately-private per-candidate counts to PUBLIC for BOTH kinds; split the read payload into `timeCandidates` (`{id,startsAt,partOfDay,count,mine}`) and `activityCandidates` (`{id,text,count,mine}`); add `lockTimes`/`lockThings`/`decidesBy`/`msLeftToDecide`; `isCreator = e.createdByUserId === ctx.userId`; drop `whenMode`; rename `lockAt`->`decidesBy`, `msLeftToLock`->`msLeftToDecide`.
  ```ts
  get: protectedProcedure.input(ByIdInput).query(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.id));
    if (!e) return null;
    await requireMember(e.groupId, ctx.userId);
    await settleLifecycle(e);

    const resp = await responsesFor(e.id);
    const revealed = goingFromRow(e, resp);
    // A private self-check: returned as a boolean only, never the id - the creator stays anonymous.
    const isCreator = e.createdByUserId === ctx.userId;
    const iOptedOut = (await optedOut(e.id)).has(ctx.userId);

    const cands = await candidatesFor(e.id);
    const reactions = await reactionsFor(e.id);
    // Public per-candidate +1 counts (momentum) for BOTH kinds; who reacted is never returned, only
    // the count and whether the caller themselves reacted.
    const countBy = new Map<string, number>();
    const mineSet = new Set<string>();
    for (const r of reactions) {
      countBy.set(r.candidateId, (countBy.get(r.candidateId) ?? 0) + 1);
      if (r.userId === ctx.userId) mineSet.add(r.candidateId);
    }
    const timeCandidates = cands
      .filter((c) => c.kind === "time" && c.startsAt)
      .map((c) => ({
        id: c.id,
        startsAt: (c.startsAt as Date).toISOString(),
        partOfDay: c.partOfDay,
        count: countBy.get(c.id) ?? 0,
        mine: mineSet.has(c.id),
      }));
    const activityCandidates = cands
      .filter((c) => c.kind === "activity")
      .map((c) => ({
        id: c.id,
        text: c.label ?? "",
        count: countBy.get(c.id) ?? 0,
        mine: mineSet.has(c.id),
      }))
      .sort((a, b) => b.count - a.count);

    const timeIds = timeCandidates.map((c) => c.id);
    const readyToLock =
      isCreator &&
      e.phase === "collecting" &&
      pickWinningCandidate(timeIds, reactions, e.quorum) !== null;

    const memberRows = await db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.groupId, e.groupId));
    const members: { id: string; name: string }[] = [];
    for (const row of memberRows) {
      if (row.userId === ctx.userId) continue;
      const [u] = await db.select().from(users).where(eq(users.id, row.userId));
      members.push({ id: row.userId, name: u?.name ?? FALLBACK_USER_NAME });
    }

    const showCrowd = revealed !== null && e.phase !== "fizzled";
    const going = showCrowd ? await buildGoing(revealed) : [];
    const mine = resp.find((r) => r.userId === ctx.userId);
    const chosen = cands.find((c) => c.id === e.chosenCandidateId) ?? null;

    return {
      id: e.id,
      groupName: await getGroupName(e.groupId),
      title: e.title,
      description: e.description,
      location: e.location,
      phase: e.phase,
      contingent: e.contingent,
      quorum: e.quorum,
      lockTimes: e.lockTimes,
      lockThings: e.lockThings,
      startsAt: e.startsAt.toISOString(),
      decidesBy: e.decidesBy?.toISOString() ?? null,
      msLeftToDecide: msLeft(e.decidesBy),
      chosenStartsAt: chosen?.startsAt?.toISOString() ?? null,
      momentStartsAt: e.momentStartsAt?.toISOString() ?? null,
      momentEndsAt: e.momentEndsAt?.toISOString() ?? null,
      msLeft: msLeft(e.momentEndsAt),
      revealed: showCrowd,
      isCreator,
      iOptedOut,
      readyToLock,
      timeCandidates,
      activityCandidates,
      myResponse: mine ? { kind: mine.kind, cond: mine.cond ?? null } : null,
      myStatus: computeMyStatus(e.phase, ctx.userId, resp, revealed, iOptedOut),
      members,
      going,
    };
  }),
  ```
  > This drops the old flat `candidates` / `myReactionCandidateIds` fields in favour of the two typed lists + per-row `mine`. Phase 5 (mobile) consumes the new shape; flag this in the PR description since it is a breaking read-shape change.

- [ ] **Step 3: Typecheck (expected: only floats.ts errors remain).**
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect the only remaining errors to be in `apps/api/src/routers/floats.ts` (it imports the now-deleted `settleFloating`) and `apps/api/src/router.ts` (mounts `floats`). `events.ts` should be clean.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/api/src/routers/events.ts
  git commit -m "feat(api): mine/get reads - drop floating, public counts both kinds, isCreator self-check, decidesBy (DRP-41)"
  ```

### Task 3.9: Delete floats.ts and unmount the float router

**Files:**
- Delete: `apps/api/src/routers/floats.ts`
- Modify: `apps/api/src/router.ts` (lines 2, 10)

- [ ] **Step 1: Delete the float router file.**
  ```bash
  git rm apps/api/src/routers/floats.ts
  ```

- [ ] **Step 2: Unmount `floats` from the app router.** In `apps/api/src/router.ts` remove the import on line 2 (`import { floatsRouter } from "./routers/floats.js";`) and the `floats: floatsRouter,` mount on line 10. The file becomes:
  ```ts
  import { eventsRouter } from "./routers/events.js";
  import { groupsRouter } from "./routers/groups.js";
  import { publicProcedure, router } from "./trpc.js";

  export const appRouter = router({
    health: publicProcedure.query(() => ({ ok: true as const })),
    groups: groupsRouter,
    events: eventsRouter,
  });
  export type AppRouter = typeof appRouter;
  ```

- [ ] **Step 3: Confirm nothing else imports floats.** Run:
  ```bash
  grep -rn "floatsRouter\|routers/floats\|floatSuggestions\|floatVotes\|settleFloating\|reconcileFloat\|FLOAT_STALE_MS" apps/api/src
  ```
  Expect: no matches (the schema-table references in `db/schema.ts` are handled by Phase 2; if any appear here in API code, resolve them). Any seed code referencing float tables is Phase 2's responsibility - note it in the PR if `grep` surfaces `apps/api/src/db/seed*.ts` hits.

- [ ] **Step 4: Typecheck the whole API package (expected PASS).**
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expect: clean exit, no errors.

- [ ] **Step 5: Run the API test suite (expected PASS).**
  ```bash
  pnpm --filter @bethere/api test
  ```
  Expect: all `node:test` files pass, including the new `create-plan.test.ts` (`# pass`, `# fail 0`). The pure auth/seed/reset tests still pass; the new `create-plan` tests cover the extracted decision logic.

- [ ] **Step 6: Lint.**
  ```bash
  pnpm lint
  ```
  Expect: no errors. If biome flags formatting, run `pnpm format` and re-add.

- [ ] **Step 7: Commit.**
  ```bash
  git add apps/api/src/router.ts apps/api/src/routers/floats.ts
  git commit -m "refactor(api): delete floats router + unmount from appRouter (DRP-41)"
  ```

---

Relevant file paths for executors:
- Main reshape: `/Users/gong/Programming/drp_02/apps/api/src/routers/events.ts`
- New pure helpers + tests: `/Users/gong/Programming/drp_02/apps/api/src/routers/create-plan.ts`, `/Users/gong/Programming/drp_02/apps/api/src/routers/create-plan.test.ts`
- App router: `/Users/gong/Programming/drp_02/apps/api/src/router.ts`
- Deleted: `/Users/gong/Programming/drp_02/apps/api/src/routers/floats.ts`

Cross-phase dependencies to verify before starting: Phase 1 shared schema names (`CreateEventInput`, `ToggleReactionInput`, `AddCandidateInput`, `CandidateKind`, `TimeCandidateInput`, `LockInput`, `PlanPhase` minus `"floating"`); Phase 2 DB columns (`lockTimes`, `lockThings`, `decidesBy`, `eventCandidates.kind`, nullable `eventCandidates.startsAt`, `isAnonymous` default true, dropped `whenMode`/`minHeat`/float tables, `candidate_kind` enum, `candidateReactions` unique on `(eventId, candidateId, userId)`); shared-logic rename `defaultDecidesByForCandidates` and `addCandidateHorizon(earliest, latest)` (two-arg).

---

## Phase 4: Create wizard (single flow) + navigation

This phase collapses the three-branch create flow (float / rough / set) into ONE wizard that always calls `trpc.events.create` with the unified `CreateEventInput`, deletes `NewDial`, removes `NewDial`/`FloatBoard`/`branch` from navigation, repoints the Dashboard "New meetup" button straight to `CreateWizard`, and mirrors the `lock.ts` signature change in the mobile lib. Prerequisite: Phase 1 (shared schemas) and Phase 3 (backend `events.create` reshape) must already be merged on the working branch so `trpc.events.create` accepts the unified input and `CreateEventInput` resolves the type chain. Run `pnpm --filter @bethere/mobile typecheck` after each task; the mobile package has no jest coverage for screens, so verification here is typecheck + manual reasoning, not unit tests.

### Task 4.1: Mirror the lock.ts signature change in mobile lib/lock.ts

The contract renames `defaultLockAtForOptions` -> `defaultDecidesByForCandidates` and drops the `isFuzzy` boolean from `addCandidateHorizon`. The mobile copy at `apps/mobile/src/lib/lock.ts` is a hand-maintained mirror (lines 16-38) and must match.

**Files:**
- Modify: `apps/mobile/src/lib/lock.ts` (lines 16-38)

- [ ] **Step 1: Rename the options helper.** In `apps/mobile/src/lib/lock.ts`, change the function declaration on line 16 from `export function defaultLockAtForOptions(` to `export function defaultDecidesByForCandidates(`. Leave the body (lines 17-28) unchanged.

- [ ] **Step 2: Drop the isFuzzy parameter from addCandidateHorizon.** Replace the whole `addCandidateHorizon` block (lines 30-38) with:
  ```ts
  export function addCandidateHorizon(earliestMs: number, latestMs: number): number {
    const span = latestMs - earliestMs;
    return latestMs + Math.min(span, 2 * DAY_MS);
  }
  ```
  (Removes the `isFuzzy: boolean` arg and the `if (isFuzzy) return latestMs;` branch - horizon is now computed from the time-candidate spread only.)

- [ ] **Step 3: Verify no other mobile caller still uses the old names.** Run:
  ```bash
  grep -rn "defaultLockAtForOptions\|addCandidateHorizon" apps/mobile/src
  ```
  Expected: the only `defaultLockAtForOptions` hit is the now-stale import in `CreateWizard.tsx` line 6 (fixed in Task 4.3); `addCandidateHorizon` should appear only in `lib/lock.ts` (it has no current mobile caller). If any other 3-arg `addCandidateHorizon(` call exists, note it for that file's phase.

- [ ] **Step 4: Commit.**
  ```bash
  git add apps/mobile/src/lib/lock.ts
  git commit -m "refactor(mobile): mirror lock.ts rename defaultDecidesByForCandidates + drop isFuzzy (DRP-41)"
  ```

### Task 4.2: Delete NewDial and FloatBoard from navigation; repoint Dashboard "New meetup"

Removes the dial front-door and the float board route, collapses `CreateWizard` to a no-param route, and sends the Dashboard CTA straight to `CreateWizard`.

**Files:**
- Delete: `apps/mobile/src/screens/NewDial.tsx`
- Modify: `apps/mobile/App.tsx` (imports lines 20, 23; `MeetupsStackParams` lines 27-33; navigator lines 46-56)
- Modify: `apps/mobile/src/screens/Dashboard.tsx` (line 559)

- [ ] **Step 1: Delete the NewDial screen file.**
  ```bash
  git rm apps/mobile/src/screens/NewDial.tsx
  ```
  (FloatBoard.tsx and FloatChip are deleted in the EventDetail/UI phase, not here. This task only un-mounts FloatBoard from navigation; its file removal is covered elsewhere. If FloatBoard.tsx has already been deleted by an earlier-merged phase, skip its import removal in Step 3 if `grep` shows it absent.)

- [ ] **Step 2: Remove the NewDial import from App.tsx.** Delete line 23: `import { NewDial } from "./src/screens/NewDial";`

- [ ] **Step 3: Remove the FloatBoard import from App.tsx.** Delete line 20: `import { FloatBoard } from "./src/screens/FloatBoard";`

- [ ] **Step 4: Collapse MeetupsStackParams.** Replace the whole `MeetupsStackParams` type (lines 27-33) with:
  ```ts
  export type MeetupsStackParams = {
    Dashboard: undefined;
    EventDetail: { eventId: string };
    CreateWizard: undefined;
  };
  ```
  (Drops `NewDial`, `FloatBoard`, and the `branch` param on `CreateWizard` per the contract: `CreateWizard: undefined`.)

- [ ] **Step 5: Remove the dropped screens from the navigator.** In `MeetupsStackScreen` (lines 46-56), delete these two lines:
  ```
        <MeetupsStack.Screen name="NewDial" component={NewDial} />
        <MeetupsStack.Screen name="FloatBoard" component={FloatBoard} />
  ```
  so the navigator body is exactly the Dashboard, EventDetail, and CreateWizard screens.

- [ ] **Step 6: Repoint the Dashboard "New meetup" button.** In `apps/mobile/src/screens/Dashboard.tsx` line 559, change:
  ```tsx
  <Button size="lg" label="New meetup" onPress={() => navigation.navigate("NewDial")} />
  ```
  to:
  ```tsx
  <Button size="lg" label="New meetup" onPress={() => navigation.navigate("CreateWizard")} />
  ```
  (`CreateWizard` is now param-free, so `navigate("CreateWizard")` with no second arg typechecks.)

- [ ] **Step 7: Typecheck.** Run:
  ```bash
  pnpm --filter @bethere/mobile typecheck
  ```
  Expected: FAIL. The remaining errors should be confined to `CreateWizard.tsx` (still reads `route.params.branch`, imports the renamed `defaultLockAtForOptions`, and calls `trpc.floats.create` / navigates to `FloatBoard`), plus `Dashboard.tsx` (still references `trpc.floats.mine`, `FloatBoard`, and the `Float` type). These are fixed in Task 4.3 and in the Dashboard/EventDetail phase respectively. Confirm there is NO error about `navigate("CreateWizard")` or about the deleted `NewDial`/`FloatBoard` screen registrations - that proves the navigation surgery is internally consistent.

- [ ] **Step 8: Commit.**
  ```bash
  git add apps/mobile/App.tsx apps/mobile/src/screens/Dashboard.tsx
  git commit -m "refactor(mobile): drop NewDial + FloatBoard routes, point New meetup at CreateWizard (DRP-41)"
  ```

### Task 4.3: Collapse CreateWizard to one flow calling trpc.events.create

Rewrite `CreateWizard.tsx` so there is no `branch`: a single step sequence `group -> activities -> times -> options -> confirm`, all candidate lists optional, locks default off, an editable "Decides by", a plain-English confirm mirror, and ONE `trpc.events.create` call with the unified `CreateEventInput`. Part-of-day chips resolve to concrete `timeCandidates` client-side (server fuzzy path is gone).

**Files:**
- Modify: `apps/mobile/src/screens/CreateWizard.tsx` (full rewrite of lines 1-404; keep the `ProgressDots`, `Step`, `RemovableChip`, `RemoveDot` helpers lines 406-497)

- [ ] **Step 1: Fix imports and drop the Branch machinery.** Replace lines 1-40 (the imports plus the `Branch`/`STEPS`/`TITLES`/`SUBMIT_LABELS` block) with:
  ```tsx
  import type { NativeStackScreenProps } from "@react-navigation/native-stack";
  import type { PartOfDay } from "@bethere/shared";
  import { type ReactNode, useEffect, useRef, useState } from "react";
  import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
  import type { MeetupsStackParams } from "../../App";
  import { dateStringFrom, formatSlot, isoFrom, splitIso, timeStringFrom } from "../lib/format";
  import { defaultDecidesByForCandidates } from "../lib/lock";
  import { trpc } from "../lib/trpc";
  import { font, ui } from "../theme";
  import {
    BackBar,
    Button,
    Card,
    Chip,
    DateTimePill,
    Field,
    ScreenBackground,
    ScreenLoading,
  } from "../ui";

  type Group = Awaited<ReturnType<typeof trpc.groups.mine.query>>[number];
  type Row = { id: string; date: string; time: string };
  type Props = NativeStackScreenProps<MeetupsStackParams, "CreateWizard">;

  const STEPS = ["group", "activities", "times", "options", "confirm"] as const;

  // Quick part-of-day chips resolve CLIENT-side to a concrete time candidate (today/tomorrow at the
  // band hour) so the server only ever sees concrete timeCandidates - there is no server fuzzy path.
  const PART_HOUR: Record<PartOfDay, number> = { morning: 9, afternoon: 14, evening: 19, late: 22 };
  ```
  (Dropped `Toggle` from the UI import; added `dateStringFrom`/`timeStringFrom`, the `PartOfDay` type, and the local `PART_HOUR` mirror.)

- [ ] **Step 2: Replace component state and the branch reads.** Replace the function signature and state block (old lines 42-66) with:
  ```tsx
  export function CreateWizard({ navigation }: Props) {
    const [step, setStep] = useState(0);
    const stepKey = STEPS[step];
    const isLastStep = step === STEPS.length - 1;

    const [groups, setGroups] = useState<Group[]>([]);
    const [groupId, setGroupId] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [location, setLocation] = useState("");
    const [description, setDescription] = useState("");
    // Activity ("what / where") candidates - chips, optional, no names ever shown.
    const [activityChips, setActivityChips] = useState<string[]>([]);
    const [activityDraft, setActivityDraft] = useState("");
    // Time candidates - concrete multi-row rows, optional. Part-of-day chips append concrete rows.
    const [rows, setRows] = useState<Row[]>([{ id: "t0", date: "", time: "" }]);
    const nextRowId = useRef(1);
    // Creator locks - both default OFF (open). Decides-by is editable.
    const [lockTimes, setLockTimes] = useState(false);
    const [lockThings, setLockThings] = useState(false);
    const [decidesEdit, setDecidesEdit] = useState(false);
    const [decidesDate, setDecidesDate] = useState("");
    const [decidesTime, setDecidesTime] = useState("");

    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

    const updateRow = (id: string, patch: Partial<Row>) =>
      setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  ```
  (No `route.params`; the whole `branch` const and the `lockEdit`/`ideaChips`/`timescale` state are gone, replaced by activity chips, lock booleans, and a decides-by editor.)

- [ ] **Step 3: Keep the group-load effect, rewrite the derived values.** Leave the `useEffect` (old lines 71-80) as-is. Replace the derived-value block (old lines 82-97) with:
  ```tsx
    const timeIsos = rows
      .map((r) => isoFrom(r.date, r.time))
      .filter((x): x is string => x !== null);
    const earliestMs = timeIsos.length
      ? Math.min(...timeIsos.map((iso) => new Date(iso).getTime()))
      : null;
    const autoDecidesIso =
      earliestMs != null
        ? new Date(defaultDecidesByForCandidates(earliestMs, Date.now())).toISOString()
        : null;
    const decidesOverrideIso = decidesEdit ? isoFrom(decidesDate, decidesTime) : null;
    const decidesInvalid =
      !!decidesOverrideIso &&
      earliestMs != null &&
      new Date(decidesOverrideIso).getTime() >= earliestMs;
    const decidesToSend =
      decidesEdit && decidesOverrideIso && !decidesInvalid ? decidesOverrideIso : undefined;
    // Concrete shortcut: exactly one time AND lockTimes => server opens the moment immediately.
    const isConcrete = timeIsos.length === 1 && lockTimes;
  ```

- [ ] **Step 4: Add the part-of-day quick-chip handler and rewrite validation.** Replace the old `valid` function plus the `commitDraftIdea`/`startEditLock` helpers (old lines 99-135) with:
  ```tsx
    // Append a concrete time row for a part-of-day chip: the next day that is still in the future
    // (today if the band hour has not passed, else tomorrow), at the band's hour.
    function addBandRow(band: PartOfDay) {
      const now = new Date();
      const day = new Date(now);
      day.setHours(PART_HOUR[band], 0, 0, 0);
      if (day.getTime() <= now.getTime()) day.setDate(day.getDate() + 1);
      setRows((rs) => {
        const next = [
          ...rs.filter((r) => r.date || r.time),
          { id: `t${nextRowId.current++}`, date: dateStringFrom(day), time: timeStringFrom(day) },
        ];
        return next.length ? next : rs;
      });
    }

    function valid(key: string): boolean {
      switch (key) {
        case "group":
          return !!groupId;
        case "options":
          return !decidesInvalid;
        default:
          return true; // activities, times, confirm - all optional
      }
    }

    // Fold the typed-but-not-added activity into the chip list (case-insensitive de-dup), returning
    // the resulting set so submit can use it synchronously.
    function commitDraftActivity(): string[] {
      const t = activityDraft.trim();
      if (!t) return activityChips;
      setActivityDraft("");
      if (activityChips.some((c) => c.toLowerCase() === t.toLowerCase())) return activityChips;
      const next = [...activityChips, t];
      setActivityChips(next);
      return next;
    }

    function startEditDecides() {
      if (autoDecidesIso) {
        const { date, time } = splitIso(autoDecidesIso);
        setDecidesDate(date);
        setDecidesTime(time);
      }
      setDecidesEdit(true);
    }
  ```

- [ ] **Step 5: Rewrite submit to the single unified create call.** Replace the old `submit` function (old lines 137-174) with:
  ```tsx
    async function submit() {
      if (busy || !groupId) return;
      setBusy(true);
      const activities = commitDraftActivity();
      try {
        await trpc.events.create.mutate({
          groupId,
          title: title.trim() || undefined,
          description: description.trim() || undefined,
          location: location.trim() || undefined,
          timeCandidates: timeIsos.map((startsAt) => ({ startsAt })),
          activityCandidates: activities.length ? activities : undefined,
          lockTimes,
          lockThings,
          decidesBy: decidesToSend,
        });
        navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] });
      } catch {
        setError(true);
        setBusy(false);
      }
    }
  ```
  (One call, always `events.create`, with the exact `CreateEventInput` field names: `timeCandidates` as `{ startsAt }[]`, `activityCandidates` as `string[]`, `lockTimes`/`lockThings` booleans, `decidesBy`. `title` is omitted when blank so the server resolves the winning activity into the title at lock.)

- [ ] **Step 6: Rewrite goNext/goBack to commit the activity draft.** Replace the old `goNext`/`goBack` (old lines 176-185) with:
  ```tsx
    function goNext() {
      if (!valid(stepKey) || busy) return;
      if (stepKey === "activities") commitDraftActivity();
      if (isLastStep) submit();
      else setStep(step + 1);
    }
    function goBack() {
      if (step > 0) setStep(step - 1);
      else navigation.goBack();
    }

    if (loading) return <ScreenLoading />;

    const nextLabel = isLastStep ? "Send to the group" : "Next";
  ```
  (Submit label is the contract's "Send to the group". The old per-branch `SUBMIT_LABELS[branch]` is gone.)

- [ ] **Step 7: Rewrite the header + progress.** Replace the `<ScreenBackground header=...>` open and `<ProgressDots .../>` (old lines 191-204) with a fixed title and the param-free steps:
  ```tsx
    return (
      <ScreenBackground header={<BackBar title="New meetup" onBack={goBack} />}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 24 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <ProgressDots steps={STEPS} index={step} />
  ```
  (`ProgressDots` already takes `steps: string[]`; passing the readonly `STEPS` is assignable. The error banner block at old lines 205-209 stays unchanged immediately after.)

- [ ] **Step 8: Replace the step bodies - group + activities.** The `group` step (old lines 211-229) stays unchanged. Replace the old `what` / `spark` steps (old lines 231-261) with the single `activities` step:
  ```tsx
            {stepKey === "activities" && (
              <Step
                title="What do you fancy?"
                sub="Drop a few options - what or where. Optional, and the group can add more. No names - it's the group's."
              >
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
                  {activityChips.map((c) => (
                    <RemovableChip
                      key={c}
                      label={c}
                      onRemove={() => setActivityChips((cs) => cs.filter((x) => x !== c))}
                    />
                  ))}
                </View>
                <Field
                  label="Add a place or thing"
                  optional
                  value={activityDraft}
                  onChangeText={setActivityDraft}
                  placeholder="bowling, the pub..."
                />
                <View style={{ flexDirection: "row", marginTop: 10 }}>
                  <Chip label="+ Add" onPress={commitDraftActivity} />
                </View>
              </Step>
            )}
  ```

- [ ] **Step 9: Replace the step bodies - times (multi-row + part-of-day quick chips).** Replace the old `window` step and BOTH `when` steps (old lines 263-316) with the single optional `times` step:
  ```tsx
            {stepKey === "times" && (
              <Step
                title="When could it be?"
                sub="Offer a time or two, or skip - people react and the best-supported wins. Optional."
              >
                {rows.map((r) => (
                  <View key={r.id} style={{ position: "relative", marginBottom: 10 }}>
                    <DateTimePill
                      dateValue={r.date}
                      timeValue={r.time}
                      onDate={(t) => updateRow(r.id, { date: t })}
                      onTime={(t) => updateRow(r.id, { time: t })}
                      minimumDate={new Date()}
                    />
                    {rows.length > 1 && (
                      <RemoveDot onPress={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} />
                    )}
                  </View>
                ))}
                <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 6 }}>
                  <Chip label="Morning" onPress={() => addBandRow("morning")} />
                  <Chip label="Afternoon" onPress={() => addBandRow("afternoon")} />
                  <Chip label="Evening" onPress={() => addBandRow("evening")} />
                  <Chip label="Late" onPress={() => addBandRow("late")} />
                </View>
                {rows.length < 10 && (
                  <Chip
                    label="+ Add a time"
                    onPress={() =>
                      setRows((rs) => [...rs, { id: `t${nextRowId.current++}`, date: "", time: "" }])
                    }
                  />
                )}
              </Step>
            )}
  ```
  (Cap is 10 to match `timeCandidates: z.array(...).max(10)` in `CreateEventInput`.)

- [ ] **Step 10: Replace the step bodies - options (locks + details + decides-by).** Replace the old `details` and `lock` steps (old lines 318-391) with a single `options` step that carries the location/notes, the two lock checkboxes (default off), and the editable "Decides by":
  ```tsx
            {stepKey === "options" && (
              <Step title="A few options" sub="All optional - skip if you like.">
                <Field
                  label="Location"
                  optional
                  value={location}
                  onChangeText={setLocation}
                  placeholder="TenPin Bexleyheath"
                />
                <Field
                  label="Notes"
                  optional
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Come at 6, we'll eat around 8"
                  multiline
                  style={{ marginTop: 12 }}
                />
                <CheckRow
                  label="Lock the times"
                  sub="The group can't add more times"
                  on={lockTimes}
                  onToggle={() => setLockTimes((v) => !v)}
                />
                <CheckRow
                  label="Lock the places"
                  sub="The group can't add more places or things"
                  on={lockThings}
                  onToggle={() => setLockThings((v) => !v)}
                />
                <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink, marginTop: 18 }}>
                  Decides by
                </Text>
                {decidesEdit ? (
                  <Card style={{ marginTop: 8 }}>
                    <DateTimePill
                      dateValue={decidesDate}
                      timeValue={decidesTime}
                      onDate={setDecidesDate}
                      onTime={setDecidesTime}
                      minimumDate={new Date()}
                    />
                    {decidesInvalid && (
                      <Text
                        style={{
                          fontFamily: font.medium,
                          fontSize: 11,
                          color: ui.brand,
                          marginTop: 8,
                        }}
                      >
                        It has to decide before your earliest time.
                      </Text>
                    )}
                    <View style={{ flexDirection: "row", marginTop: 12 }}>
                      <Chip
                        label="Use default"
                        onPress={() => {
                          setDecidesEdit(false);
                          setDecidesDate("");
                          setDecidesTime("");
                        }}
                      />
                    </View>
                  </Card>
                ) : (
                  <Card style={{ marginTop: 8 }}>
                    <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
                      {autoDecidesIso ? `Decides ${formatSlot(autoDecidesIso)}` : "A sensible deadline"}
                    </Text>
                    <Text
                      style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 3 }}
                    >
                      {autoDecidesIso
                        ? "before your earliest time - best-supported wins"
                        : "add times to set this, or we'll pick a horizon"}
                    </Text>
                    {autoDecidesIso && (
                      <View style={{ flexDirection: "row", marginTop: 10 }}>
                        <Chip label="Change" onPress={startEditDecides} />
                      </View>
                    )}
                  </Card>
                )}
              </Step>
            )}
  ```

- [ ] **Step 11: Add the confirm-mirror step.** Immediately after the `options` step block, add the `confirm` step (a plain-English mirror that states the outcome by shape, plus the contract's no-names line):
  ```tsx
            {stepKey === "confirm" && (
              <Step title="Ready to send?">
                <Card>
                  <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, lineHeight: 21 }}>
                    {confirmMirror({
                      timeCount: timeIsos.length,
                      activityCount:
                        activityChips.length + (activityDraft.trim() ? 1 : 0),
                      isConcrete,
                      firstTimeIso: timeIsos[0] ?? null,
                    })}
                  </Text>
                  <Text
                    style={{
                      fontFamily: font.medium,
                      fontSize: 12,
                      color: ui.muted,
                      marginTop: 12,
                      lineHeight: 18,
                    }}
                  >
                    No names - it's the group's.
                  </Text>
                </Card>
              </Step>
            )}
  ```
  (The Button block at old lines 393-399 and the closing tags stay unchanged.)

- [ ] **Step 12: Add the CheckRow + confirmMirror helpers; keep the existing helpers.** Keep `ProgressDots`, `Step`, `RemovableChip`, `RemoveDot` (old lines 406-497) verbatim. Add these two helpers at the end of the file (after `RemoveDot`):
  ```tsx
  function CheckRow({
    label,
    sub,
    on,
    onToggle,
  }: {
    label: string;
    sub: string;
    on: boolean;
    onToggle: () => void;
  }) {
    return (
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: "row", alignItems: "center", marginTop: 16 }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: ui.border,
            borderColor: ui.ink,
            backgroundColor: on ? ui.ink : "transparent",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          {on && (
            <Text style={{ fontFamily: font.bold, fontSize: 13, lineHeight: 13, color: "#fff" }}>
              ✓
            </Text>
          )}
        </View>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>{label}</Text>
          <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 1 }}>
            {sub}
          </Text>
        </View>
      </Pressable>
    );
  }

  // The plain-English outcome mirror. Three shapes per the contract:
  //  - one exact time + lockTimes => it just happens (the concrete shortcut)
  //  - 2+ times => a menu the group reacts to
  //  - 0 times => loose; the group floats times and the best-supported wins
  function confirmMirror({
    timeCount,
    activityCount,
    isConcrete,
    firstTimeIso,
  }: {
    timeCount: number;
    activityCount: number;
    isConcrete: boolean;
    firstTimeIso: string | null;
  }): string {
    const things =
      activityCount > 0
        ? ` The group picks from ${activityCount} ${activityCount === 1 ? "thing" : "things"} to do.`
        : " The group adds what to do.";
    if (isConcrete && firstTimeIso) {
      return `It's on for ${formatSlot(firstTimeIso)} - this one just happens, the group says who's in.${things}`;
    }
    if (timeCount >= 2) {
      return `You're offering ${timeCount} times - the group reacts and the best-supported one wins.${things}`;
    }
    return `No fixed time yet - the group floats times and the best-supported one wins.${things}`;
  }
  ```

- [ ] **Step 13: Typecheck.** Run:
  ```bash
  pnpm --filter @bethere/mobile typecheck
  ```
  Expected: `CreateWizard.tsx` is now clean (no `route.params`, no `trpc.floats`, no `FloatBoard`, no `defaultLockAtForOptions`, no `Toggle`). Any remaining errors should be only in `Dashboard.tsx`/`EventDetail.tsx`/`notifications.ts` from sibling phases (the `Float` type, `trpc.floats.mine`, FloatCard). If a `CreateEventInput` field-name error appears (e.g. unknown key `timeCandidates`), Phase 1/3 has not landed yet - block on it.

- [ ] **Step 14: Lint the touched files.** Run:
  ```bash
  pnpm --filter @bethere/mobile lint
  ```
  Expected: PASS for `CreateWizard.tsx`. Run `pnpm format` if biome reports fixable issues, then re-run.

- [ ] **Step 15: Commit.**
  ```bash
  git add apps/mobile/src/screens/CreateWizard.tsx
  git commit -m "feat(mobile): single CreateWizard flow -> unified events.create with confirm mirror (DRP-41)"
  ```

### Task 4.4: Manual smoke of the create flow (no automated coverage)

Mobile screens have no jest tests, so verify the three outcomes by reasoning and (if a device/simulator is available) a manual run. This is a checkpoint, not a code change.

**Files:** none (verification only).

- [ ] **Step 1: Trace the loose outcome.** With zero time rows and zero activity chips, confirm `submit()` sends `timeCandidates: []`, `activityCandidates: undefined`, `lockTimes: false`, `lockThings: false`, `decidesBy: undefined`. Confirm the confirm-mirror text reads "No fixed time yet - the group floats times and the best-supported one wins. The group adds what to do." and the no-names line shows.

- [ ] **Step 2: Trace the 2-3-times outcome.** With 2 time rows and `lockTimes` off, confirm `isConcrete` is false, `timeCandidates` has 2 entries, the mirror reads "You're offering 2 times - the group reacts and the best-supported one wins." and `decidesBy` defaults via `defaultDecidesByForCandidates` (auto, since `decidesEdit` is false -> `decidesToSend` undefined -> server defaults).

- [ ] **Step 3: Trace the one-exact-time outcome.** With exactly 1 time row and `lockTimes` ON, confirm `isConcrete` is true and the mirror reads "It's on for <slot> - this one just happens, the group says who's in." matching the backend concrete shortcut (one time candidate + `lockTimes===true` => phase `moment`).

- [ ] **Step 4: Confirm navigation lands on Dashboard.** After any submit, `navigation.reset({ index: 0, routes: [{ name: "Dashboard" }] })` returns to the dashboard, and the New-meetup button now opens `CreateWizard` with no intermediate dial. No `NewDial` or `FloatBoard` route remains reachable.

Notes for the executor:
- The confirm-mirror copy is fixed by the contract; do not paraphrase the three outcome strings or the "No names - it's the group's." line.
- `activityCount` in the confirm step counts the typed-but-unadded draft too (the `+ (activityDraft.trim() ? 1 : 0)`) so the mirror is honest before the user taps "+ Add"; `submit()` separately folds that draft in via `commitDraftActivity()`.
- The Dashboard's `floats.mine`/`FloatCard`/Brewing band and `notifications.ts` float scheduling are removed in the Dashboard phase, not here. This phase's typecheck is "green for the files I touched"; sibling-file errors are expected until those phases land in the same PR.
- Relevant absolute paths: `/Users/gong/Programming/drp_02/apps/mobile/src/screens/CreateWizard.tsx`, `/Users/gong/Programming/drp_02/apps/mobile/App.tsx`, `/Users/gong/Programming/drp_02/apps/mobile/src/screens/Dashboard.tsx`, `/Users/gong/Programming/drp_02/apps/mobile/src/lib/lock.ts`, `/Users/gong/Programming/drp_02/apps/mobile/src/screens/NewDial.tsx` (deleted).

---

## Phase 5: Unified voting board + dashboard + notifications

> Pre-reqs: Phases 1-4 are merged on the same `feat/*` branch (shared types renamed, DB migrated, `apps/api/src/routers/events.ts` reshaped, `floats.ts` deleted + unmounted, `CreateWizard.tsx` + `App.tsx` updated). This phase finishes the mobile client: the unified `CollectingView` (two candidate lists with public counts), the new `VoteChip`, the dashboard de-floating, and the notifications de-floating. All mobile work; no schema or tRPC procedure changes here.
>
> The contract read payloads this phase consumes (produced in Phase 3 `events.get` / `events.mine`):
> - `events.get` returns `{ timeCandidates: [{id, startsAt, partOfDay, count, mine}], activityCandidates: [{id, text, count, mine}], lockTimes, lockThings, decidesBy, msLeftToDecide, isCreator, title, location, description, phase, members, going, myStatus, myResponse, groupName, chosenStartsAt, momentEndsAt, ... }` (no more `candidates`, `whenMode`, `lockAt`, `msLeftToLock`, `myReactionCandidateIds`).
> - `events.mine` rows now include former-float collecting plans; `lockAt` -> `decidesBy`, `msLeftToLock` -> `msLeftToDecide`. `floats.mine` no longer exists.
>
> Mobile jest hangs the aggregate test runner, so every test run below is `pnpm --filter @bethere/mobile test` followed by `pkill -f jest`. These screens have no existing unit tests (they are RN components polled via tRPC), so this phase is implement-then-typecheck rather than TDD; the verification gate is `pnpm --filter @bethere/mobile typecheck` returning clean, plus `pnpm lint`.

### Task 5.1: Create `VoteChip` repurposed from `FloatChip`, register it, drop `FloatChip`

The contract repurposes `FloatChip`'s look into `src/ui/VoteChip.tsx` and deletes `FloatChip`. `VoteChip` is the row primitive for both candidate lists in `CollectingView`. It keeps the identical visual (hard-shadowed pill, filled-when-`mine`, public count badge) but is renamed for the new vocabulary (public momentum, not a float-only board).

**Files:**
- Create: `apps/mobile/src/ui/VoteChip.tsx`
- Modify: `apps/mobile/src/ui/index.ts` (line 13 `export { FloatChip } from "./FloatChip";`)
- Delete: `apps/mobile/src/ui/FloatChip.tsx`

- [ ] **Step 1: Create `VoteChip.tsx` from `FloatChip`'s body.** Write `apps/mobile/src/ui/VoteChip.tsx` with identical markup to `FloatChip` (lines 1-60 of the current file) but renamed export and updated doc comment:
  ```tsx
  import { Pressable, Text, View } from "react-native";
  import { font, ui } from "../theme";
  import { HardShadow } from "./HardShadow";

  // A votable candidate chip (time or activity): a label with a visible PUBLIC +1 count. Tapping
  // toggles the caller's own +1 (filled = you're in on it). Counts are public momentum during
  // collecting; names are never shown. One tap, optimistic.
  export function VoteChip({
    label,
    count,
    mine,
    onPress,
  }: {
    label: string;
    count: number;
    mine: boolean;
    onPress: () => void;
  }) {
    return (
      <HardShadow
        radius={ui.rInput}
        offset={ui.shadowInput}
        style={{ marginRight: 8, marginBottom: 8 }}
      >
        <Pressable
          onPress={onPress}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            backgroundColor: mine ? ui.ink : ui.surface,
            borderWidth: ui.border,
            borderColor: ui.ink,
            borderRadius: ui.rInput,
            paddingVertical: 7,
            paddingLeft: 13,
            paddingRight: 8,
          }}
        >
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: mine ? "#fff" : ui.ink }}>
            {label}
          </Text>
          <View
            style={{
              minWidth: 20,
              paddingHorizontal: 5,
              height: 19,
              borderRadius: 999,
              backgroundColor: mine ? "#fff" : ui.ink,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontFamily: font.mono, fontSize: 10, color: mine ? ui.ink : "#fff" }}>
              {count}
            </Text>
          </View>
        </Pressable>
      </HardShadow>
    );
  }
  ```

- [ ] **Step 2: Swap the barrel export.** In `apps/mobile/src/ui/index.ts`, replace line 13:
  ```ts
  export { FloatChip } from "./FloatChip";
  ```
  with (keeping alphabetical order - `VoteChip` sorts after `Toggle`, so move it to the end after line 22):
  - Delete the `export { FloatChip } from "./FloatChip";` line.
  - Add after `export { Toggle } from "./Toggle";`:
  ```ts
  export { VoteChip } from "./VoteChip";
  ```

- [ ] **Step 3: Delete the old component.** Run:
  ```bash
  rm /Users/gong/Programming/drp_02/apps/mobile/src/ui/FloatChip.tsx
  ```

- [ ] **Step 4: Confirm no other importer of `FloatChip` survives** (FloatBoard is deleted in Task 5.2, but verify nothing else references it). Run:
  ```bash
  grep -rn "FloatChip" /Users/gong/Programming/drp_02/apps/mobile/src
  ```
  Expected output: only `apps/mobile/src/screens/FloatBoard.tsx` (deleted in 5.2). If anything else appears, fix it. After 5.2 this grep must return nothing.

- [ ] **Step 5: Commit.**
  ```bash
  git add apps/mobile/src/ui/VoteChip.tsx apps/mobile/src/ui/index.ts apps/mobile/src/ui/FloatChip.tsx
  git commit -m "feat(ui): VoteChip repurposed from FloatChip for unified candidate lists (DRP-41)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.2: Delete `FloatBoard.tsx`

The float frontend is deleted; the unified `CollectingView` (Task 5.3) replaces it. `App.tsx` already dropped the `FloatBoard` route in Phase 4, so this just removes the orphaned screen file.

**Files:**
- Delete: `apps/mobile/src/screens/FloatBoard.tsx`

- [ ] **Step 1: Confirm `FloatBoard` is no longer routed.** It must already be removed from `MeetupsStackParams` + Navigator in Phase 4. Run:
  ```bash
  grep -rn "FloatBoard" /Users/gong/Programming/drp_02/apps/mobile/App.tsx /Users/gong/Programming/drp_02/apps/mobile/src
  ```
  Expected: only `apps/mobile/src/screens/FloatBoard.tsx` itself. If `App.tsx` still references it, that is a Phase 4 miss - fix the navigator first.

- [ ] **Step 2: Delete the file.**
  ```bash
  rm /Users/gong/Programming/drp_02/apps/mobile/src/screens/FloatBoard.tsx
  ```

- [ ] **Step 3: Verify the FloatChip grep from Task 5.1 Step 4 is now empty.**
  ```bash
  grep -rn "FloatChip" /Users/gong/Programming/drp_02/apps/mobile/src
  ```
  Expected: no output (exit code 1).

- [ ] **Step 4: Commit.**
  ```bash
  git add -A apps/mobile/src/screens/FloatBoard.tsx
  git commit -m "feat(mobile): delete FloatBoard - folded into unified CollectingView (DRP-41)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.3: Rewrite `EventDetail` `CollectingView` to render TIME + ACTIVITY candidate lists with public +1

This is the core of the phase. The current `CollectingView` (lines 513-691) is a private-pick checklist over `data.candidates` (one time list) using `trpc.events.react` (batched debounced reaction set) + the opt-out row. The contract replaces this with two PUBLIC vote lists - TIME and ACTIVITY - each a column of `VoteChip`s showing public counts + the caller's own `mine`, toggled one-at-a-time via `trpc.events.toggleReaction({ eventId, candidateId })`. Add controls are gated on `!lockTimes` / `!lockThings` and call `trpc.events.addCandidate` with `kind`. The opt-out row stays. The whole react/debounce/`SaveStatus`/`myReactionCandidateIds` machinery in the parent is removed (toggleReaction is one optimistic mutation per tap, the FloatBoard pattern).

**Files:**
- Modify: `apps/mobile/src/screens/EventDetail.tsx` (imports lines 6-33; parent state + handlers lines 42-213; read-payload field reads lines 225-231; `CollectingView` props at the call site lines 337-350; the `CollectingView` + `SaveStatus` functions lines 513-717; the fizzled copy line 385)

- [ ] **Step 1: Update imports.** In `EventDetail.tsx`, replace the format import block (lines 6-13) - drop `formatSlot` only if unused (it is still used by `formatSlot(c.startsAt)` in the new time list, keep it), drop `isoFrom`? (still needed by the add-time form, keep it). Replace the `addCandidateHorizon` import (line 14) signature usage stays but the `isFuzzy` arg is dropped in Step 9. Update the `../ui` import block (lines 19-33) to add `VoteChip`:
  ```tsx
  import {
    Avatar,
    BackBar,
    BottomSheet,
    Button,
    Card,
    DateTimePill,
    DetailError,
    Field,
    PersonRow,
    ScreenBackground,
    ScreenLoading,
    SelectCheck,
    StickerTag,
    Toggle,
    VoteChip,
  } from "../ui";
  ```
  (`Field` is added for the activity add form; `SelectCheck` stays for the opt-out row + conditional sheet.)

- [ ] **Step 2: Add the `partOfDayLabel` + `shortDayLabel` format imports** (the activity list has no time; the time list still uses `formatSlot`; the quick part-of-day display uses `partOfDayLabel`). The format import block becomes:
  ```tsx
  import {
    clock12,
    dayUpper,
    formatCountdown,
    formatSlot,
    isoFrom,
    partOfDayLabel,
  } from "../lib/format";
  ```
  (unchanged - all already imported; verify `partOfDayLabel` stays since the time VoteChip label uses it.)

- [ ] **Step 3: Retype the derived `Candidate` aliases.** Replace line 37:
  ```tsx
  type Candidate = Detail["candidates"][number];
  ```
  with the two new payload shapes:
  ```tsx
  type TimeCand = Detail["timeCandidates"][number];
  type ActivityCand = Detail["activityCandidates"][number];
  ```

- [ ] **Step 4: Strip the react/debounce/opt-out-batch machinery from the parent.** Remove the reaction-set state and timers (lines 54-63: `reactPicked`, `optedOutLocal`, `saveState`, `seededFor`, `pendingPicks`, `saveTimer` - keep `phaseRef`), `flushReact` (lines 82-96), the seed `useEffect` (lines 124-130), `toggleReact` (lines 135-145), `toggleOptOut` (lines 149-166), and `retrySave` (lines 169-180). Replace with optimistic single-candidate toggling mirroring FloatBoard's `toggle`:
  ```tsx
  // Suggestion ids with an in-flight toggleReaction: while pending we skip applying poll data so the
  // optimistic chip never flickers (the next clean poll reconciles the true public count).
  const pendingReact = useRef<Set<string>>(new Set());

  // One public +1 / un-+1 on a candidate (either kind), optimistic. Adding a reaction also clears
  // the caller's opt-out (server-side); a failed toggle reverts; the 5s poll reconciles.
  function toggleReaction(candidateId: string) {
    const flipMine = <T extends { id: string; mine: boolean; count: number }>(rows: T[]): T[] =>
      rows.map((c) =>
        c.id === candidateId ? { ...c, mine: !c.mine, count: c.count + (c.mine ? -1 : 1) } : c,
      );
    const flip = (d: Detail | null): Detail | null =>
      d
        ? {
            ...d,
            timeCandidates: flipMine(d.timeCandidates),
            activityCandidates: flipMine(d.activityCandidates),
            iOptedOut: false,
          }
        : d;
    setData(flip);
    pendingReact.current.add(candidateId);
    trpc.events.toggleReaction
      .mutate({ eventId, candidateId })
      .catch(() => setData(flip))
      .finally(() => pendingReact.current.delete(candidateId));
  }
  ```
  Note: `iOptedOut` is set false optimistically because the contract says "adding a reaction clears the caller's opt-out." If the read payload field is named differently in Phase 3 (confirm `data.iOptedOut`), match it. (`flipMine` over both lists is safe: only one list contains the id.)

- [ ] **Step 5: Gate the poll on the pending set.** In `load` (lines 65-74), guard the `setData` so an in-flight toggle is not clobbered, matching FloatBoard:
  ```tsx
  const load = useCallback(() => {
    return trpc.events.get
      .query({ id: eventId })
      .then((d) => {
        if (d && pendingReact.current.size === 0) setData(d);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [eventId]);
  ```
  Remove the `flushReact()` call from the `useFocusEffect` cleanup (line 115) - there is nothing batched to flush now. The cleanup becomes:
  ```tsx
      return () => {
        active = false;
        clearInterval(poll);
      };
  ```

- [ ] **Step 6: Replace `toggleOptOut` with a one-shot optimistic mutation** (the batched-clear version is gone). Add:
  ```tsx
  // "I can't make it" - a reversible, private exit. Optimistic; tapping any candidate above rejoins
  // (server clears the opt-out on a reaction). The 5s poll reconciles.
  function toggleOptOut() {
    const next = !(data?.iOptedOut ?? false);
    setData((d) => (d ? { ...d, iOptedOut: next } : d));
    trpc.events.setOptOut
      .mutate({ eventId, out: next })
      .catch(() => setData((d) => (d ? { ...d, iOptedOut: !next } : d)));
  }
  ```

- [ ] **Step 7: Rename the lock-deadline reads.** Replace line 226:
  ```tsx
  const liveMsToLock = data.lockAt ? new Date(data.lockAt).getTime() - now : 0;
  ```
  with:
  ```tsx
  const liveMsToDecide = data.decidesBy ? new Date(data.decidesBy).getTime() - now : 0;
  ```
  Update the collecting `CountdownBanner` (lines 259-261) to the new vocabulary:
  ```tsx
        {data.phase === "collecting" && data.decidesBy && (
          <CountdownBanner label="Decides by" ms={liveMsToDecide} note="most-wanted wins" />
        )}
  ```

- [ ] **Step 8: Rewrite the `CollectingView` call site** (lines 337-350) to pass the new shape - drop `picked`, `optedOut`, `saveState`, `onRetry`; pass `data` (already), `optedOut={data.iOptedOut}`, the new toggle handlers, and kind-aware add:
  ```tsx
        {data.phase === "collecting" && (
          <CollectingView
            data={data}
            optedOut={data.iOptedOut}
            busy={busy}
            onToggleReaction={toggleReaction}
            onToggleOptOut={toggleOptOut}
            onLock={lock}
            onAddTime={addTime}
            onAddActivity={addActivity}
          />
        )}
  ```

- [ ] **Step 9: Replace the parent `addCandidate` with two kind-specific helpers.** Replace lines 190-194:
  ```tsx
  // Anyone in the group can float a new time into the menu while collecting; refetch so it shows.
  function addCandidate(startsAt: string) {
    if (!data) return;
    return runAction(() => trpc.events.addCandidate.mutate({ eventId, startsAt }));
  }
  ```
  with:
  ```tsx
  // Add a candidate while collecting (server +1s it for the author); refetch so it shows. Kind-gated
  // server-side: a time when lockTimes / an activity when lockThings is FORBIDDEN (UI hides the add).
  function addTime(startsAt: string, partOfDay?: PartOfDay) {
    return runAction(() =>
      trpc.events.addCandidate.mutate(
        partOfDay
          ? { eventId, kind: "time", startsAt, partOfDay }
          : { eventId, kind: "time", startsAt },
      ),
    );
  }

  function addActivity(text: string) {
    return runAction(() => trpc.events.addCandidate.mutate({ eventId, kind: "activity", text }));
  }
  ```
  Add the type import at the top of the file (Metro type-only import is fine for the enum literal use; `PartOfDay` is a type here):
  ```tsx
  import type { PartOfDay } from "@bethere/shared";
  ```

- [ ] **Step 10: Rewrite the `CollectingView` function** (lines 513-691) with two `VoteChip` lists, gated add controls, footer anonymity line, and the opt-out row. Replace the entire function with:
  ```tsx
  // Collecting: PUBLIC vote board. Two candidate lists - TIME and ACTIVITY (what/where) - each a
  // VoteChip with its public +1 count + the caller's own tap. Add controls are hidden when the
  // creator locked that axis. No names - the counts are the group's momentum.
  function CollectingView({
    data,
    optedOut,
    busy,
    onToggleReaction,
    onToggleOptOut,
    onLock,
    onAddTime,
    onAddActivity,
  }: {
    data: Detail;
    optedOut: boolean;
    busy: boolean;
    onToggleReaction: (candidateId: string) => void;
    onToggleOptOut: () => void;
    onLock: (candidateId?: string) => void;
    onAddTime: (startsAt: string, partOfDay?: PartOfDay) => void;
    onAddActivity: (text: string) => void;
  }) {
    return (
      <View style={{ marginTop: 16 }}>
        <Text style={{ fontFamily: font.display, fontSize: 14, color: ui.ink, marginBottom: 4 }}>
          What do you fancy?
        </Text>
        <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginBottom: 10 }}>
          Tap what you're keen on - a +1 is the group's momentum, not a commitment.
        </Text>

        {(data.activityCandidates.length > 0 || !data.lockThings) && (
          <Section title="What / where">
            <ChipWrap>
              {data.activityCandidates.map((c: ActivityCand) => (
                <VoteChip
                  key={c.id}
                  label={c.text}
                  count={c.count}
                  mine={c.mine}
                  onPress={() => onToggleReaction(c.id)}
                />
              ))}
            </ChipWrap>
            {!data.lockThings && <AddActivity busy={busy} onAdd={onAddActivity} />}
          </Section>
        )}

        {(data.timeCandidates.length > 0 || !data.lockTimes) && (
          <Section title="When works?">
            <ChipWrap>
              {data.timeCandidates.map((c: TimeCand) => (
                <VoteChip
                  key={c.id}
                  label={timeChipLabel(c)}
                  count={c.count}
                  mine={c.mine}
                  onPress={() => onToggleReaction(c.id)}
                />
              ))}
            </ChipWrap>
            {!data.lockTimes && <AddTime busy={busy} data={data} onAdd={onAddTime} />}
          </Section>
        )}

        {/* Opt-out: a distinct, tinted row (private, reversible). */}
        <Pressable
          onPress={onToggleOptOut}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            padding: 12,
            borderRadius: ui.rInput,
            backgroundColor: "#F1EEF6",
            borderWidth: ui.border,
            borderColor: ui.ink,
          }}
        >
          <SelectCheck selected={optedOut} accent={ui.ink} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.ink }}>
              I can't make it
            </Text>
            <Text style={{ fontFamily: font.medium, fontSize: 10, color: ui.muted }}>
              you won't be asked again - tap anything above to rejoin
            </Text>
          </View>
        </Pressable>

        <Text
          style={{
            fontFamily: font.medium,
            fontSize: 10,
            color: ui.muted,
            textAlign: "center",
            marginTop: 16,
          }}
        >
          No names - just the group.
        </Text>

        {/* No manual lock for members (pure deadline); this dev-only button forces it for demos. */}
        {__DEV__ && data.isCreator && (
          <View style={{ marginTop: 16 }}>
            <Button
              label="Decide now (dev)"
              variant="outline"
              disabled={busy}
              onPress={() => onLock()}
            />
          </View>
        )}
      </View>
    );
  }

  // A time VoteChip label: the concrete slot, with the part-of-day hint appended when present.
  function timeChipLabel(c: TimeCand): string {
    const slot = formatSlot(c.startsAt);
    return c.partOfDay ? `${slot} · ${partOfDayLabel(c.partOfDay)}` : slot;
  }
  ```

- [ ] **Step 11: Add the `Section` + `ChipWrap` helpers** (ported from FloatBoard, which is deleted) below the `timeChipLabel` helper:
  ```tsx
  function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
      <View style={{ marginBottom: 22 }}>
        <Text style={{ fontFamily: font.display, fontSize: 13, color: ui.ink, marginBottom: 10 }}>
          {title}
        </Text>
        {children}
      </View>
    );
  }

  function ChipWrap({ children }: { children: ReactNode }) {
    return <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{children}</View>;
  }
  ```
  Add `ReactNode` to the React import at line 3:
  ```tsx
  import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
  ```
  (`useEffect` is now unused after removing the seed effect - drop it if so; verify with typecheck in Step 14 and remove if flagged.)

- [ ] **Step 12: Add the `AddActivity` inline-field helper** (ported from FloatBoard's `AddIdea`, retitled to the activity vocabulary), placed after `ChipWrap`:
  ```tsx
  // Inline free-text activity entry: a + that opens a field; de-duped case-insensitively server-side.
  function AddActivity({ busy, onAdd }: { busy: boolean; onAdd: (text: string) => void }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState("");
    if (!open) {
      return (
        <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ marginTop: 2 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>
            + add a place/thing
          </Text>
        </Pressable>
      );
    }
    const submit = () => {
      const t = text.trim();
      if (!t) return;
      onAdd(t);
      setText("");
      setOpen(false);
    };
    return (
      <View style={{ marginTop: 6 }}>
        <Field
          label="Add a place or thing"
          value={text}
          onChangeText={setText}
          placeholder="bowling, the pub..."
        />
        <View style={{ flexDirection: "row", gap: 16, marginTop: 12, justifyContent: "flex-end" }}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setText("");
              setOpen(false);
            }}
          >
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
          </Pressable>
          <View style={{ width: 110 }}>
            <Button
              label="Add"
              variant="primary"
              disabled={busy || !text.trim()}
              onPress={submit}
            />
          </View>
        </View>
      </View>
    );
  }
  ```

- [ ] **Step 13: Add the `AddTime` helper** - reuse the concrete date/time picker from the OLD `CollectingView` (the `DateTimePill` form, lines 619-676), now with the `addCandidateHorizon` call updated to the new no-`isFuzzy` signature (Phase 4 dropped the boolean from the mobile mirror `lib/lock.ts`). Place it after `AddActivity`:
  ```tsx
  // Inline concrete time entry: a + that opens a date/time pill, bounded to a sensible horizon from
  // the existing candidate spread. De-duped by minute server-side.
  function AddTime({
    busy,
    data,
    onAdd,
  }: {
    busy: boolean;
    data: Detail;
    onAdd: (startsAt: string, partOfDay?: PartOfDay) => void;
  }) {
    const [open, setOpen] = useState(false);
    const [newDate, setNewDate] = useState("");
    const [newTime, setNewTime] = useState("");
    const newIso = isoFrom(newDate, newTime);

    const times = data.timeCandidates.map((c: TimeCand) => new Date(c.startsAt).getTime());
    const decideMs = data.decidesBy ? new Date(data.decidesBy).getTime() : Date.now();
    const addMinDate = new Date(Math.max(Date.now(), decideMs));
    const addMaxDate = new Date(
      times.length
        ? addCandidateHorizon(Math.min(...times), Math.max(...times))
        : decideMs + 14 * 24 * 60 * 60 * 1000,
    );

    if (!open) {
      return (
        <Pressable onPress={() => setOpen(true)} hitSlop={6} style={{ marginTop: 2 }}>
          <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.brand }}>+ add a time</Text>
        </Pressable>
      );
    }
    return (
      <Card style={{ marginTop: 8 }}>
        <DateTimePill
          dateValue={newDate}
          timeValue={newTime}
          onDate={setNewDate}
          onTime={setNewTime}
          minimumDate={addMinDate}
          maximumDate={addMaxDate}
        />
        <View style={{ flexDirection: "row", gap: 16, marginTop: 14, justifyContent: "flex-end" }}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              setNewDate("");
              setNewTime("");
              setOpen(false);
            }}
          >
            <Text style={{ fontFamily: font.bold, fontSize: 13, color: ui.muted }}>Cancel</Text>
          </Pressable>
          <View style={{ width: 110 }}>
            <Button
              label="Add"
              variant="primary"
              disabled={busy || !newIso}
              onPress={() => {
                if (!newIso) return;
                onAdd(newIso);
                setNewDate("");
                setNewTime("");
                setOpen(false);
              }}
            />
          </View>
        </View>
      </Card>
    );
  }
  ```
  Then DELETE the now-orphaned `SaveStatus` function (old lines 693-717) and remove `SaveState` from the type aliases (line 39) and the `ActivityIndicator` import if unused (verify in typecheck).

- [ ] **Step 14: Fix the fizzled copy vocabulary.** Replace line 385:
  ```tsx
                Not enough people were free this time - no worries, no fuss. Float another whenever.
  ```
  with:
  ```tsx
                Not enough people were keen this time - no worries, no fuss. Suggest another whenever.
  ```

- [ ] **Step 15: Typecheck the mobile package** (this is the verification gate for the rewrite - it catches every renamed read field, dropped prop, and stale alias):
  ```bash
  pnpm --filter @bethere/mobile typecheck
  ```
  Expected: clean exit (no errors). If it reports `Property 'candidates'/'lockAt'/'whenMode'/'myReactionCandidateIds' does not exist on type Detail`, those are leftover reads - fix them. If `useEffect`/`ActivityIndicator`/`SaveState`/`SelectCheck` are flagged unused, drop the unused import/alias.

- [ ] **Step 16: Lint + format.**
  ```bash
  pnpm --filter @bethere/mobile lint
  ```
  Expected: clean. Run `pnpm format` if biome flags style.

- [ ] **Step 17: Commit.**
  ```bash
  git add apps/mobile/src/screens/EventDetail.tsx
  git commit -m "feat(mobile): unified CollectingView - public TIME + ACTIVITY vote lists via toggleReaction (DRP-41)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.4: De-float the Dashboard (drop `floats.mine` + `FloatCard` + Brewing band)

The dashboard currently fetches `trpc.floats.mine`, renders a lavender "Brewing" `SectionBand` of `FloatCard`s linking to `FloatBoard`, and navigates "New meetup" to `NewDial`. The contract: former floats now arrive as `collecting` rows from `events.mine`, so the Brewing band, `floats` state, the `FloatCard` component, and the `Float` type all go; "New meetup" navigates straight to `CreateWizard`; `lockAt`->`decidesBy` reads update.

**Files:**
- Modify: `apps/mobile/src/screens/Dashboard.tsx` (`Float` type line 26; `SectionBand` tone union lines 44-56; `FloatCard` lines 342-370; `floats` state line 374; the fetch `Promise.all` + `syncReminders` call lines 385-399; `deadlineMs`/`remainingFrac` `lockAt` reads lines 224, 235-237; the Brewing render block lines 501-513; the "New meetup" nav line 559)

- [ ] **Step 1: Drop the `Float` type alias.** Delete line 26:
  ```tsx
  type Float = Awaited<ReturnType<typeof trpc.floats.mine.query>>[number];
  ```

- [ ] **Step 2: Simplify `SectionBand` to the single `action` tone** (the `brewing` lavender tone is now unused). Replace the `tone` prop (lines 44-56) - change the type to drop `"brewing"`:
  ```tsx
  function SectionBand({
    title,
    count,
    children,
  }: {
    title: string;
    count: number;
    children: ReactNode;
  }) {
    const bg = ui.brand;
    const fg = "#fff";
  ```
  Update the doc comment above (lines 40-43) to drop the two-tone description:
  ```tsx
  // A full-bleed banded section (edge-to-edge, ink rules top + bottom, same motif as the timer
  // banners) that COVERS a whole group of cards - an uppercase heading + count over the children.
  // The loud pink "Action required" band: plans that want your urgent answer.
  ```

- [ ] **Step 3: Delete the `FloatCard` component** (lines 342-370) entirely - the doc comment plus the function.

- [ ] **Step 4: Drop `floats` state.** Delete line 374:
  ```tsx
  const [floats, setFloats] = useState<Float[]>([]);
  ```

- [ ] **Step 5: Drop `floats.mine` from the fetch and fix `syncReminders`.** Replace the `fetchAll` body (lines 385-399):
  ```tsx
      const fetchAll = () =>
        Promise.all([trpc.events.mine.query(), trpc.groups.mine.query()])
          .then(([e, g]) => {
            if (active) {
              setEvents(e);
              setHasGroups(g.length > 0);
              setError(false);
              // Schedule local deadline/moment reminders from the freshest payload (no-op unless
              // something reminder-relevant changed). Device-local; fine for supervised demos.
              syncReminders(e);
            }
          })
          .catch(() => active && setError(true))
          .finally(() => active && setLoading(false));
  ```

- [ ] **Step 6: Rename the `lockAt` deadline reads to `decidesBy`.** In `deadlineMs` (line 224):
  ```tsx
    const iso = e.phase === "moment" ? e.momentEndsAt : e.decidesBy;
  ```
  In `remainingFrac` (lines 235-237):
  ```tsx
    } else if (e.phase === "collecting" && e.decidesBy) {
      end = new Date(e.decidesBy).getTime();
      start = new Date(e.createdAt).getTime();
    }
  ```

- [ ] **Step 7: Update the `action`-band caller and remove the Brewing render block.** The `SectionBand` for Action required (lines 487-499) drops its `tone` prop:
  ```tsx
                {actionItems.length > 0 && (
                  <SectionBand title="Action required" count={actionItems.length}>
                    {actionItems.map((e, i) => (
                      <ActionCard
                        key={e.id}
                        e={e}
                        now={now}
                        last={i === actionItems.length - 1}
                        onPress={() => navigation.navigate("EventDetail", { eventId: e.id })}
                      />
                    ))}
                  </SectionBand>
                )}
  ```
  Then DELETE the entire Brewing block (lines 501-513):
  ```tsx
                {floats.length > 0 && (
                  <SectionBand title="Brewing" count={floats.length} tone="brewing">
                    {floats.map((f, i) => ( ... ))}
                  </SectionBand>
                )}
  ```

- [ ] **Step 8: Point "New meetup" at `CreateWizard`.** Replace line 559:
  ```tsx
            <Button size="lg" label="New meetup" onPress={() => navigation.navigate("NewDial")} />
  ```
  with (the route is now param-less per the contract `CreateWizard: undefined`):
  ```tsx
            <Button
              size="lg"
              label="New meetup"
              onPress={() => navigation.navigate("CreateWizard")}
            />
  ```

- [ ] **Step 9: Vocabulary sweep on the collecting `CardFooter` + sticker.** In `CardFooter` collecting branch (lines 119-132) the candidate count line currently reads `${e.candidateCount} times`; with two lists this should read in the unified vocabulary. Update to:
  ```tsx
    if (e.phase === "collecting") {
      return (
        <>
          <DateChip>{`${e.candidateCount} on the table`}</DateChip>
          <Hint>
            {e.myStatus === "declined"
              ? "You're sitting this out"
              : e.iReacted
                ? "You've had your say"
                : "Tap to weigh in"}
          </Hint>
        </>
      );
    }
  ```
  In `cardSticker` (line 168) the collecting sticker `"Which times?"` becomes the kind-agnostic prompt:
  ```tsx
    if (e.phase === "collecting")
      return e.myStatus === "declined" ? null : <StickerTag label="Weigh in" />;
  ```
  In `actionVerb` (lines 218-220) the collecting verb `"Pick your times"` becomes:
  ```tsx
  function actionVerb(e: Ev): string {
    return e.phase === "moment" ? "Say if you're in" : "Have your say";
  }
  ```
  In `ActionCard` (line 324) the collecting spec `${e.candidateCount} options` and countdown word `"locks"` (line 323) become:
  ```tsx
    const countdownWord = isMoment ? "closes" : "decides";
    const spec = isMoment ? formatSlot(e.startsAt) : `${e.candidateCount} on the table`;
  ```

- [ ] **Step 10: Typecheck.**
  ```bash
  pnpm --filter @bethere/mobile typecheck
  ```
  Expected: clean. If `trpc.floats` is flagged (the router is unmounted in Phase 4), that confirms the float reads are gone. If `e.lockAt`/`tone`/`Float` remain, fix.

- [ ] **Step 11: Lint.**
  ```bash
  pnpm --filter @bethere/mobile lint
  ```
  Expected: clean.

- [ ] **Step 12: Commit.**
  ```bash
  git add apps/mobile/src/screens/Dashboard.tsx
  git commit -m "feat(mobile): dashboard de-floated - collecting plans from events.mine, drop Brewing band (DRP-41)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.5: Drop float scheduling from notifications + rename `lockAt`->`decidesBy`

`notifications.ts` has a `ReminderFloat` type, a `FLOAT_LEAD_MS`, a `floats` param to `syncReminders`, the float signature segment, and a "brewing" reschedule loop. The contract drops all float scheduling and renames `lockAt`->`decidesBy` in the reminder event subset (the collecting "locks soon" reminder now keys off `decidesBy`).

**Files:**
- Modify: `apps/mobile/src/lib/notifications.ts` (`ReminderEvent` Pick line 9-12; `ReminderFloat` lines 17-20; `FLOAT_LEAD_MS` line 34; `syncReminders` signature + body lines 65-129)

- [ ] **Step 1: Rename `lockAt`->`decidesBy` in the `ReminderEvent` subset.** Replace lines 9-12:
  ```tsx
  export type ReminderEvent = Pick<
    Awaited<ReturnType<typeof trpc.events.mine.query>>[number],
    "id" | "title" | "phase" | "myStatus" | "iReacted" | "lockAt" | "momentEndsAt"
  >;
  ```
  with:
  ```tsx
  export type ReminderEvent = Pick<
    Awaited<ReturnType<typeof trpc.events.mine.query>>[number],
    "id" | "title" | "phase" | "myStatus" | "iReacted" | "decidesBy" | "momentEndsAt"
  >;
  ```

- [ ] **Step 2: Delete the `ReminderFloat` type** (lines 17-20, plus its 3-line doc comment lines 14-16):
  ```tsx
  // A brewing float, for the "pile on before it tips" nudge. ...
  export type ReminderFloat = Pick< ... >;
  ```
  Remove the whole block.

- [ ] **Step 3: Drop `FLOAT_LEAD_MS`.** Delete line 34:
  ```tsx
  const FLOAT_LEAD_MS = 30 * 60 * 1000; // "pile on" nudge this far before a float tips
  ```

- [ ] **Step 4: Drop the `floats` param + rename the signature in `syncReminders`.** Replace the signature (lines 65-72):
  ```tsx
  export async function syncReminders(
    events: ReminderEvent[],
    floats: ReminderFloat[] = [],
  ): Promise<void> {
    const signature = `${events
      .map((e) => `${e.id}:${e.phase}:${e.myStatus}:${e.iReacted}:${e.lockAt}:${e.momentEndsAt}`)
      .join("|")}#${floats.map((f) => `${f.id}:${f.tipAt}`).join("|")}`;
    if (signature === lastSignature) return;
  ```
  with:
  ```tsx
  export async function syncReminders(events: ReminderEvent[]): Promise<void> {
    const signature = events
      .map((e) => `${e.id}:${e.phase}:${e.myStatus}:${e.iReacted}:${e.decidesBy}:${e.momentEndsAt}`)
      .join("|");
    if (signature === lastSignature) return;
  ```

- [ ] **Step 5: Rename the collecting reminder reads `lockAt`->`decidesBy`.** Replace the collecting block (lines 83-99):
  ```tsx
        if (e.phase === "collecting" && e.decidesBy) {
          const decideMs = new Date(e.decidesBy).getTime();
          if (!e.iReacted && decideMs - LOCK_LEAD_MS > now) {
            await schedule(
              new Date(decideMs - LOCK_LEAD_MS),
              "Decides soon",
              `"${e.title}" decides ${formatSlot(e.decidesBy)} - tap what you're keen on.`,
            );
          }
          if (decideMs > now) {
            await schedule(
              new Date(decideMs),
              "Who's in?",
              `"${e.title}" just opened for the moment - say if you're in.`,
            );
          }
        }
  ```

- [ ] **Step 6: Delete the brewing-floats reschedule loop** (lines 112-123, plus the 2-line comment above it):
  ```tsx
      // Brewing floats: a "pile on before it tips" nudge. ...
      for (const f of floats) { ... }
  ```
  Remove the whole block, leaving the `lastSignature = signature;` line (124-125) directly after the events loop.

- [ ] **Step 7: Rename `LOCK_LEAD_MS` for clarity** (optional but keeps vocabulary honest - it now leads the decides-by deadline). Update line 32:
  ```tsx
  const DECIDE_LEAD_MS = 60 * 60 * 1000; // "decides soon" reminder this far before the deadline
  ```
  and update its two uses in the collecting block (Step 5) from `LOCK_LEAD_MS` to `DECIDE_LEAD_MS`. (If you prefer minimal churn, keep `LOCK_LEAD_MS`; the contract only mandates the field/vocabulary renames, not this constant.)

- [ ] **Step 8: Typecheck.**
  ```bash
  pnpm --filter @bethere/mobile typecheck
  ```
  Expected: clean. The `ReminderEvent` `Pick` over `"decidesBy"` compiler-enforces the field exists on `events.mine` (a stale `lockAt` here would fail the build - this is the intended guard). The Dashboard `syncReminders(e)` one-arg call (Task 5.4 Step 5) must now match the one-arg signature.

- [ ] **Step 9: Lint.**
  ```bash
  pnpm --filter @bethere/mobile lint
  ```
  Expected: clean.

- [ ] **Step 10: Commit.**
  ```bash
  git add apps/mobile/src/lib/notifications.ts
  git commit -m "feat(mobile): notifications drop float scheduling, lockAt->decidesBy (DRP-41)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

### Task 5.6: Full-package verification + vocabulary grep sweep

Catch any straggler float vocabulary or stale read fields across the mobile app before the PR.

**Files:**
- Verify only: `apps/mobile/src`

- [ ] **Step 1: Grep for surviving float/lock vocabulary in mobile** (these should all be gone after Tasks 5.1-5.5):
  ```bash
  grep -rniE "float|brewing|auto-tip|tipAt|whenMode|lockAt|msLeftToLock|FloatChip|FloatBoard|NewDial|myReactionCandidateIds" /Users/gong/Programming/drp_02/apps/mobile/src /Users/gong/Programming/drp_02/apps/mobile/App.tsx
  ```
  Expected: no output. Any hit is a straggler - fix it (note: `App.tsx` `NewDial`/`FloatBoard` removal is Phase 4, but verify here it actually landed). Vocabulary targets per the contract: "the moment"/"Float it"/"spark" -> "Decides by"/"Catching on"/"what do you fancy?"/"who's in?".

- [ ] **Step 2: Grep for the new canonical names being present** (sanity that the rename landed, not just that the old names vanished):
  ```bash
  grep -rniE "toggleReaction|decidesBy|msLeftToDecide|VoteChip|timeCandidates|activityCandidates|lockTimes|lockThings" /Users/gong/Programming/drp_02/apps/mobile/src
  ```
  Expected: hits in `EventDetail.tsx`, `Dashboard.tsx`, `notifications.ts`, `ui/VoteChip.tsx`, `ui/index.ts` (and `CreateWizard.tsx` from Phase 4).

- [ ] **Step 3: Full mobile typecheck.**
  ```bash
  pnpm --filter @bethere/mobile typecheck
  ```
  Expected: clean.

- [ ] **Step 4: Mobile tests** (per-package, then kill the leaked jest handle per MEMORY):
  ```bash
  pnpm --filter @bethere/mobile test; pkill -f jest
  ```
  Expected: existing suites pass (no component tests cover these screens; this confirms nothing regressed in `lib/` helpers). If a `lib/lock.test.ts` exercises `addCandidateHorizon`, confirm it was updated to the no-`isFuzzy` signature in Phase 4.

- [ ] **Step 5: Full-workspace lint** (biome over everything touched):
  ```bash
  pnpm lint
  ```
  Expected: clean (or `pnpm format` then re-run).

- [ ] **Step 6: Final commit if the sweep changed anything** (otherwise skip):
  ```bash
  git add -A apps/mobile
  git commit -m "chore(mobile): vocabulary sweep - finish de-floating the client (DRP-41)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

> Hand-off to the PR phase: at this point `apps/mobile` no longer imports `trpc.floats.*`, renders no float UI, and consumes the unified `events.get`/`events.mine` payloads. The full type chain (shared -> api -> mobile) compiles, so the single PR (`feat/*` -> `dev`) carries frontend + backend + shared together as the contract requires.

---

Files I read to verify line numbers and exact code:
- `/Users/gong/Programming/drp_02/apps/mobile/src/screens/EventDetail.tsx`
- `/Users/gong/Programming/drp_02/apps/mobile/src/screens/Dashboard.tsx`
- `/Users/gong/Programming/drp_02/apps/mobile/src/screens/FloatBoard.tsx`
- `/Users/gong/Programming/drp_02/apps/mobile/src/ui/FloatChip.tsx`
- `/Users/gong/Programming/drp_02/apps/mobile/src/ui/index.ts`
- `/Users/gong/Programming/drp_02/apps/mobile/src/lib/notifications.ts`
- `/Users/gong/Programming/drp_02/apps/mobile/src/lib/lock.ts` (mirror signature for `addCandidateHorizon`)
- `/Users/gong/Programming/drp_02/apps/mobile/src/lib/format.ts` (helpers reused: `formatSlot`, `partOfDayLabel`, `isoFrom`, `shortDayLabel`)

---

## Phase 6: Seed data + test rewrites

This phase rewrites the demo seed and its integrity checks so the `Plan` fixture model matches the unified contract (no `whenMode`, no `minHeat`, no floats), rewrites `seed.ts` to write activity candidates + public reactions instead of float-table rows, fixes the two affected test files, and deletes `reconcile.test.ts`. It assumes the shared schema (`CandidateKind`, `PlanPhase` without `floating`), the DB schema/migration (Phase for DB), and `lock.ts` rename (`defaultDecidesByForCandidates`, dropped `defaultLockAtForWindow`, `addCandidateHorizon` losing its `isFuzzy` arg) have already landed in earlier phases. Steps reference the EXACT contract names: `kind` (`"time"`/`"activity"`), `lockTimes`, `lockThings`, `decidesBy`, `isAnonymous` always true.

> Test runner note: `apps/api` uses `node:test` (run `node --import tsx --test`); `packages/shared` uses Vitest. The aggregate `pnpm test` hangs (mobile jest leaks a handle) - run per-package commands shown below and `pkill -f jest` afterward only if you ran a mobile test.

### Task 6.1: Delete reconcile.test.ts (and confirm reconcile.ts is gone)

`packages/shared/src/logic/reconcile.test.ts` still exists (5098 bytes) and `reconcile.ts` is still present. The contract says delete both `reconcile.ts` + `reconcile.test.ts` (settleCollecting's most-voted-wins replaces them). `reconcile.ts` source deletion belongs to the shared-logic phase; this step removes the test and verifies the source is handled.

**Files:**
- Delete: `packages/shared/src/logic/reconcile.test.ts`
- Verify deletion (owned by shared-logic phase): `packages/shared/src/logic/reconcile.ts`

- [ ] **Step 1: Confirm nothing else imports reconcile.** Run:
  ```bash
  grep -rn "reconcile" /Users/gong/Programming/drp_02/packages/shared/src /Users/gong/Programming/drp_02/apps/api/src
  ```
  Expected: only matches inside `reconcile.ts` / `reconcile.test.ts` themselves (no importer in `events.ts`, `index.ts`, etc.). If an importer remains, it is an earlier-phase leftover - stop and resolve it there.

- [ ] **Step 2: Delete the test file.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 rm packages/shared/src/logic/reconcile.test.ts
  ```
  Expected output: `rm 'packages/shared/src/logic/reconcile.test.ts'`.

- [ ] **Step 3: Confirm reconcile.ts is deleted (or delete it if still present).** Run:
  ```bash
  test -f /Users/gong/Programming/drp_02/packages/shared/src/logic/reconcile.ts && git -C /Users/gong/Programming/drp_02 rm packages/shared/src/logic/reconcile.ts || echo "already gone"
  ```
  Expected: either `rm 'packages/shared/src/logic/reconcile.ts'` or `already gone`.

- [ ] **Step 4: Verify shared still compiles + tests collect.** Run:
  ```bash
  pnpm --filter @bethere/shared typecheck && pnpm --filter @bethere/shared test
  ```
  Expected: typecheck passes; Vitest runs with no reference to the deleted `reconcile` files and no "file not found" error. (`lock.test.ts` may still FAIL here - that is Task 6.5.)

- [ ] **Step 5: Commit.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 commit -m "test(shared): delete reconcile.test.ts (most-voted-wins supersedes it) (DRP-33)"
  ```

### Task 6.2: Rewrite the seed-data.ts Plan model (drop whenMode/minHeat/floats, add kind + locks)

`apps/api/src/db/seed-data.ts` currently imports `FloatAxis` and `WhenMode` (lines 1-8), defines a `FloatSugg` interface (lines 59-66), and a `Plan` interface (lines 72-95) carrying `whenMode`, `minHeat`, `floatSuggestions`. We reshape the model so a `Plan` carries a unified candidate list where each `Cand` has a `kind` (`"time"`/`"activity"`), plus `lockTimes`/`lockThings`, and rename `lockAt` -> `decidesBy`.

**Files:**
- Modify: `apps/api/src/db/seed-data.ts` (imports L1-8; `Cand` L50-56; `FloatSugg` L57-66; `Plan` L72-95; `PLANS` comment L97-99)

- [ ] **Step 1: Fix the type imports.** Replace the import block (lines 1-8):
  ```ts
  import type {
    Conditional,
    FloatAxis,
    PartOfDay,
    PlanPhase,
    ResponseKind,
    WhenMode,
  } from "@bethere/shared";
  ```
  with (drop `FloatAxis`, `WhenMode`; add `CandidateKind`):
  ```ts
  import type {
    CandidateKind,
    Conditional,
    PartOfDay,
    PlanPhase,
    ResponseKind,
  } from "@bethere/shared";
  ```

- [ ] **Step 2: Extend `Cand` with `kind` and make `startsAt` optional.** Activity candidates have no `startsAt`; time candidates always set it. Replace the `Cand` interface (lines 50-56):
  ```ts
  export interface Cand {
    suffix: string;
    startsAt: Date;
    partOfDay?: PartOfDay;
    label?: string;
    reactedBy?: string[];
  }
  ```
  with:
  ```ts
  // A candidate on a plan: a TIME (startsAt set, optional partOfDay hint) or an ACTIVITY (label set,
  // startsAt null). `reactedBy` are the (now PUBLIC) +1 backers.
  export interface Cand {
    suffix: string;
    kind: CandidateKind;
    startsAt?: Date;
    partOfDay?: PartOfDay;
    label?: string;
    reactedBy?: string[];
  }
  ```

- [ ] **Step 3: Delete the `FloatSugg` interface.** Remove the comment + interface (lines 57-66):
  ```ts
  // A chip on a float: a free-text IDEA, or a loose TIME band (a `day` relative to now at `partOfDay`).
  // `votedBy` are the (private) +1 backers. Mirrors Cand, but for the floating phase.
  export interface FloatSugg {
    suffix: string;
    axis: FloatAxis;
    text?: string;
    partOfDay?: PartOfDay;
    day?: number;
    votedBy?: string[];
  }
  ```
  (delete entirely - nothing replaces it.)

- [ ] **Step 4: Reshape the `Plan` interface.** Replace the `Plan` interface (lines 72-95):
  ```ts
  export interface Plan {
    id: string;
    groupId: string;
    createdBy: string;
    title: string;
    location?: string;
    whenMode: WhenMode;
    contingent: boolean;
    quorum: number;
    phase: PlanPhase;
    candidates: Cand[];
    // Floats only: unsigned + ownerless, the tip min-heat, and the two-axis chips with their +1s.
    // A floating plan carries no candidates; its `lockAt` is the tip deadline.
    isAnonymous?: boolean;
    minHeat?: number;
    floatSuggestions?: FloatSugg[];
    // When a collecting plan auto-locks the winning slot and opens the moment. Must sit before the
    // earliest candidate. Null/absent for exact plans (no collecting phase).
    lockAt?: Date;
    chosenSuffix?: string;
    momentStartsAt?: Date;
    momentEndsAt?: Date;
    responses?: Resp[];
  }
  ```
  with (drop `whenMode`, `minHeat`, `floatSuggestions`; add `lockTimes`/`lockThings`; rename `lockAt` -> `decidesBy`; `isAnonymous` defaults true at insert):
  ```ts
  export interface Plan {
    id: string;
    groupId: string;
    createdBy: string;
    title: string;
    location?: string;
    contingent: boolean;
    quorum: number;
    phase: PlanPhase;
    // Unified candidate list: any mix of kind "time" and kind "activity". Reactions are PUBLIC.
    candidates: Cand[];
    // Creator flags, default false=open. When true, members cannot add that kind of candidate.
    lockTimes?: boolean;
    lockThings?: boolean;
    // Creator anonymity is ALWAYS on; left here only so a fixture can assert it.
    isAnonymous?: boolean;
    // When a collecting plan auto-decides the winning slot and opens the moment. Must sit before the
    // earliest TIME candidate. Null/absent for the concrete shortcut (straight to moment).
    decidesBy?: Date;
    chosenSuffix?: string;
    momentStartsAt?: Date;
    momentEndsAt?: Date;
    responses?: Resp[];
  }
  ```

- [ ] **Step 5: Update the `PLANS` header comment.** Replace lines 97-99:
  ```ts
  // Demo plans cover the (whenMode x phase) states the dashboard renders, including a "floating"
  // plan (an unsigned, ownerless idea brewing in a group) so the Brewing zone and the tip are
  // demoable on every reset boot.
  ```
  with:
  ```ts
  // Demo plans cover the phases the dashboard renders. Every plan is anonymous (names never shown);
  // collecting plans carry PUBLIC +1 counts on both time and activity candidates.
  ```

- [ ] **Step 6: Typecheck (expect FAIL on the PLANS fixtures).** Run:
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expected: FAIL - errors on every entry in `PLANS` (lines ~100-221) because they still set `whenMode`, omit `kind`, and `e_float_climb` uses `minHeat`/`floatSuggestions`/`phase: "floating"`. Tasks 6.3 and 6.4 fix these. (Do not commit yet.)

### Task 6.3: Add `kind` to existing time candidates and rename lockAt -> decidesBy in PLANS

The five non-float plans (`e_movie`, `e_pub`, `e_bowling`, `e_dinner`, `e_football`, lines 101-198) are all time-only. Each candidate needs `kind: "time"`, each plan must drop `whenMode`, and `lockAt:` becomes `decidesBy:`.

**Files:**
- Modify: `apps/api/src/db/seed-data.ts` (`e_movie` L101-117, `e_pub` L118-134, `e_bowling` L135-156, `e_dinner` L157-179, `e_football` L180-198)

- [ ] **Step 1: Drop every `whenMode` line in PLANS.** Remove the lines `whenMode: "options",` and `whenMode: "exact",` from `e_movie` (L107), `e_pub` (L124), `e_bowling` (L141), `e_dinner` (L163), `e_football` (L186). (The `e_float_climb` `whenMode: "fuzzy"` line is handled in Task 6.4.)

- [ ] **Step 2: Rename `lockAt:` -> `decidesBy:` in collecting plans.** In `e_movie` change `lockAt: dayAt(1, 18),` -> `decidesBy: dayAt(1, 18),` (L111); in `e_pub` change `lockAt: dayAt(1, 12),` -> `decidesBy: dayAt(1, 12),` (L128).

- [ ] **Step 3: Add `kind: "time"` to every candidate.** Each `Cand` literal currently looks like `{ suffix: "c1", startsAt: dayAt(2, 18), reactedBy: [...] }`. Add `kind: "time",` after `suffix`. Affected literals: `e_movie` c1-c3 (L113-115), `e_pub` c1-c3 (L130-132), `e_bowling` c1 (L145), `e_dinner` c1-c2 (L168-169), `e_football` c1 (L190). Example - `e_movie` candidates become:
  ```ts
      candidates: [
        { suffix: "c1", kind: "time", startsAt: dayAt(2, 18), reactedBy: ["u_dev", "u_adi", "u_lily", "u_joe"] },
        { suffix: "c2", kind: "time", startsAt: dayAt(2, 20), reactedBy: ["u_dev", "u_nathan", "u_bethan"] },
        { suffix: "c3", kind: "time", startsAt: dayAt(3, 14), reactedBy: ["u_lily"] },
      ],
  ```
  Apply the same `kind: "time",` insertion to the `e_pub`, `e_bowling`, `e_dinner`, `e_football` candidate literals. (`e_bowling`, `e_dinner`, `e_football` are concrete/past plans and keep their `chosenSuffix`/moment fields unchanged.)

- [ ] **Step 4: Typecheck (still FAIL, but only on `e_float_climb`).** Run:
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expected: FAIL only on `e_float_climb` (L199-221: `whenMode: "fuzzy"`, `minHeat`, `phase: "floating"`, `floatSuggestions`). The five rewritten plans now satisfy the new `Plan` type. Fixed next.

### Task 6.4: Rewrite e_float_climb as an ordinary collecting plan with both candidate kinds

`e_float_climb` (lines 199-221) is the demo float: anonymous, quorum 2, two `idea` chips (`bowling` 2 backers, `the pub` 1) and two `time` bands (`evening` day 2: 2 backers, `afternoon` day 3: 1). The contract collapses this into one collecting plan with BOTH a TIME candidate list and an ACTIVITY candidate list, public reactions, `title: ""` (winning activity becomes the title at lock). It keeps `createdBy: "u_adi"`, `groupId: "g_climb"`, `quorum: 2`, `isAnonymous: true`. The float `day`/`partOfDay` time bands become concrete `dayAt(day, PART_HOUR[band])` time candidates - matching how `seed.ts` previously expanded them (old L79-81).

**Files:**
- Modify: `apps/api/src/db/seed-data.ts` (`e_float_climb` L199-221)
- Reference (no change): `packages/shared/src/logic/window.ts` (`PART_HOUR` - `evening` and `afternoon` hours)

- [ ] **Step 1: Confirm PART_HOUR values for legible hardcoding.** Run:
  ```bash
  grep -n "PART_HOUR" /Users/gong/Programming/drp_02/packages/shared/src/logic/window.ts
  ```
  Expected: a map literal giving the hour for each `PartOfDay` (e.g. `afternoon`, `evening`). Note the `evening` and `afternoon` hours - use them as the `hour` arg to `dayAt` below so the seed needs no `PART_HOUR` import. (If `evening`=19 and `afternoon`=14, use those; substitute the real values.)

- [ ] **Step 2: Replace the whole `e_float_climb` object.** Replace lines 199-221:
  ```ts
    {
      // A float brewing in the climbing group. Unsigned + ownerless: "bowling" leads (2 backers, clears
      // minHeat), and among its backers "Wed evening" is the agreed time (2 backers), so advancing
      // lockAt tips it straight into a blind moment. No title/location until it crystallizes.
      id: "e_float_climb",
      groupId: "g_climb",
      createdBy: "u_adi",
      title: "",
      whenMode: "fuzzy",
      contingent: true,
      quorum: 2,
      isAnonymous: true,
      minHeat: 2,
      phase: "floating",
      lockAt: dayAt(1, 12),
      candidates: [],
      floatSuggestions: [
        { suffix: "i1", axis: "idea", text: "bowling", votedBy: ["u_adi", "u_joe"] },
        { suffix: "i2", axis: "idea", text: "the pub", votedBy: ["u_dev"] },
        { suffix: "t1", axis: "time", partOfDay: "evening", day: 2, votedBy: ["u_adi", "u_joe"] },
        { suffix: "t2", axis: "time", partOfDay: "afternoon", day: 3, votedBy: ["u_dev"] },
      ],
    },
  ```
  with (anonymous collecting plan, empty title, both candidate kinds with public `reactedBy`; `partOfDay` carried on the TIME candidates; `decidesBy` before the earliest time candidate at `dayAt(2, ...)`). Substitute the real `evening`/`afternoon` hours from Step 1 for the `19`/`14` shown:
  ```ts
    {
      // A still-collecting plan in the climbing group, left untitled so its winning ACTIVITY resolves
      // into the title at lock. Anonymous (no names), with PUBLIC +1 counts on both lists: among
      // activities "bowling" leads (2 backers), and among times the day-2 evening slot leads (2).
      id: "e_float_climb",
      groupId: "g_climb",
      createdBy: "u_adi",
      title: "",
      contingent: true,
      quorum: 2,
      isAnonymous: true,
      phase: "collecting",
      decidesBy: dayAt(1, 12),
      candidates: [
        { suffix: "a1", kind: "activity", label: "bowling", reactedBy: ["u_adi", "u_joe"] },
        { suffix: "a2", kind: "activity", label: "the pub", reactedBy: ["u_dev"] },
        { suffix: "t1", kind: "time", startsAt: dayAt(2, 19), partOfDay: "evening", reactedBy: ["u_adi", "u_joe"] },
        { suffix: "t2", kind: "time", startsAt: dayAt(3, 14), partOfDay: "afternoon", reactedBy: ["u_dev"] },
      ],
    },
  ```

- [ ] **Step 3: Typecheck (expect PASS for seed-data.ts).** Run:
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expected: no errors originating in `seed-data.ts`. (Errors may still surface in `seed.ts` because it references `floatSuggestions`/`whenMode`/`minHeat`/`lockAt`/`floatVotes`; fixed in Task 6.7.)

- [ ] **Step 4: Commit the seed-data model + fixtures.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add apps/api/src/db/seed-data.ts && \
  git -C /Users/gong/Programming/drp_02 commit -m "feat(seed): unify Plan fixtures - kind-tagged candidates, drop whenMode/minHeat/floats, lockAt->decidesBy (DRP-33)"
  ```

### Task 6.5: Rewrite seedIntegrityErrors - invert the floating rule into a collecting/kind check

`seedIntegrityErrors` (lines 230-315) has a `phase === "floating"` branch (L257-273) asserting floats have NO candidates and at least one `idea` suggestion, plus an `else` branch (L274-281) with an `exact`-only candidate-count rule referencing `whenMode`. The contract inverts this: there is no floating phase; every collecting plan must HAVE candidates, and we now also validate that each `Cand.kind === "time"` has a `startsAt` and each `kind === "activity"` has a `label`. The `lockAt`-after-earliest check (L303-307) must read `decidesBy` and only consider TIME candidates. We keep this a pure function with no DB.

**Files:**
- Modify: `apps/api/src/db/seed-data.ts` (`seedIntegrityErrors` L230-315: phase branch L257-281; suffix/reaction loop L283-292; decidesBy check L303-307)

- [ ] **Step 1: Replace the floating/else branch with a kind-aware collecting check.** Replace lines 257-281:
  ```ts
      if (p.phase === "floating") {
        if (!p.isAnonymous) errors.push(`plan ${p.id}: floating plan must be anonymous`);
        if (p.candidates.length > 0)
          errors.push(`plan ${p.id}: floating plan must have no candidates`);
        const sugg = p.floatSuggestions ?? [];
        if (!sugg.some((s) => s.axis === "idea"))
          errors.push(`plan ${p.id}: floating plan needs at least one idea suggestion`);
        const sufx = new Set<string>();
        for (const s of sugg) {
          if (sufx.has(s.suffix))
            errors.push(`plan ${p.id}: duplicate float suggestion suffix ${s.suffix}`);
          sufx.add(s.suffix);
          for (const u of s.votedBy ?? []) {
            if (!members.has(u))
              errors.push(`plan ${p.id}: float vote by ${u} who is not in group ${p.groupId}`);
          }
        }
      } else {
        if (p.candidates.length === 0) errors.push(`plan ${p.id}: has no candidates`);
        if (p.whenMode === "exact" && p.candidates.length !== 1) {
          errors.push(
            `plan ${p.id}: exact plan must have exactly 1 candidate, has ${p.candidates.length}`,
          );
        }
      }
  ```
  with (no floating phase; every plan needs >=1 candidate; collecting plans need >=1 TIME candidate so there is something to decide; `kind`-shape checks):
  ```ts
      if (p.candidates.length === 0) errors.push(`plan ${p.id}: has no candidates`);
      const timeCands = p.candidates.filter((c) => c.kind === "time");
      if (p.phase === "collecting" && timeCands.length === 0)
        errors.push(`plan ${p.id}: collecting plan needs at least one time candidate`);
      for (const c of p.candidates) {
        if (c.kind === "time" && !c.startsAt)
          errors.push(`plan ${p.id}: time candidate ${c.suffix} has no startsAt`);
        if (c.kind === "activity" && !c.label)
          errors.push(`plan ${p.id}: activity candidate ${c.suffix} has no label`);
      }
  ```

- [ ] **Step 2: Update the `decidesBy`-after-earliest check to use TIME candidates only.** Replace lines 303-307:
  ```ts
      if (p.lockAt && p.candidates.length > 0) {
        const earliest = Math.min(...p.candidates.map((c) => c.startsAt.getTime()));
        if (p.lockAt.getTime() > earliest)
          errors.push(`plan ${p.id}: lockAt is after the earliest candidate`);
      }
  ```
  with (rename `lockAt` -> `decidesBy`; only TIME candidates have a `startsAt` to anchor to):
  ```ts
      const startTimes = p.candidates
        .filter((c) => c.kind === "time" && c.startsAt)
        .map((c) => (c.startsAt as Date).getTime());
      if (p.decidesBy && startTimes.length > 0) {
        const earliest = Math.min(...startTimes);
        if (p.decidesBy.getTime() > earliest)
          errors.push(`plan ${p.id}: decidesBy is after the earliest time candidate`);
      }
  ```

- [ ] **Step 3: Typecheck.** Run:
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expected: no errors in `seed-data.ts` (only possible remaining errors are in `seed.ts`, fixed in Task 6.7). The candidate-loop at L283-292 still compiles since `Cand.suffix`/`reactedBy` are unchanged.

### Task 6.6: Fix seed-data.test.ts fixtures (drop whenMode, add kind, invert the floating case)

`apps/api/src/db/seed-data.test.ts` has three tests. Test 1 (L5-7) asserts the committed seed is sound - it just needs the rewritten data to pass. Tests 2 and 3 (L9-54) build inline `Plan[]` fixtures that still set `whenMode` (L18, L41) and omit `kind`, so they no longer typecheck. We fix those and add a new test exercising the inverted collecting rule (collecting plan with zero time candidates is flagged).

**Files:**
- Modify: `apps/api/src/db/seed-data.test.ts` (test 2 fixture L12-24, test 3 fixture L35-48)

- [ ] **Step 1: Fix the "reaction by non-member" fixture.** Replace the `plans` literal in test 2 (lines 12-24):
  ```ts
    const plans: Plan[] = [
      {
        id: "p1",
        groupId: "g1",
        createdBy: "u_a",
        title: "T",
        whenMode: "options",
        contingent: true,
        quorum: 2,
        phase: "collecting",
        candidates: [{ suffix: "c1", startsAt: new Date(), reactedBy: ["u_b"] }],
      },
    ];
  ```
  with (drop `whenMode`; add `kind: "time"`):
  ```ts
    const plans: Plan[] = [
      {
        id: "p1",
        groupId: "g1",
        createdBy: "u_a",
        title: "T",
        contingent: true,
        quorum: 2,
        phase: "collecting",
        candidates: [{ suffix: "c1", kind: "time", startsAt: new Date(), reactedBy: ["u_b"] }],
      },
    ];
  ```

- [ ] **Step 2: Fix the "chosenSuffix matches no candidate" fixture.** Replace the `plans` literal in test 3 (lines 35-48):
  ```ts
    const plans: Plan[] = [
      {
        id: "p1",
        groupId: "g1",
        createdBy: "u_a",
        title: "T",
        whenMode: "exact",
        contingent: false,
        quorum: 1,
        phase: "cleared",
        candidates: [{ suffix: "c1", startsAt: new Date() }],
        chosenSuffix: "c9",
      },
    ];
  ```
  with (drop `whenMode`; add `kind: "time"`):
  ```ts
    const plans: Plan[] = [
      {
        id: "p1",
        groupId: "g1",
        createdBy: "u_a",
        title: "T",
        contingent: false,
        quorum: 1,
        phase: "cleared",
        candidates: [{ suffix: "c1", kind: "time", startsAt: new Date() }],
        chosenSuffix: "c9",
      },
    ];
  ```

- [ ] **Step 3: Add a test for the inverted collecting rule.** Append after the last test (after line 54):
  ```ts

  test("flags a collecting plan with no time candidate", () => {
    const users = [{ id: "u_a" }];
    const groups = [{ id: "g1", members: ["u_a"] }];
    const plans: Plan[] = [
      {
        id: "p1",
        groupId: "g1",
        createdBy: "u_a",
        title: "",
        contingent: true,
        quorum: 1,
        phase: "collecting",
        candidates: [{ suffix: "a1", kind: "activity", label: "bowling", reactedBy: ["u_a"] }],
      },
    ];
    const errs = seedIntegrityErrors(users, groups, plans);
    assert.ok(
      errs.some((e) => e.includes("at least one time candidate")),
      `expected a time-candidate error, got ${JSON.stringify(errs)}`,
    );
  });
  ```

- [ ] **Step 4: Run the seed-data test (expect PASS).** This is a `node:test` file. Run:
  ```bash
  cd /Users/gong/Programming/drp_02/apps/api && pnpm exec tsx --test src/db/seed-data.test.ts
  ```
  Expected: all 4 tests pass - `# pass 4`, `# fail 0`. In particular test 1 (`the committed demo seed is referentially sound`) passes, proving the rewritten `PLANS` (including `e_float_climb`) is internally coherent. If the seed test runs via a different script, fall back to `pnpm --filter @bethere/api test` and confirm these 4 tests are green.

- [ ] **Step 5: Commit the integrity rewrite + tests.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add apps/api/src/db/seed-data.ts apps/api/src/db/seed-data.test.ts && \
  git -C /Users/gong/Programming/drp_02 commit -m "test(seed): invert floating integrity rule into kind-aware collecting checks (DRP-33)"
  ```

### Task 6.7: Rewrite seed.ts inserts/deletes (write kind + activity candidates + public reactions, drop float tables)

`apps/api/src/db/seed.ts` imports `floatSuggestions`/`floatVotes` (L8-9), references `PART_HOUR` (L1), writes `whenMode`/`minHeat`/`lockAt` on the event (L52, L55, L57), inserts each candidate without a `kind` (L65-71), expands `floatSuggestions` into the float tables (L77-95), and deletes the float tables in `reseedDemo` (L111-112). We make it write the unified candidate shape (`kind`, nullable `startsAt`, `label`) plus `lockTimes`/`lockThings`/`decidesBy`/`isAnonymous: true`, drop all float-table I/O, and rename `lockAt` -> `decidesBy` in the events insert. (DB column renames/drops are an earlier phase; here we align the seed writer.)

**Files:**
- Modify: `apps/api/src/db/seed.ts` (imports L1-15; event insert L41-61; candidate insert L63-75; float expansion L77-95; deletes L110-122)

- [ ] **Step 1: Drop the PART_HOUR + float-table imports.** The float-band expansion is gone (candidates now carry concrete `startsAt`), so `PART_HOUR` is unused. Replace lines 1-15:
  ```ts
  import { PART_HOUR } from "@bethere/shared";
  import { db } from "./client.js";
  import {
    candidateReactions,
    eventCandidates,
    eventOptOuts,
    events,
    floatSuggestions,
    floatVotes,
    groupMembers,
    groups,
    responses,
    users,
  } from "./schema.js";
  import { candId, DEMO_USERS, dayAt, GROUPS, PLANS } from "./seed-data.js";
  ```
  with (remove `PART_HOUR`, `floatSuggestions`, `floatVotes`):
  ```ts
  import { db } from "./client.js";
  import {
    candidateReactions,
    eventCandidates,
    eventOptOuts,
    events,
    groupMembers,
    groups,
    responses,
    users,
  } from "./schema.js";
  import { candId, DEMO_USERS, dayAt, GROUPS, PLANS } from "./seed-data.js";
  ```

- [ ] **Step 2: Anchor the event `startsAt`/`respondByAt` on TIME candidates only.** Activity candidates have no `startsAt`, so the existing `sorted` sort over all candidates (L31) would `NaN`-compare. Replace lines 31-39:
  ```ts
      const sorted = [...p.candidates].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      const chosen = p.chosenSuffix
        ? p.candidates.find((c) => c.suffix === p.chosenSuffix)
        : undefined;
      // Floats carry no candidates; their startsAt is a window-default placeholder and respondByAt
      // falls back to the tip deadline.
      const startsAt = chosen?.startsAt ?? sorted[0]?.startsAt ?? p.lockAt ?? dayAt(2, 19);
      const respondByAt =
        p.momentEndsAt ?? sorted[sorted.length - 1]?.startsAt ?? p.lockAt ?? startsAt;
  ```
  with (sort only TIME candidates; fall back to `decidesBy`):
  ```ts
      const timeCands = p.candidates.filter((c) => c.kind === "time" && c.startsAt);
      const sorted = [...timeCands].sort(
        (a, b) => (a.startsAt as Date).getTime() - (b.startsAt as Date).getTime(),
      );
      const chosen = p.chosenSuffix
        ? p.candidates.find((c) => c.suffix === p.chosenSuffix)
        : undefined;
      // A still-collecting untitled plan has no chosen slot yet; anchor on its earliest time candidate
      // and fall back to decidesBy for the respond-by horizon.
      const startsAt = chosen?.startsAt ?? sorted[0]?.startsAt ?? p.decidesBy ?? dayAt(2, 19);
      const respondByAt =
        p.momentEndsAt ?? sorted[sorted.length - 1]?.startsAt ?? p.decidesBy ?? startsAt;
  ```

- [ ] **Step 3: Update the events insert (drop whenMode/minHeat, lockAt->decidesBy, lockTimes/lockThings, isAnonymous always true).** Replace the insert block lines 41-61:
  ```ts
      await db.insert(events).values({
        id: p.id,
        groupId: p.groupId,
        createdByUserId: p.createdBy,
        title: p.title,
        description: null,
        location: p.location ?? "",
        startsAt,
        respondByAt,
        status: p.phase === "cleared" || p.phase === "fizzled" ? "resolved" : "open",
        whenMode: p.whenMode,
        contingent: p.contingent,
        quorum: p.quorum,
        isAnonymous: p.isAnonymous ?? false,
        minHeat: p.minHeat ?? 2,
        phase: p.phase,
        lockAt: p.lockAt ?? null,
        chosenCandidateId: chosen ? candId(p.id, chosen.suffix) : null,
        momentStartsAt: p.momentStartsAt ?? null,
        momentEndsAt: p.momentEndsAt ?? null,
      });
  ```
  with:
  ```ts
      await db.insert(events).values({
        id: p.id,
        groupId: p.groupId,
        createdByUserId: p.createdBy,
        title: p.title,
        description: null,
        location: p.location ?? "",
        startsAt,
        respondByAt,
        status: p.phase === "cleared" || p.phase === "fizzled" ? "resolved" : "open",
        contingent: p.contingent,
        quorum: p.quorum,
        // Creator anonymity is ALWAYS on in the unified model.
        isAnonymous: true,
        lockTimes: p.lockTimes ?? false,
        lockThings: p.lockThings ?? false,
        phase: p.phase,
        decidesBy: p.decidesBy ?? null,
        chosenCandidateId: chosen ? candId(p.id, chosen.suffix) : null,
        momentStartsAt: p.momentStartsAt ?? null,
        momentEndsAt: p.momentEndsAt ?? null,
      });
  ```

- [ ] **Step 4: Write `kind` + nullable startsAt + label on each candidate.** Replace the candidate insert loop lines 63-75:
  ```ts
      for (const c of p.candidates) {
        const candidateId = candId(p.id, c.suffix);
        await db.insert(eventCandidates).values({
          id: candidateId,
          eventId: p.id,
          startsAt: c.startsAt,
          partOfDay: c.partOfDay ?? null,
          label: c.label ?? null,
        });
        for (const userId of c.reactedBy ?? []) {
          await db.insert(candidateReactions).values({ eventId: p.id, candidateId, userId });
        }
      }
  ```
  with (carry `kind`; `startsAt` null for activity candidates; reactions stay - they are now public):
  ```ts
      for (const c of p.candidates) {
        const candidateId = candId(p.id, c.suffix);
        await db.insert(eventCandidates).values({
          id: candidateId,
          eventId: p.id,
          kind: c.kind,
          startsAt: c.startsAt ?? null,
          partOfDay: c.partOfDay ?? null,
          label: c.label ?? null,
        });
        for (const userId of c.reactedBy ?? []) {
          await db.insert(candidateReactions).values({ eventId: p.id, candidateId, userId });
        }
      }
  ```

- [ ] **Step 5: Delete the float-suggestion expansion block.** Remove lines 77-95 entirely:
  ```ts
      for (const s of p.floatSuggestions ?? []) {
        const suggestionId = candId(p.id, s.suffix);
        const startsAt =
          s.axis === "time" && s.day != null
            ? dayAt(s.day, PART_HOUR[s.partOfDay ?? "evening"])
            : null;
        await db.insert(floatSuggestions).values({
          id: suggestionId,
          eventId: p.id,
          axis: s.axis,
          text: s.text ?? null,
          partOfDay: s.axis === "time" ? (s.partOfDay ?? null) : null,
          startsAt,
          createdByUserId: p.createdBy,
        });
        for (const userId of s.votedBy ?? []) {
          await db.insert(floatVotes).values({ eventId: p.id, suggestionId, userId });
        }
      }
  ```
  (delete - float candidates now live in the unified `candidates` loop from Step 4.)

- [ ] **Step 6: Drop the float-table deletes in reseedDemo.** Replace lines 110-122:
  ```ts
  export async function reseedDemo(): Promise<void> {
    await db.delete(floatVotes);
    await db.delete(floatSuggestions);
    await db.delete(responses);
    await db.delete(candidateReactions);
    await db.delete(eventOptOuts);
    await db.delete(eventCandidates);
    await db.delete(events);
    await db.delete(groupMembers);
    await db.delete(groups);
    await db.delete(users);
    await insertDemoData();
  }
  ```
  with (the float tables no longer exist after the DB phase):
  ```ts
  export async function reseedDemo(): Promise<void> {
    await db.delete(responses);
    await db.delete(candidateReactions);
    await db.delete(eventOptOuts);
    await db.delete(eventCandidates);
    await db.delete(events);
    await db.delete(groupMembers);
    await db.delete(groups);
    await db.delete(users);
    await insertDemoData();
  }
  ```

- [ ] **Step 7: Typecheck the API package (expect PASS).** Run:
  ```bash
  pnpm --filter @bethere/api typecheck
  ```
  Expected: no errors in `seed.ts` or `seed-data.ts`. `dayAt` is still used (event-startsAt fallback), `candId` still used. If `dayAt` shows as unused, confirm Step 2 kept the `dayAt(2, 19)` fallback. (Errors elsewhere - e.g. an `events.ts` not yet reshaped - belong to other phases.)

- [ ] **Step 8: Commit the seed writer rewrite.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add apps/api/src/db/seed.ts && \
  git -C /Users/gong/Programming/drp_02 commit -m "feat(seed): write kind-tagged candidates + public reactions, drop float-table I/O, lockAt->decidesBy (DRP-33)"
  ```

### Task 6.8: Fix lock.test.ts (rename to defaultDecidesByForCandidates, drop fuzzy + isFuzzy cases)

`packages/shared/src/logic/lock.test.ts` imports `defaultLockAtForOptions` and `defaultLockAtForWindow` (L4-6), tests `defaultLockAtForOptions` (L14-40), tests the now-deleted `defaultLockAtForWindow` (L42-66), and tests `addCandidateHorizon` with the `isFuzzy` boolean (L68-85, including a fuzzy-only case at L69-73). The contract: `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`, `defaultLockAtForWindow` dropped (or folded), and `addCandidateHorizon` loses its `isFuzzy` arg (compute slack from time-candidate spread only). This test must follow the renamed/narrowed signatures. (The implementation rename lives in the shared-logic phase; this aligns the test - it should be RED before that phase lands and GREEN after.)

**Files:**
- Modify: `packages/shared/src/logic/lock.test.ts` (imports L2-8; `defaultLockAtForOptions` describe L14-40; `defaultLockAtForWindow` describe L42-66; `addCandidateHorizon` describe L68-85)

- [ ] **Step 1: Fix the imports.** Replace lines 2-8:
  ```ts
  import {
    addCandidateHorizon,
    DAY_MS,
    defaultLockAtForOptions,
    defaultLockAtForWindow,
    MAX_REACT_MS,
  } from "./lock.js";
  ```
  with (rename `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`; drop `defaultLockAtForWindow`; `MAX_REACT_MS` is now only used by the dropped window logic, so drop it too):
  ```ts
  import { addCandidateHorizon, DAY_MS, defaultDecidesByForCandidates } from "./lock.js";
  ```

- [ ] **Step 2: Rename the `defaultLockAtForOptions` describe block.** Replace lines 14-40:
  ```ts
  describe("defaultLockAtForOptions", () => {
    it("caps the notice lead at one day for far-out options", () => {
      for (const days of [3, 5, 14]) {
        const earliest = now + days * DAY_MS;
        expect(defaultLockAtForOptions(earliest, now)).toBe(earliest - DAY_MS);
      }
    });

    it("gives the react phase the larger share for mid-range options (lead = T/3)", () => {
      const earliest = now + 24 * HOUR;
      expect(defaultLockAtForOptions(earliest, now)).toBe(earliest - 8 * HOUR);
    });

    it("always returns a value strictly after now and before the earliest slot", () => {
      for (const gapHours of [0.5, 1, 3, 6, 12, 23, 25, 48, 24 * 14]) {
        const earliest = now + gapHours * HOUR;
        const t = defaultLockAtForOptions(earliest, now);
        expect(t).toBeGreaterThan(now);
        expect(t).toBeLessThan(earliest);
      }
    });

    it("falls back to a clamped midpoint when the slot is too close for the lead", () => {
      const earliest = now + 30 * 60 * 1000; // 30 min out
      expect(defaultLockAtForOptions(earliest, now)).toBe(now + 15 * 60 * 1000);
    });
  });
  ```
  with (only the function name changes - the math is identical, the renamed fn keeps the options/exact-N behaviour):
  ```ts
  describe("defaultDecidesByForCandidates", () => {
    it("caps the notice lead at one day for far-out times", () => {
      for (const days of [3, 5, 14]) {
        const earliest = now + days * DAY_MS;
        expect(defaultDecidesByForCandidates(earliest, now)).toBe(earliest - DAY_MS);
      }
    });

    it("gives the react phase the larger share for mid-range times (lead = T/3)", () => {
      const earliest = now + 24 * HOUR;
      expect(defaultDecidesByForCandidates(earliest, now)).toBe(earliest - 8 * HOUR);
    });

    it("always returns a value strictly after now and before the earliest slot", () => {
      for (const gapHours of [0.5, 1, 3, 6, 12, 23, 25, 48, 24 * 14]) {
        const earliest = now + gapHours * HOUR;
        const t = defaultDecidesByForCandidates(earliest, now);
        expect(t).toBeGreaterThan(now);
        expect(t).toBeLessThan(earliest);
      }
    });

    it("falls back to a clamped midpoint when the slot is too close for the lead", () => {
      const earliest = now + 30 * 60 * 1000; // 30 min out
      expect(defaultDecidesByForCandidates(earliest, now)).toBe(now + 15 * 60 * 1000);
    });
  });
  ```

- [ ] **Step 3: Delete the `defaultLockAtForWindow` describe block.** Remove lines 42-66 entirely (the whole `describe("defaultLockAtForWindow", ...)` block) - the fuzzy/window path no longer exists server-side.

- [ ] **Step 4: Rewrite the `addCandidateHorizon` describe block (drop the isFuzzy arg + the fuzzy case).** Replace lines 68-85:
  ```ts
  describe("addCandidateHorizon", () => {
    it("for fuzzy plans is exactly the last window slot", () => {
      const earliest = now + DAY_MS;
      const latest = now + 7 * DAY_MS;
      expect(addCandidateHorizon(earliest, latest, true)).toBe(latest);
    });

    it("for options plans allows a small slack past the spread, capped at two days", () => {
      const earliest = now + DAY_MS;
      const latest = now + 3 * DAY_MS; // span 2 days
      expect(addCandidateHorizon(earliest, latest, false)).toBe(latest + 2 * DAY_MS);
      const tight = now + DAY_MS + HOUR; // span 1h -> slack 1h
      expect(addCandidateHorizon(now + DAY_MS, tight, false)).toBe(tight + HOUR);
      // span=5d -> slack capped at 2d, not 5d
      const wide = now + 6 * DAY;
      expect(addCandidateHorizon(now + DAY, wide, false)).toBe(wide + 2 * DAY);
    });
  });
  ```
  with (two-arg signature; slack from the time-candidate spread only, capped at two days):
  ```ts
  describe("addCandidateHorizon", () => {
    it("allows a small slack past the time-candidate spread, capped at two days", () => {
      const earliest = now + DAY_MS;
      const latest = now + 3 * DAY_MS; // span 2 days
      expect(addCandidateHorizon(earliest, latest)).toBe(latest + 2 * DAY_MS);
      const tight = now + DAY_MS + HOUR; // span 1h -> slack 1h
      expect(addCandidateHorizon(now + DAY_MS, tight)).toBe(tight + HOUR);
      // span=5d -> slack capped at 2d, not 5d
      const wide = now + 6 * DAY;
      expect(addCandidateHorizon(now + DAY, wide)).toBe(wide + 2 * DAY);
    });
  });
  ```

- [ ] **Step 5: Run the shared lock test (RED if lock.ts not yet renamed, GREEN after).** Run:
  ```bash
  pnpm --filter @bethere/shared test -- lock.test.ts
  ```
  Expected if the shared-logic phase already renamed `lock.ts`: all `defaultDecidesByForCandidates` and `addCandidateHorizon` specs pass. Expected if `lock.ts` is NOT yet renamed: FAIL with `No "defaultDecidesByForCandidates" export is defined` - that is correct TDD-red; the shared-logic phase turns it green. Either way the test file is now contract-aligned. If you own the `lock.ts` rename in this run, apply it (rename `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`, delete `defaultLockAtForWindow`, drop the `isFuzzy` param + branch in `addCandidateHorizon`) and re-run to confirm GREEN.

- [ ] **Step 6: Run the whole shared suite to confirm no stragglers.** Run:
  ```bash
  pnpm --filter @bethere/shared test
  ```
  Expected: green (no reference to deleted `reconcile`/`defaultLockAtForWindow`/`MAX_REACT_MS` import). If `MAX_REACT_MS`/`DAY_MS` is now flagged unused by lint, leave for the Task 6.9 lint pass.

- [ ] **Step 7: Commit the lock test rewrite.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add packages/shared/src/logic/lock.test.ts && \
  git -C /Users/gong/Programming/drp_02 commit -m "test(shared): rename to defaultDecidesByForCandidates, drop fuzzy/window + isFuzzy cases (DRP-33)"
  ```

### Task 6.9: Final lint + full per-package verification for Phase 6

**Files:** (no edits unless lint flags something - e.g. an unused `HOUR`/`DAY`/`DAY_MS` const in `lock.test.ts`)

- [ ] **Step 1: Lint the touched files.** Run:
  ```bash
  pnpm lint
  ```
  Expected: clean. If biome flags an unused import/const introduced by the deletions (e.g. `MAX_REACT_MS` already removed, but a now-unused `DAY` or `HOUR` in `lock.test.ts`), run `pnpm format` and, for genuinely unused locals, delete them, then re-lint.

- [ ] **Step 2: Run both affected package test suites back-to-back.** Run:
  ```bash
  pnpm --filter @bethere/shared test && pnpm --filter @bethere/api test
  ```
  Expected: shared green; API green (the 4 `seed-data.test.ts` tests pass; no test references float tables). Do NOT run the aggregate `pnpm test` (mobile jest hangs it). No mobile jest was run here, so no `pkill -f jest` is needed; if you did trigger one, run `pkill -f jest`.

- [ ] **Step 3: Typecheck the whole workspace.** Run:
  ```bash
  pnpm typecheck
  ```
  Expected: PASS across `@bethere/shared`, `@bethere/api`, `@bethere/mobile` for the seed/lock surface (any remaining errors should be from other in-flight phases, not Phase 6 files).

- [ ] **Step 4: Smoke-test a local reseed (optional, requires Postgres + completed DB phase).** Only if the DB phase's migration has landed and local Postgres is up. Run:
  ```bash
  pnpm db:up && pnpm --filter @bethere/api db:migrate
  ```
  then boot the API once with the reset seed (`SEED_ON_BOOT=reset pnpm dev:api`, Ctrl-C after "seeded"). Expected: no insert error; `e_float_climb` lands as a `collecting` event with 2 activity + 2 time candidates and public reactions, and no `float_suggestions`/`float_votes` writes occur. Skip if the DB phase is not yet merged.

---

Relevant absolute file paths for this phase:
- `/Users/gong/Programming/drp_02/apps/api/src/db/seed-data.ts`
- `/Users/gong/Programming/drp_02/apps/api/src/db/seed-data.test.ts`
- `/Users/gong/Programming/drp_02/apps/api/src/db/seed.ts`
- `/Users/gong/Programming/drp_02/packages/shared/src/logic/lock.test.ts`
- `/Users/gong/Programming/drp_02/packages/shared/src/logic/reconcile.test.ts` (deleted)
- `/Users/gong/Programming/drp_02/packages/shared/src/logic/reconcile.ts` (deleted; verify)
- `/Users/gong/Programming/drp_02/packages/shared/src/logic/window.ts` (read-only reference for `PART_HOUR`)

---

## Phase 7: Docs rewrite

Rewrite the three living docs so the **three-mode `whenMode` fork** (exact/options/fuzzy) is replaced everywhere by the **one-flow / two-locks** model (one create flow, one votable plan with TIME and ACTIVITY candidate lists, public +1 counts, names never shown, two creator flags `lockTimes`/`lockThings` defaulting to open, "Decides by"). CLAUDE.md is the highest-leverage file because it overrides agent behaviour - a single stale `whenMode`/`fuzzy` sentence there re-introduces the deleted model in future agent sessions. Then stub a dated session summary to fill in when the refactor ships.

These three files are **living docs** and the ONLY docs this phase touches. Do NOT edit anything under `docs/summary/` (except the new stub created here), `docs/superpowers/`, or `docs/drp-context/` - those are immutable history.

Note: this phase has no automated tests (prose only). The verification gate is a `grep` that must return zero matches for the dead vocabulary, run as the final step. Do these tasks LAST in the overall refactor (after the code/type changes land) so the docs describe the shipped reality, but the edits themselves only touch markdown and can be committed independently.

### Task 7.1: Rewrite CLAUDE.md project model (highest leverage)

**Files:**
- Modify: `/Users/gong/Programming/drp_02/CLAUDE.md` (lines 7-13: the `## Project` model paragraph + the three `whenMode` bullets + the "Everything after the `when`" paragraph)

- [ ] **Step 1: Replace the model intro line + the three `whenMode` bullets.** In `/Users/gong/Programming/drp_02/CLAUDE.md`, replace the exact block (lines 7-11):
  ```
  `drp_02` is **BeThere**, a group meetup-coordination app (Expo mobile + Fastify/tRPC backend). The current model is the **convergence model** (M3, merged to `dev` via DRP-29): a creator floats one plan to a group and the only fork they choose is how precisely to pin the time (`whenMode`):

  - **exact** - a fixed time; skips collecting, opens straight into a blind timed **moment**, always happens.
  - **options** - a short menu of fixed times; members react ("works for me"), best-supported wins.
  - **fuzzy** - a loose window (timescale + part-of-day band) expanded into day candidates members react to.
  ```
  with:
  ```
  `drp_02` is **BeThere**, a group meetup-coordination app (Expo mobile + Fastify/tRPC backend). The current model is the **unified suggest flow** (M3, replacing the older three-mode `whenMode` fork): a creator sends ONE plan to a group through ONE create flow. A plan owns two candidate lists - **TIME** (when) and **ACTIVITY** (what/where) - and members add to and publicly +1 either list during `collecting`. The creator never picks a "mode"; they only set two flags, both default `false` (open):

  - **lockTimes** - when `true`, the time list is fixed: members vote but cannot add times.
  - **lockThings** - when `true`, the activity (what/where) list is fixed: members vote but cannot add activities.

  Concrete shortcut: exactly ONE time candidate AND `lockTimes === true` skips `collecting` and opens straight into a blind timed **moment** (the old "exact" plan).
  ```

- [ ] **Step 2: Rewrite the "Everything after the `when`" shared-lifecycle paragraph.** In the same file, replace line 13:
  ```
  Everything after the `when` is shared: a plan moves `collecting -> moment -> cleared` (or a silent `fizzled`); during the moment members RSVP **yes / no / "I'll go if [people]"** (conditionals resolved server-side); a per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**; groups support membership CRUD. Full design: `ARCHITECTURE.md`.
  ```
  with:
  ```
  Everything after collecting is shared: a plan moves `collecting -> moment -> cleared` (or a silent `fizzled`); candidate +1 counts are **public during collecting** (momentum) but no voter names are ever shown - creator anonymity is ALWAYS on; at lock the most-voted TIME candidate wins (and, if the title is empty, the most-voted ACTIVITY candidate becomes the title); the plan then runs a **blind moment** where members RSVP **yes / no / "I'll go if [people]"** (conditionals resolved server-side); a per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**; groups support membership CRUD. Full design: `ARCHITECTURE.md`.
  ```

- [ ] **Step 3: Verify the dead vocabulary is gone from CLAUDE.md.** Run:
  ```bash
  grep -n "whenMode\|fuzzy\|three-mode fork\|loose window\|expandWindow" /Users/gong/Programming/drp_02/CLAUDE.md
  ```
  Expected output: ONE line only - the new line 7 text containing the phrase "older three-mode `whenMode` fork" (the intentional historical reference). No `fuzzy`, no `expandWindow`, no `loose window`, no bullet line mentioning a "mode". If any other line matches, fix it before continuing.

- [ ] **Step 4: Commit.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add CLAUDE.md && git -C /Users/gong/Programming/drp_02 commit -m "docs(claude): rewrite project model to unified suggest flow (one flow, two locks)"
  ```

### Task 7.2: Rewrite README.md "How a plan works"

**Files:**
- Modify: `/Users/gong/Programming/drp_02/README.md` (line 3: the one-line product summary; lines 5-13: the `## How a plan works` section with its three bullets; line 20: the `archive/` description mentioning "convergence model")

- [ ] **Step 1: Rewrite the one-line product summary (line 3).** In `/Users/gong/Programming/drp_02/README.md`, replace line 3:
  ```
  A group meetup-coordination app. A creator floats one plan to a group and chooses only how precisely to pin the time; the plan then converges on a blind timed **moment** where members RSVP **yes / no / "I'll go if [people]"**, and either clears (it's on) or quietly fizzles. A per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**, and groups support membership CRUD. Built as a pnpm monorepo: an Expo mobile client talking to a Fastify + tRPC backend over a shared, end-to-end-typed API.
  ```
  with:
  ```
  A group meetup-coordination app. A creator sends one plan to a group; the group publicly +1s candidate **times** and **activities** (no names shown - it's the group's), then the plan runs a blind timed **moment** where members RSVP **yes / no / "I'll go if [people]"**, and either clears (it's on) or quietly fizzles. A per-user dashboard groups plans by **Reacting / Awaiting / Going / Declined**, and groups support membership CRUD. Built as a pnpm monorepo: an Expo mobile client talking to a Fastify + tRPC backend over a shared, end-to-end-typed API.
  ```

- [ ] **Step 2: Rewrite the `## How a plan works` section (lines 5-13).** Replace the exact block:
  ```
  ## How a plan works

  The only choice the creator makes is how precisely to pin the time:

  - **Set a time** (exact) - it's happening; opens straight into the moment and always clears.
  - **A few options** - a short menu of times; members react ("works for me"), the creator locks the best-supported slot.
  - **Whenever suits** (fuzzy) - a loose window expanded into day candidates; members react, then the creator locks a slot.

  Once a slot is locked (or instantly, for an exact time) the plan runs a blind **moment**: members commit, nobody sees who else is in until it ends, and it clears if enough commit (or always, for an exact plan) or silently fizzles. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full model.
  ```
  with:
  ```
  ## How a plan works

  One create flow, one votable plan. The creator gives the plan an optional title, location, and two candidate lists - **times** (when) and **activities** (what/where) - either of which may be empty. They set two flags, both off by default:

  - **lockTimes** - leave it off and members can add their own times; turn it on to fix the time list to vote-only.
  - **lockThings** - leave it off and members can add their own activities; turn it on to fix the activity list to vote-only.

  During **collecting**, members add to the open lists and tap **+1** on any candidate. Counts are public (momentum) but voter names are never shown. A "Decides by" deadline (editable, defaulting from the candidate spread) ends collecting: the most-voted time wins and - if no title was set - the most-voted activity becomes the title.

  Shortcut: exactly one time with **lockTimes** on skips collecting and opens straight into the moment (this is the old "set a time" / exact plan). Once collecting ends (or instantly, for that shortcut) the plan runs a blind **moment**: members commit, nobody sees who else is in until it ends, and it clears if enough commit (or always, for the contingent-free shortcut) or silently fizzles. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full model.
  ```

- [ ] **Step 3: Update the `archive/` line (line 20) to drop the dead "convergence model" name.** Replace:
  ```
  - `archive/` - the original standalone loose-availability prototype, excluded from the build; its ideas were folded back into the current convergence model
  ```
  with:
  ```
  - `archive/` - the original standalone loose-availability prototype, excluded from the build; its ideas were folded back into the current unified suggest flow
  ```

- [ ] **Step 4: Verify the dead vocabulary is gone from README.md.** Run:
  ```bash
  grep -n "whenMode\|fuzzy\|Whenever suits\|loose window\|convergence model\|Set a time\|A few options" /Users/gong/Programming/drp_02/README.md
  ```
  Expected output: zero lines (clean exit). If anything matches, fix it before continuing.

- [ ] **Step 5: Commit.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add README.md && git -C /Users/gong/Programming/drp_02 commit -m "docs(readme): rewrite 'How a plan works' to unified suggest flow"
  ```

### Task 7.3: Rewrite ARCHITECTURE.md model + packages + privacy + seeding

**Files:**
- Modify: `/Users/gong/Programming/drp_02/ARCHITECTURE.md` (lines 7-20: model intro + three `whenMode` bullets + shared-phase paragraph; line 38: the `@bethere/shared` mermaid node listing `expandWindow`; lines 62-73: the lifecycle sequence diagram `alt when = exact / else when = options | fuzzy`; line 87: the `@bethere/shared` Packages-table row; lines 110-114: the Privacy boundary "Reactions during collecting are private" bullets; lines 121-127: the Demo seeding paragraph referencing `(whenMode x phase)` / `fuzzy`)

- [ ] **Step 1: Rewrite the model intro + three bullets (lines 7-15).** In `/Users/gong/Programming/drp_02/ARCHITECTURE.md`, replace:
  ```
  The product is a **convergence model**. A creator floats one plan to a group, and the
  only fork the user sees is how precisely they pin the time (`whenMode`):

  - **exact** - a fixed time. Skips collecting, opens straight into a blind timed
    **moment**, and always happens ("it's on, who's in?").
  - **options** - a short menu of fixed times. Members react ("works for me"); the
    best-supported slot wins.
  - **fuzzy** - a loose window (a timescale + a part-of-day band) expanded server-side
    into day candidates that members react to.
  ```
  with:
  ```
  The product is a **unified suggest flow**. A creator sends ONE plan to a group through
  ONE create flow. A plan owns two candidate lists - **TIME** (when) and **ACTIVITY**
  (what/where) - each with public +1 counts; voter names are never shown and creator
  anonymity is always on. The creator picks no "mode"; they set two flags, both default
  `false` (open):

  - **lockTimes** - when `true`, the TIME list is vote-only (members cannot add times).
  - **lockThings** - when `true`, the ACTIVITY list is vote-only (members cannot add
    activities).

  Concrete shortcut: exactly ONE time candidate with `lockTimes === true` skips
  collecting (`contingent` false) and opens straight into a blind timed **moment** that
  always happens ("it's on, who's in?") - this subsumes the old "exact" plan.
  ```

- [ ] **Step 2: Rewrite the shared-phase paragraph (lines 17-20).** Replace:
  ```
  Everything after the `when` is shared: a plan moves through phases
  `collecting -> moment -> cleared` (or a silent `fizzled`), and members RSVP during the
  moment with **yes / no / "I'll go if [people]"**. The dashboard groups each user's
  plans by **Reacting / Awaiting / Going / Declined**.
  ```
  with:
  ```
  Everything after collecting is shared: a plan moves through phases
  `collecting -> moment -> cleared` (or a silent `fizzled`). During collecting, members
  add to the open lists and tap **+1**; counts are public (momentum) but blind to names.
  At lock the most-voted TIME candidate wins, and if the title is empty the most-voted
  ACTIVITY candidate becomes the title; the plan then runs a blind **moment** where
  members RSVP **yes / no / "I'll go if [people]"**. The dashboard groups each user's
  plans by **Reacting / Awaiting / Going / Declined**.
  ```

- [ ] **Step 3: Fix the `@bethere/shared` mermaid node (line 38).** Replace the node label:
  ```
    S["@bethere/shared\nZod schemas + pure logic\nresolveIn · clears · findLinchpins\nrevealGoing · tallyCandidates\npickWinningCandidate · expandWindow"]
  ```
  with (drop `expandWindow`, add `pickWinnerOrBestId` to match the kept `candidates.ts` exports):
  ```
    S["@bethere/shared\nZod schemas + pure logic\nresolveIn · clears · findLinchpins\nrevealGoing · tallyCandidates\npickWinningCandidate · pickWinnerOrBestId"]
  ```

- [ ] **Step 4: Rewrite the lifecycle sequence diagram (lines 62-73).** Replace the block:
  ```
    U->>A: events.create { title, location, when, group }
    alt when = exact
      A->>DB: insert event (phase=moment, contingent=false), 1 candidate
      Note over A: opens straight into the blind moment; always clears
    else when = options | fuzzy
      A->>DB: insert event (phase=collecting, contingent=true) + candidates
      U->>A: events.react { worksCandidateIds }  (PRIVATE)
      A->>DB: replace caller's candidate_reactions
      Note over A: creator sees the tally; readyToLock once pickWinningCandidate finds a slot
      U->>A: events.lock { candidateId? }  (creator only)
      A->>DB: set chosenCandidate + moment window, phase=moment
    end
  ```
  with:
  ```
    U->>A: events.create { title?, location?, timeCandidates?, activityCandidates?, lockTimes, lockThings, group }
    alt 1 time candidate AND lockTimes
      A->>DB: insert event (phase=moment, contingent=false), 1 time candidate
      Note over A: concrete shortcut: opens straight into the blind moment; always clears
    else collecting
      A->>DB: insert event (phase=collecting, contingent=true) + TIME and ACTIVITY candidates
      U->>A: events.toggleReaction { candidateId }  (PUBLIC +1, either kind)
      A->>DB: insert/delete caller's candidate_reactions row
      U->>A: events.addCandidate { kind, startsAt? | text? }  (gated by lockTimes/lockThings)
      A->>DB: insert candidate (+1s it for the author)
      Note over A: public counts visible to all (momentum); "Decides by" deadline ends collecting
      U->>A: events.lock { candidateId? }  (creator self only, still anonymous)
      A->>DB: winning TIME -> moment window; if title empty, winning ACTIVITY -> title; phase=moment
    end
  ```

- [ ] **Step 5: Rewrite the `@bethere/shared` Packages-table row (line 87).** Replace:
  ```
  | `@bethere/shared` | Single source of truth: Zod schemas (`WhenInput` discriminated union, `CreateEventInput`/`ReactInput`/`LockInput`/`RespondInput`, enums) + framework-free pure logic - `resolveIn`/`clears`/`findLinchpins` (conditional resolution), `revealGoing` (the blind-until-reveal gate), `tallyCandidates`/`pickWinningCandidate` (collecting), `expandWindow` (fuzzy -> day candidates). Unit-tested. |
  ```
  with:
  ```
  | `@bethere/shared` | Single source of truth: Zod schemas (`CreateEventInput`, `TimeCandidateInput`, `AddCandidateInput`, `ToggleReactionInput`, `LockInput`, `RespondInput`, `CandidateKind` enum `"time" \| "activity"`, `PlanPhase`) + framework-free pure logic - `resolveIn`/`clears`/`findLinchpins` (conditional resolution), `revealGoing` (the blind-until-reveal gate), `tallyCandidates`/`pickWinningCandidate`/`pickWinnerOrBestId` (collecting, kind-agnostic, public count = `userIds.length`), `defaultDecidesByForCandidates` (the "Decides by" default). Unit-tested. |
  ```

- [ ] **Step 6: Rewrite the Privacy boundary "Reactions" bullets (lines 110-114).** Replace:
  ```
  - **Reactions** during `collecting` are private: `events.react` records only the caller's
    taps; per-candidate counts are returned **only to the creator** (for the lock decision).
  - During a blind **moment**, `events.get`/`events.mine` reflect only the caller's own
    answer - never the IN crowd, others' responses, or any running tally.
  ```
  with:
  ```
  - **Reactions** during `collecting` are PUBLIC: `events.toggleReaction` toggles the
    caller's single +1 on a candidate; per-candidate counts are returned to everyone (for
    momentum) for BOTH the TIME and ACTIVITY lists - but voter names are never shown, and
    the creator's identity is always anonymous (`isCreator` is returned as a boolean only,
    never the id).
  - During a blind **moment**, `events.get`/`events.mine` reflect only the caller's own
    answer - never the IN crowd, others' responses, or any running tally.
  ```

- [ ] **Step 7: Rewrite the Demo seeding paragraph (lines 121-127).** Replace:
  ```
  `reseedDemo()` runs on boot when `SEED_ON_BOOT=reset` (the local default: wipe + reseed a
  clean demo each boot); `seedDemoIfEmpty()` runs for `if-empty` (the live backend, so a
  redeploy never wipes real data); `off` skips it. The fixture is 11 users, 5 groups, and 7
  plans chosen to cover every `(whenMode x phase)` the dashboard renders - options/collecting
  (with `You` as creator, so the tally and "Lock it" show), fuzzy/collecting (awaiting your
  reaction), exact/moment (a live blind countdown), cleared (Going and Declined), and a
  fuzzy/fizzled plan (under quorum, so it must stay hidden).
  ```
  with:
  ```
  `reseedDemo()` runs on boot when `SEED_ON_BOOT=reset` (the local default: wipe + reseed a
  clean demo each boot); `seedDemoIfEmpty()` runs for `if-empty` (the live backend, so a
  redeploy never wipes real data); `off` skips it. The fixture is 11 users, 5 groups, and 7
  plans chosen to cover every phase the dashboard renders - a collecting plan with both TIME
  and ACTIVITY candidates (with `You` as creator, so the public counts and "Lock it" show),
  a collecting plan awaiting your +1, the concrete shortcut in a live blind moment countdown,
  cleared (Going and Declined), and a fizzled plan (under quorum, so it must stay hidden).
  ```

- [ ] **Step 8: Verify the dead vocabulary is gone from ARCHITECTURE.md.** Run:
  ```bash
  grep -n "whenMode\|fuzzy\|expandWindow\|WhenInput\|ReactInput\|events.react\b\|convergence model\|\bexact\b\|\boptions -\|floating" /Users/gong/Programming/drp_02/ARCHITECTURE.md
  ```
  Expected output: zero lines (clean exit). The only allowed survivor would be the historical phrase in the new line 7 region if you chose to keep one - confirm any match is intentional. If `expandWindow`, `whenMode`, `events.react`, or `fuzzy` appears anywhere, fix it before continuing.

- [ ] **Step 9: Commit.** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add ARCHITECTURE.md && git -C /Users/gong/Programming/drp_02 commit -m "docs(architecture): rewrite model, lifecycle diagram, privacy, and seeding to unified suggest flow"
  ```

### Task 7.4: Final cross-doc verification sweep

**Files:**
- Read-only (no edits): `/Users/gong/Programming/drp_02/README.md`, `/Users/gong/Programming/drp_02/CLAUDE.md`, `/Users/gong/Programming/drp_02/ARCHITECTURE.md`

- [ ] **Step 1: Sweep all three living docs for any remaining dead vocabulary.** Run:
  ```bash
  grep -rn "whenMode\|expandWindow\|WhenInput\|ReactInput\|FloatAxis\|\bfuzzy\b\|floating\|events\.react\b\|auto-tips\|tipAt\|lockAt\|msLeftToLock\|minHeat\|Brewing\|Float it" /Users/gong/Programming/drp_02/README.md /Users/gong/Programming/drp_02/CLAUDE.md /Users/gong/Programming/drp_02/ARCHITECTURE.md
  ```
  Expected output: zero lines, EXCEPT the single intentional historical phrase "older three-mode `whenMode` fork" on CLAUDE.md line 7 (which legitimately contains `whenMode` as a back-reference). If any other line matches, return to the owning task and fix it.

- [ ] **Step 2: Confirm the new vocabulary is present in each file.** Run:
  ```bash
  grep -l "unified suggest flow" /Users/gong/Programming/drp_02/README.md /Users/gong/Programming/drp_02/CLAUDE.md /Users/gong/Programming/drp_02/ARCHITECTURE.md && grep -rn "lockTimes\|lockThings\|Decides by\|decidesBy\|toggleReaction" /Users/gong/Programming/drp_02/README.md /Users/gong/Programming/drp_02/CLAUDE.md /Users/gong/Programming/drp_02/ARCHITECTURE.md | wc -l
  ```
  Expected output: all three file paths listed (each contains "unified suggest flow"), followed by a count that is at least 6 (the new terms appear across the docs). If a file is missing from the first list, its model paragraph was not rewritten - go back and fix it.

### Task 7.5: Stub the dated session summary (fill in when the refactor ships)

The repo convention (see `docs/summary/`) is one dated session summary per shipped chunk, named `YYYY-MM-DD-HHMM-<slug>.md`. Existing examples: `2026-06-03-1614-lock-in-deadline-bounded-additions.md`. Create a stub now so the writer has the skeleton; fill the body in only when the unified-suggest-flow PR merges to `dev`.

**Files:**
- Create: `/Users/gong/Programming/drp_02/docs/summary/2026-06-04-1200-unified-suggest-flow-one-create-one-plan.md` (rename the `1200` time portion to the actual ship time when filling it in)

- [ ] **Step 1: Create the stub file** at `/Users/gong/Programming/drp_02/docs/summary/2026-06-04-1200-unified-suggest-flow-one-create-one-plan.md` with exactly this content (no em dashes; placeholders flagged with `TODO`):
  ```markdown
  # Unified suggest flow: one create flow, one votable plan

  Date: 2026-06-04
  Status: STUB - fill in when the unified-suggest-flow PR merges to `dev`, then rename the file's HHMM to the ship time.

  ## What shipped

  Collapsed the three-mode `whenMode` fork (exact / options / fuzzy) into ONE create flow and ONE votable plan. A plan now owns two candidate lists - TIME (when) and ACTIVITY (what/where) - each with PUBLIC +1 counts; voter names are never shown and creator anonymity is always on. The only creator choices are two flags, both default `false` (open): `lockTimes` and `lockThings`. "auto-tips"/`tipAt` became an editable "Decides by" (`decidesBy`). The float (fuzzy) frontend was deleted.

  TODO: confirm the final PR number and the commit range.

  ## Shared (`packages/shared`)

  TODO: list the schema changes actually landed - `CandidateKind` (`"time" | "activity"`, replaces `FloatAxis`), unified `CreateEventInput` + `TimeCandidateInput`, `ToggleReactionInput`, reshaped `AddCandidateInput`; deleted `WhenMode`/`WhenInput`/`FloatWindow`/`CreateFloatInput`/`AddIdeaInput`/`AddTimeInput`/`ToggleVoteInput`/`ReactInput`; `PlanPhase` dropped `"floating"`. `lock.ts` rename `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`; `reconcile.ts` + test deleted; `expandWindow`/`Timescale` dropped from the server create path.

  ## API (`apps/api`)

  TODO: the `events.ts` reshape - `create` (TIME + ACTIVITY candidates, `isAnonymous` always true, concrete shortcut), `toggleReaction` (replaces `react`), `addCandidate` (kind-gated by `lockTimes`/`lockThings`), `lock` (creator-self auth, winning ACTIVITY -> title if empty), `mine`/`get` (public counts for both kinds, `isCreator` boolean), `settleCollecting` (decidesBy reads). `floats.ts` deleted and unmounted from `appRouter`. The hand-authored forward migration (additive -> back-migrate `floating` -> `collecting` -> destructive; copy-then-drop float tables; rebuild `plan_phase`; rename `lock_at` -> `decides_by`; rename `float_axis` enum -> `candidate_kind`, value `idea` -> `activity`).

  ## Mobile (`apps/mobile`)

  TODO: deleted `FloatBoard.tsx`, `NewDial.tsx`, `FloatChip.tsx` (look repurposed into `VoteChip.tsx`), Dashboard `FloatCard`; `CreateWizard.tsx` collapsed to one flow (group -> activities -> times -> options -> confirm, submit "Send to the group"); `EventDetail.tsx` CollectingView renders both candidate lists with `VoteChip` + `toggleReaction`, add-gated by the locks; vocabulary swap (Brewing -> Catching on, etc.).

  ## Migration / data notes

  TODO: confirm `SEED_ON_BOOT` behaviour on the live backend (copy-then-drop preserved live data), and the local reset steps run (`docker compose down -v && pnpm db:up`).

  ## Follow-ups

  TODO: anything deferred.
  ```

- [ ] **Step 2: Confirm the stub is staged but NOT yet committed as "shipped".** Run:
  ```bash
  git -C /Users/gong/Programming/drp_02 add docs/summary/2026-06-04-1200-unified-suggest-flow-one-create-one-plan.md && git -C /Users/gong/Programming/drp_02 commit -m "docs(summary): stub unified-suggest-flow session summary (fill in on merge)"
  ```
  Note for the executor: this is a STUB commit. When the refactor PR is ready to merge, replace every `TODO` with the real shipped detail, rename the `1200` in the filename to the actual ship time, and commit the filled-in version. Do NOT leave `TODO` markers in the final merged summary.

---

**Files this phase touches (all absolute):**
- `/Users/gong/Programming/drp_02/CLAUDE.md` (model paragraph, lines 7-13)
- `/Users/gong/Programming/drp_02/README.md` (lines 3, 5-13, 20)
- `/Users/gong/Programming/drp_02/ARCHITECTURE.md` (lines 7-20, 38, 62-73, 87, 110-114, 121-127)
- `/Users/gong/Programming/drp_02/docs/summary/2026-06-04-1200-unified-suggest-flow-one-create-one-plan.md` (new stub)

**Not touched (immutable history):** anything else under `docs/summary/`, `docs/superpowers/`, `docs/drp-context/`.
