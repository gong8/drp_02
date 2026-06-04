# Unified suggest flow: design, build, and live-testing iteration - 2026-06-04

**Branch:** `feat/unified-suggest-flow` (PR #37, MERGED to `dev` at 2026-06-04T16:31:26Z) | **Linear:** DRP-41 | **Scope:** Collapse the three-mode float/flexible/concrete create flow into ONE votable plan, then iterate hard on its UX/behaviour against the live app.

## TL;DR
The session started as a question - "is suggesting a meetup anonymous?" - which a fan-out investigation answered (yes, the float feature is anonymous), and snowballed into a full product redesign. We brainstormed, wrote a spec and a 7-phase implementation plan, executed it subagent-driven (shared schemas -> DB migration -> backend -> mobile wizard -> mobile board -> seed/tests -> docs), and merged it as PR #37. The back half of the session was rapid live-testing iteration with the user: replacing pills with table rows, adding a second "Reply by" deadline, fixing the lock semantics (skip-voting must consider BOTH axes), standardising vocabulary on "activity"/"time", making opt-out instant, and fixing a shown-vs-used reply-by divergence surfaced by the dev "Decide now" button. End state: everything green (typecheck all 3 packages, lint, 33 shared + 26 API tests), merged to `dev`.

## What was done

### Phase A - investigation + design (early session)
- **Anonymity investigation** (Workflow fan-out across shared/api/mobile/docs): confirmed the float feature is anonymous - `createdByUserId` is stored for accountability but never surfaced; `isCreator` is a boolean self-check; counts public, names hidden. Standard (non-float) plans historically attributed a creator via lock/tally powers.
- **Brainstorming** (visual companion in `.superpowers/brainstorm/`, since torn down): explored the create-flow problem. Root diagnosis: the old dial sorted by *time-precision* (float/rough/set) but users think in *intent*; Luca couldn't map "afternoon, see who's free + who's down to do what" to any branch. Mined all 7 interviews + a competitive scan via Workflow.
- **The model the user converged on:** ONE create flow, ONE votable plan owning two candidate lists (TIME + ACTIVITY), each with PUBLIC +1 counts and names never shown, gated by two creator locks (`lockTimes`/`lockThings`, default off = group can shape it). Principle: **public for momentum (votes), blind for honesty (the who's-in moment)**. The float frontend is deleted; anonymity is always on.
- **Spec** written + committed: `docs/superpowers/specs/2026-06-04-unified-suggest-flow-design.md`.
- **Blast-radius analysis** (Workflow): mapped every float touchpoint -> delete/merge/generalize/rename, the DB reshape, and a foundation-first sequence. Folded into the spec's section 11.
- **Implementation plan** written by fanning out per-area drafting against a pinned canonical contract, then assembled + self-reviewed: `docs/superpowers/plans/2026-06-04-unified-suggest-flow.md` (7 phases, 43 TDD tasks).

### Phase B - execution (subagent-driven, one implementer + two reviewers per phase)
- **Phase 1 (shared):** `CandidateKind` enum (`time`/`activity`, replaces `FloatAxis`); unified `CreateEventInput` + `TimeCandidateInput`; `ToggleReactionInput`; reshaped `AddCandidateInput` (kind-gated); `PlanPhase` drops `floating`; deleted `WhenMode`/`WhenInput`/`FloatWindow`/`CreateFloatInput`/etc.; `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`; `addCandidateHorizon` lost its `isFuzzy` arg; `reconcile.ts`+test deleted.
- **Phase 2 (DB):** hand-authored migrations `0005` (additive: `candidate_kind` enum, `event_candidates.kind` + nullable `starts_at`, `events.lock_times`/`lock_things`, `lock_at`->`decides_by`, copy `float_suggestions`->`event_candidates` and `float_votes`->`candidate_reactions`, back-migrate `floating`->`collecting`) and `0006` (destructive: drop float tables/`min_heat`/`when_mode`, rebuild `plan_phase`). Later `0007` added `reply_by`.
- **Phase 3 (backend):** reshaped `events.ts` - unified `create`, `toggleReaction` (replaces `react`), kind-gated `addCandidate`, creator-self `lock` (removed the `isAnonymous` FORBIDDEN guard), `mine`/`get` return both candidate lists with PUBLIC counts, `settleCollecting` resolves winning activity into the title; deleted `floats.ts` + unmounted from `appRouter`. Extracted pure `planOpensMoment` + `resolveTitle` into `create-plan.ts` with unit tests.
- **Phase 4 (mobile wizard + nav):** collapsed `CreateWizard` to one flow (group -> activities -> times -> options -> confirm mirror) calling `trpc.events.create`; deleted `NewDial`; removed `NewDial`/`FloatBoard`/`branch` from `App.tsx`.
- **Phase 5 (mobile board):** unified `EventDetail` CollectingView (two candidate lists, public +1 via `toggleReaction`, gated add); deleted `FloatBoard`/`FloatChip`; de-floated Dashboard + notifications.
- **Phase 6 (seed/tests):** rewrote the `e_float_climb` fixture as a dual-list collecting plan; kind-aware integrity checks.
- **Phase 7 (docs):** rewrote `CLAUDE.md`/`README.md`/`ARCHITECTURE.md` to the one-flow/two-locks model.

### Phase C - live-testing iteration (the long tail, after merge prep)
Each item below is a user-reported issue from running the app, then fixed:
1. **Table rows over pills** (`5fe2d98`, `3f6fae2`): replaced `VoteChip` pills with `SelectCheck`-style table rows; introduced shared `ui/Row.tsx` so the create flow and voting board share ONE row look; compact inline "Add" (using `Field`'s `right` slot) instead of `Card` + full-width button; removed the part-of-day quick chips; activities render as rows not chips.
2. **Nameless collecting plans** (`1fa4cc9`): `displayTitle` shows the leading activity (or `FALLBACK_TITLE`) so a plan never renders blank; concrete plans now persist a real title from their activity.
3. **Second deadline "Reply by"** (`a512521`..`e0147b0`, `60168f3`): editable RSVP/commit deadline. Two deadlines now: **Decides by** (vote closes, winner locks) -> **Reply by** (blind RSVP closes, reveal + resolve). Default = a lead before the event (same shape as decides-by, user chose option "a"). The client ALWAYS sends the shown reply-by so the server stores+uses exactly what was displayed.
4. **Lock semantics fixed** (`6357fba`, `532762c`, `e3215f5`): `planOpensMoment` now considers BOTH axes - skip voting ONLY when `(lockTimes && 1 time) && (lockThings && <=1 activity)`. "Decides by" hidden on concrete plans. You can only lock an axis that has >=1 candidate (client disables the checkbox + server guard). The confirm ("Ready to send?") mirror now branches on lock state, not just time-count.
5. **Vocabulary** standardised on "activity"/"time" (was places/things/idea/what-where). Lock label "Lock the activity".
6. **Instant opt-out** (`e3215f5`): "I can't make it" was laggy because it wasn't poll-guarded and didn't optimistically clear the user's +1s (the server clears them on opt-out). Now it clears them immediately and blocks the 5s poll mid-mutation (sentinel `OPTOUT_PENDING`).
7. **Dev "Decide now" wrong time** (`60168f3`): see Key decisions.

## Key decisions & rationale

- **One votable plan + two locks, not three modes.** Users think in intent, not time-precision; Tom independently re-invented "one option with add-a-time below it." The two locks (`lockTimes`/`lockThings`) are orthogonal permission flags, not a mode picker. This unbundled anonymity, ownership, and what-openness, which the old `whenMode` silently conflated.
- **Public counts during collecting, blind moment for commitment.** Visible vote counts are the momentum engine ("once a few people do, everyone does"); the who's-in moment stays blind to avoid the no-cascade (Luke's "no public maybe").
- **Skip-voting must consider BOTH axes** (the central lock bug). The old `planOpensMoment(timeCount, lockTimes) = timeCount===1 && lockTimes` ignored activities, so "fixed time + open activities" wrongly skipped collecting and the group never got to suggest the activity. New rule: `(lockTimes && timeCount===1) && (lockThings && activityCount<=1)`. Computed identically in the server helper AND the client `isConcrete` so the preview can never diverge.
- **You can only lock an axis with >=1 candidate.** The user's framing: locking is for fixing existing candidates. `lockTimes`+0-times is a dead plan (no time, can't add, silently fizzles). `lockThings`+0-activities was briefly argued "valid (just a time)" but the user overruled for symmetry/clarity. Enforced client (disabled checkbox) + server (BAD_REQUEST).
- **"Reply by" default = a lead before the event (option a).** Alternatives weighed: (b) reply right up to the event = the "4-day blind window" the user disliked; (c) short fixed window after voting = reveals arbitrarily early ("strange"). (a) mirrors how "Decides by" defaults, so the two deadlines feel like one system. Implemented by delegating `defaultReplyByMs(open, event)` to `defaultDecidesByForCandidates(event, open)` (keeping a degenerate already-here guard).
- **Always SEND the shown reply-by** (fixes the dev-lock wrong-time bug). The create flow displayed a default reply-by but only sent it when edited; the server then recomputed its own default at LOCK time, anchored to the lock moment (which for a dev "Decide now" is way before the deadline you saw) -> shown != used. Fix: client always sends the displayed value (edit or default), server stores it verbatim. NOTE: `decidesBy` never had this bug because the server always stores it at create.
- **Shared `Row` primitive** to cure UI inconsistency. The user's "why is the UX so inconsistent" was a real critique - two row idioms (pills vs checkboxes). One shared component guarantees the create flow and board read as the same table.

## Things learned / discovered

- **Drizzle single-transaction migration + Postgres 55P04.** This drizzle version wraps ALL pending migrations in ONE transaction. On a fresh DB, `0004`'s `ALTER TYPE plan_phase ADD VALUE 'floating'` is uncommitted when `0005` references `'floating'`, raising `55P04 unsafe use of new value`. Fix: compare `phase::text = 'floating'` (never the enum literal) in the back-migrate. Verified both apply paths (CLI `drizzle-kit migrate` AND the runtime `drizzle-orm` boot migrator on a fresh DB).
- **`drizzle-kit generate` hangs** in non-TTY on rename-vs-create ambiguity (enum value rename, column rename). All migrations were hand-authored: write the `.sql` + append a `meta/_journal.json` entry; the runtime migrator ignores `meta/*_snapshot.json`. There are NO snapshots for 0005-0007 (pre-existing pattern since the hand-authoring began) - a future `drizzle-kit generate` would diff against the stale 0004 snapshot.
- **Client/server predicate divergence is a recurring trap.** `isConcrete` (client) and `planOpensMoment` (server) must be byte-equivalent; the mobile cannot value-import `@bethere/shared` (Metro can't resolve the `.js` barrel), so `apps/mobile/src/lib/lock.ts` is a HAND-MAINTAINED mirror of `packages/shared/src/logic/lock.ts` - keep them in sync.
- **Optimistic UI + a 5s poll** needs a pending-guard sentinel set or the poll clobbers optimistic state (seen on both `toggleReaction` and `toggleOptOut`); opt-out also had to optimistically mirror the server's side-effect of clearing the user's reactions.
- **`pnpm test` aggregate hangs** (mobile jest leaks a handle). Run per-package: `pnpm --filter @bethere/api test`, `pnpm --filter @bethere/shared test`; `pkill -f jest` after any mobile test.
- **Do NOT `docker compose down -v` while the user's dev server is live** - it killed their API's pg pool (`ECONNRESET`) and briefly emptied the DB before reseed (`FORBIDDEN` on `requireMember`), which the user reported as a create bug. It was a verification side-effect, not a code bug.
- **A concrete plan skips `lock`/`settleCollecting`** - the only places `resolveTitle` ran - so its activity was never promoted to the title until we resolved it at create time.

## Current state
- **PR #37 MERGED to `dev`.** All work above is on `dev`.
- **Green:** `pnpm typecheck` (shared/api/mobile all Done), `pnpm lint` (biome), `pnpm --filter @bethere/api test` (26 pass), `pnpm --filter @bethere/shared test` (33 pass). Mobile screens have no unit tests (typecheck + manual).
- **DB:** local Postgres on host port 5433; migrations through `0007`; seed `e_float_climb` is a dual-list collecting plan.
- **Spec/plan:** `docs/superpowers/specs/2026-06-04-unified-suggest-flow-design.md`, `docs/superpowers/plans/2026-06-04-unified-suggest-flow.md`.
- **Stub summary** `docs/summary/2026-06-04-1200-unified-suggest-flow-one-create-one-plan.md` still contains `TODO` placeholders (was a fill-on-merge stub) - this file supersedes it; consider filling or deleting the stub.

## Conventions, commands & workflows
- `pnpm` only. ESM api (relative imports need `.js`). Mobile imports `@bethere/api` type-only. **No em dashes** anywhere (hyphens).
- Hand-author DB migrations; never run `db:generate`. Local reset: `docker compose down -v && pnpm db:up` (only when no one's testing). Apply: `pnpm --filter @bethere/api db:migrate`. API runs migrate+seed on boot (`SEED_ON_BOOT`).
- Tests per-package; `pkill -f jest`. `pnpm lint` / `pnpm format` (biome).
- Branching: work on `dev`; big features on `feat/*` -> PR into `dev`. Frontend+backend+shared land together (trpc type chain).
- Wire/schema names (`lockThings` field, `lock_things` column, `candidate_kind` enum) are KEPT even though display copy says "activity"; renaming would need a migration.

## Known issues / caveats / risks
- **ARCHITECTURE.md seeding paragraph** likely still says "7 plans" + "a fizzled plan" - the final review flagged this as wrong (fixture is 6 plans, none fizzled, and the dual-list collecting plan is `u_adi`-created not "You") and it is NOT confirmed fixed in the commits. Verify/fix.
- **Clock-skew bound edge** (minor): editing a deadline to within minutes of its floor then lingering can fail server validation into the generic "Something went wrong" (retry works). Same class for decides-by and reply-by.
- **`reply_by` not shown on the detail screen** while collecting (the API returns it; UI doesn't display it yet).
- **`resolveMomentEnd` floor clamp** can push a custom reply-by up to `lockNow + 1h` if it was set very close; narrow.
- DB `events.is_anonymous` default was reconciled to `true` in `0006`; `isAnonymous` is effectively always true.

## Next steps
1. Mark **DRP-41 Done** in Linear (work is merged); reference PR #37.
2. Fix the ARCHITECTURE.md seeding-paragraph inaccuracy (the owed doc tidy-up).
3. Optionally show "Reply by" on the EventDetail collecting screen.
4. Deferred product calls from the spec (sections 10/12): collaborative where/what scope, no-install web RSVP link, system nudging of non-responders, reschedule-on-deadlock, moment RSVP shape (binary vs soft), part-of-day vs clock granularity, whether to bundle `event`->`plan` vocab rename.
5. Fill in or delete the `1200` stub summary.

## References
- Spec: `docs/superpowers/specs/2026-06-04-unified-suggest-flow-design.md`
- Plan: `docs/superpowers/plans/2026-06-04-unified-suggest-flow.md`
- Backend: `apps/api/src/routers/events.ts`, `apps/api/src/routers/create-plan.ts` (`planOpensMoment`/`resolveTitle`/`displayTitle`), `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0005_*`..`0007_*`
- Shared: `packages/shared/src/schemas.ts`, `packages/shared/src/logic/lock.ts` (`defaultDecidesByForCandidates`/`defaultReplyByMs`/`addCandidateHorizon`), `packages/shared/src/logic/candidates.ts`
- Mobile: `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/src/screens/EventDetail.tsx`, `apps/mobile/src/screens/Dashboard.tsx`, `apps/mobile/src/ui/Row.tsx`, `apps/mobile/src/lib/lock.ts` (hand-mirror)
- PR: #37 (feat/unified-suggest-flow -> dev, merged 2026-06-04)
