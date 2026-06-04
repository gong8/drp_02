# Lock-in deadline + bounded additions for flexible plans - 2026-06-03

**Branch:** dev | **Linear:** DRP-32 (Done), DRP-40 (Todo, follow-up) | **Scope:** Make the lock-in deadline for non-exact (options/fuzzy) plans logically sound and well-placed, and bound the times members can add.

## TL;DR
This session started as a Q&A about whether the lock-in logic for flexible plans "made sense" (it didn't fully), turned into a design + implementation effort. We reframed the core bug: `events.lockAt` was stored as a fixed wall-clock instant but its real meaning is "shortly before the event," and it was computed once from the earliest candidate and never reconciled. We shipped two intent-named default-deadline helpers (one for a deliberate options time, one for a loose fuzzy window), tightened the creator override bounds, added an upper bound on member-added candidate times (server + mobile picker), and removed the old helper. All landed on `dev` across 6 commits (`332f06b..cd10d8d`), verified green (lint, typecheck, per-package tests). The remaining half of the question - when the blind "moment" runs and for how long - was deliberately left out of scope and filed as DRP-40.

## What was done

### Investigation (the user's original 3 questions)
The user asked, for a flexible plan where a non-creator adds times: (1) can you add dates beyond the lock-in window "badly"? (2) does lock-in ever update when you add times after? (3) how robust is the logic? Findings (verified by reading code):
- **(1) Yes, unbounded.** `addCandidate` had only a lower bound (`startsAt > lockAt`); no upper bound, so a member could add an absurd far-future time that could win, firing the lock long before the event.
- **(2) No.** `lockAt` was set once at creation (or float crystallization) and never recomputed when candidates changed.
- **(3) Internally consistent but semantically leaky.** The `> lockAt` rule and the `momentEnd = min(lock+moment, chosen)` clamp are sound, but `lockAt` froze against the original earliest candidate and drifted out of proportion to the live set. Also naive for fuzzy windows (see below).

### Design (brainstorming skill -> spec)
- The user chose: **deadline is fixed once set**; creator may override the default at create time; **added times bounded to the plan's window/horizon**.
- They asked for careful analysis of the default placement. Key insight surfaced: a single "lead before the earliest candidate" rule is wrong for **fuzzy** plans, because `expandWindow` always emits a slot for tomorrow (sometimes today), so the earliest is ~always "soon" even for a "next two weeks" window -> "1 day before the earliest" would lock tonight after a near-zero react window (the squeeze).
- Spec written to `docs/superpowers/specs/2026-06-03-lockin-deadline-bounded-additions-design.md` (committed `312c13b`).

### Implementation (writing-plans -> subagent-driven-development, 6 tasks)
Plan at `docs/superpowers/plans/2026-06-03-lockin-deadline-bounded-additions.md`. Executed task-by-task with a fresh implementer subagent + spec-compliance review + code-quality review each.

| Commit | What |
|---|---|
| `332f06b` | shared: `defaultLockAtForOptions`, `defaultLockAtForWindow`, `addCandidateHorizon` + constants, vitest tests (added alongside old `defaultLockAt`) |
| `83960aa` | api events.ts: per-mode create default, override bound tightened to `anchor - moment`, bounded `addCandidate` + empty-spread guard, `settleFloating` anchored to last slot |
| `dfd4669` | api floats.ts: tip default anchored to window's last slot |
| `4a169c2` | mobile: mirror `defaultLockAtForOptions` + `addCandidateHorizon`; update CreateWizard |
| `0dcb5ca` | mobile: `maximumDate` threaded through DateTimeField/types/web/Pill; add-time picker bounded `[lockAt, horizon]` |
| `cd10d8d` | shared: delete superseded `defaultLockAt` + its test block; full lint/typecheck/test |

## Key decisions & rationale

- **Fixed deadline, not adaptive.** Options were: (A) fixed-once-set, (B) recompute relative to soonest option, (C) creator sets it explicitly. User picked fixed + smart default + creator override. Rationale: predictability ("we decide at X") beats a deadline that silently moves when someone adds an earlier time; bounding additions removes the need to recompute.

- **Two anchors for the default, by mode.** A single formula can't serve both because the "earliest candidate" means different things:
  - **options/exact-N** (a deliberate time): `defaultLockAtForOptions` - notice lead = `clamp(round(T/3), MOMENT_MS, DAY_MS)`, `lockAt = earliest - lead`. The `/3` gives the active reacting phase the larger share; lead caps at one day. Degenerate near-term falls back to a midpoint clamped under `earliest - moment`.
  - **fuzzy** (a loose window): `defaultLockAtForWindow` - react = `clamp(round(span/3), MIN_REACT_MS, MAX_REACT_MS)`, `lockAt = min(now + react, lastSlot - moment)`. Anchors to the window span (not the always-soon earliest slot), fixing both the squeeze and the long-drag. The 3-day react cap stops a loose long-horizon plan from sitting open and losing momentum.

- **Bounded additions = window/horizon, surfaced in the picker.** `addCandidateHorizon(earliest, latest, isFuzzy)`: fuzzy -> `latest` (window's last day); options -> `latest + min(span, 2*DAY_MS)` (small slack past the creator's spread, the one tunable). Enforced server-side AND in the mobile date picker via the new `maximumDate` so it's self-evident rather than a rejection-after-the-fact.

- **Override bound tightened** from `> earliest` to `> anchor - moment` so a creator-set deadline always leaves the blind moment room before the anchor slot.

- **Moment duration left out of scope.** The blind moment still opens at `lockAt` and runs ~1h regardless of how far the event is. Fixing the lock placement without fixing this means a multi-day-out winner can have its time-pressured moment fire days early. Deliberately deferred to DRP-40 - it's the other half of the same question and needs its own design pass.

- **Constants:** `MOMENT_MS = 60*60*1000`, `DAY_MS = 24*MOMENT_MS`, `MIN_REACT_MS = 2*MOMENT_MS` (2h), `MAX_REACT_MS = 3*DAY_MS` (3 days). `DEFAULT_MOMENT_MINUTES = 60` in both routers.

## Things learned / discovered

- **`pnpm test` (aggregate) never self-exits** because the mobile package's `jest --watchAll=false` passes its tests (~0.6s, 5 tests, 2 suites) then prints *"Jest did not exit one second after the test run has completed"* and hangs on a leaked open handle. Running all packages recursively, that holds the whole run open forever; two concurrent invocations made it look permanently stuck. **Run tests per-package** (`pnpm --filter @bethere/shared|api|mobile test`) and `pkill -f jest` after the mobile one. Also: don't pipe long test runs through `grep`/`tail` - grep buffers and shows nothing until exit. (Recorded to auto-memory `pnpm-test-mobile-jest-hang.md`.) Possible real fix later: add `--forceExit` (or `--detectOpenHandles` to find the leak) to the mobile test script.

- **No tRPC router test harness exists.** API tests (`apps/api/src/.../*.test.ts`, run via `node --import tsx --test`) are pure unit tests; there is no DB/caller harness for routers. So all new testable logic was placed as pure functions in `packages/shared/src/logic/` (vitest) and routers kept thin. Router edits are covered by typecheck + the shared unit tests, not integration tests.

- **Per-task typecheck != lint.** The implementer subagents ran `typecheck` per task but not `lint`; Biome import-sort/line-wrap violations introduced in the api/mobile edits were only caught in Task 6's `pnpm lint`. They were auto-fixed with `pnpm format` and folded into `cd10d8d`. Lesson: run `pnpm lint` per task too, or accept a format pass at the end.

- **Mobile cannot value-import `@bethere/shared`** (Metro can't resolve the barrel's explicit `.js` extensions), so `apps/mobile/src/lib/lock.ts` keeps a hand-maintained byte-for-byte mirror of the shared helpers. The mirror was verified identical in review. `defaultLockAtForWindow` is intentionally NOT mirrored (server-only).

- **`expandWindow` never returns empty** (it rolls forward up to 14 days if all slots passed), so `slots[slots.length-1]` and `Math.min/max(...candTimes)` are safe in practice. A defensive empty-spread guard was still added to `addCandidate` (review finding) because `Math.min(...[]) = Infinity` would silently disable the horizon check.

- Two commits after this work (`4fb348f` add simplify refactor command, `0670a61` DRP-33 multi-agent code-quality report) are NOT from this session's lock-in work; they appeared separately (a `/simplify-refactor` run).

## Current state

- All 6 lock-in commits are on `dev` (`332f06b..cd10d8d`). Working tree clean.
- **Verified on `cd10d8d`:** `pnpm lint` clean (92 files), `pnpm typecheck` clean (3 packages), tests pass per-package (shared 44, api 14, mobile 5).
- **Not pushed to `main`.** User chose to leave it on `dev` for now (no `dev -> main` PR opened).
- DRP-32 marked **Done** with commit range + summary. DRP-40 created (**Todo**) for the moment-duration follow-up.

## Conventions, commands & workflows
- `pnpm` only. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before a PR - but test **per package** (see jest hang above).
- Work directly on `dev` for routine work; only `dev -> main` PRs may merge to `main`. This feature was committed straight to `dev` (no feature branch) per that rule.
- No em dashes anywhere (hyphens only) - enforced by Biome.
- Type chain: Zod schemas in `packages/shared` -> tRPC procedures in `apps/api` -> mobile types follow. `apps/api` is ESM (`.js` import extensions). Mobile imports `@bethere/api` type-only.
- Track work in Linear (team DRP_02) via MCP.

## Known issues / caveats / risks
- **DRP-40 (deferred):** moment opens at `lockAt` and runs a fixed ~1h regardless of distance to the event; on a far-out winner the blind moment fires too early and loses its pressure. Needs design.
- **Options horizon slack** (`min(span, 2*DAY_MS)`) is a guess; a single-option "options" plan has `span = 0` so no later time can be added. Tunable; revisit if it annoys users.
- **Picker bound is date-granular** (`maximumDate`/`minimumDate` are date-mode only), so the UI bound is coarse; the server enforces the precise `lockAt`/horizon. Acceptable by design.
- **Mobile lock mirror can drift** from `packages/shared/src/logic/lock.ts` - they must be kept in sync by hand.
- No automated test exercises the router-level bounds (no harness); covered by shared unit tests + typecheck only.

## Next steps
1. Think through DRP-40 (moment timing/duration) - suggested to brainstorm it the same way; it is entangled with lock-in placement.
2. When ready to ship, open a `dev -> main` PR (CI runs on PRs into main; CD deploys backend + Android build on push to main).
3. Optional: add `--forceExit` to mobile's jest script to stop the aggregate `pnpm test` hang.
4. Optional: reconsider the options-mode horizon slack after dogfooding.

## References
- Spec: `docs/superpowers/specs/2026-06-03-lockin-deadline-bounded-additions-design.md`
- Plan: `docs/superpowers/plans/2026-06-03-lockin-deadline-bounded-additions.md`
- Core logic: `packages/shared/src/logic/lock.ts` (+ `lock.test.ts`), `packages/shared/src/logic/window.ts` (`expandWindow`, `PART_HOUR`)
- Routers: `apps/api/src/routers/events.ts` (`create`, `settleCollecting`, `settleFloating`, `addCandidate`, `lock`), `apps/api/src/routers/floats.ts`
- Mobile: `apps/mobile/src/lib/lock.ts`, `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/src/screens/EventDetail.tsx` (`CollectingView`), `apps/mobile/src/ui/DateTimeField.{tsx,web.tsx,types.ts}`, `apps/mobile/src/ui/DateTimePill.tsx`
- Linear: DRP-32 (https://linear.app/drp-02/issue/DRP-32), DRP-40 (https://linear.app/drp-02/issue/DRP-40)
- Architecture context: `ARCHITECTURE.md`, `CLAUDE.md`
