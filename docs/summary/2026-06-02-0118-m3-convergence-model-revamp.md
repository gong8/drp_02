# M3 "convergence model" revamp: react-to-options -> blind timed moment - 2026-06-02

**Branch:** dev (work landed via PR #28) | **PRs:** #28 `feat: iteration 1 of flexible scheduling` (feat/m3-convergence-model -> dev, MERGED) | **Scope:** Redesign + implement BeThere's core meetup interaction as one convergence pipeline (variable-precision `when` -> react to candidate times -> creator-locked blind moment -> reveal / silent fizzle).

## TL;DR
This session reworked BeThere's core interaction from the M2 "concrete-event RSVP" model into a single **convergence pipeline**: a creator floats a plan whose `when` is expressed at variable precision (an exact time, a few options, or a fuzzy window), members **react** to candidate times (no availability grid), the creator **locks** the best-supported slot which opens a **blind + timed moment** (in / in-if-[people] / no), and the plan then **clears** (reveal who's in) or **silently fizzles** (contingent plans only). The design was reached through an extended brainstorm grounded in the team's own user research, then implemented full-stack (shared Zod + logic, Drizzle schema/migration/seed, tRPC router, mobile screens), verified end-to-end via curl, hardened with an adversarial multi-agent review (8 minor findings, all fixed), and **merged into `dev` (PR #28)**. The backend is verified working; the **mobile UI was not visually run** this session (only typecheck + API-contract verified), and the local Postgres volume needs a reset for a clean boot.

## What was done

### 1. Design / brainstorm (the core of the session)
- Starting question from the user: are there two distinct kinds of "suggesting a meetup" - **concrete/organise** (e.g. "bowling at Tenpin Bexleyheath, 2 days from now 7pm", needs a booking) vs **handwavy/float** (e.g. "the pub sometime in the next 2 weeks when people are free")?
- Read the authoritative DRP user research under `docs/drp-context/` (4 interview transcripts + a 44-row survey CSV + M2 mockups). **Key findings that reframed the problem:**
  - Plans rarely die *after* they are firm (survey: most "Rarely (<10%)" bail within 24h; Luke: *"once the plan has decided, typically most people do show up"*). The M2 concrete-RSVP model was solving the part that already works.
  - Plans die *before* firm, from three mechanisms: **clashing schedules** (#1-ranked barrier), the **uncertainty cascade** (Luke: *"when someone expresses uncertainty, it cascades on the group"* - one "can't do that day" -> chat goes silent -> dead), and **asymmetric initiator effort** ("mostly one specific friend").
  - Validated mechanics: **conditional RSVP** ("I'll go if [people]") is how people actually use "maybe"; a **private/invisible** signal that only surfaces on a match (survey: most would use it *more* than messaging the group); a **timed yes/no moment with no "maybe"** (Luke invented this unprompted, BeReal-style); **coarse time** ("people aren't that specific").
- Resolved the "two types" tension: **there is one plan; the precision of `when` routes behaviour, and the user never picks a "type".** The number of candidate times *is* the type (1 = exact, a few = options/booking-constrained like movie showtimes, open = fuzzy).
- Resolved the friction worry ("no one can be arsed to fill out availability"): **no availability grid.** Everyone reacts to a small pool (1-4) of candidate times; "multiple fixed options" becomes the *general* engine, not a special case. Reaction = cheap feasibility ("I could"); the moment = real commitment ("I will") - the spec's "when != want" principle.
- The design was written to the plan file `/Users/gong/.claude/plans/ultrathink-we-want-to-rippling-prism.md` and approved (ExitPlanMode). Note: no `docs/superpowers/specs/` design doc was produced - the brainstorm transitioned straight into plan-mode + execution.

### 2. Implementation (ultracode mode, on feat/m3-convergence-model)
Tracked as Linear **DRP-29** (created In Progress). Layers:

- **packages/shared**
  - `schemas.ts`: new `PartOfDay`, `Timescale`, `WhenMode`, `PlanPhase` Zod enums; `WhenInput` discriminated union (`exact` {startsAt} | `options` {options[]} | `fuzzy` {timescale, band}); `CreateEventInput` now carries `when` + optional `quorum`; new `ReactInput`, `LockInput`. Kept `ResponseKind`/`Conditional`/`RespondInput`/`ResolveInput`.
  - `logic/candidates.ts` (new): `tallyCandidates`, `pickWinningCandidate` (best-supported candidate meeting quorum; ties -> earliest; mirrors the archived `findClearingSlot`).
  - `logic/window.ts` (new): `expandWindow(timescale, band, fromMs)` -> day candidates; `PART_HOUR` (morning 10 / afternoon 14 / evening 19 / late 22).
  - **Reused unchanged**: `logic/resolve.ts` (`resolveIn` conditional cascade, `clears`, `findLinchpins`) and `logic/reveal.ts` (`revealGoing` blind-until-resolved).
  - Tests (vitest): `candidates.test.ts`, `window.test.ts`. Suite = 23 passing.
- **apps/api (DB)**
  - `db/schema.ts`: **additive only** - new enums `when_mode`/`plan_phase`/`part_of_day`; `events` gains `whenMode`, `contingent`, `quorum`, `phase`, `chosenCandidateId`, `momentStartsAt`, `momentEndsAt`; new tables `event_candidates` and `candidate_reactions` (PK (candidate_id, user_id)). Legacy `status`/`startsAt`/`respondByAt` retained.
  - Migration `0002_windy_bruce_banner.sql` generated **non-interactively** (additive-only avoids the drizzle-kit rename prompt).
  - `db/seed.ts`: rewritten with phase-rich demo plans (movie=options/collecting, pub=fuzzy/collecting, bowling=exact/moment, climbing+dinner=cleared, football=exact/cleared/declined, baking=fuzzy/fizzled). Delete order extended to clear `candidate_reactions` + `event_candidates` first.
- **apps/api (router)** - `routers/events.ts` full lifecycle:
  - `create` (branch on `when.mode`, expand fuzzy via `expandWindow`, insert candidates), `react` (replace caller reactions; phase=collecting guard), `lock` (creator-only; `pickWinningCandidate` with fallback; opens the moment), `respond` (moment commitment; phase=moment guard; reuses `responses`), `resolve`/`settlePhase` (lazy settle on read - clears or fizzles), `mine` (phase-aware dashboard, **excludes fizzled**), `get` (phase-aware detail, **creator-only candidate counts**, **blind reveal** via `revealGoing`). `requireMember` on every procedure.
- **apps/mobile**
  - `lib/format.ts`: `formatSlot`, `partOfDayLabel`, `formatCountdown`.
  - `screens/CreateEvent.tsx`: the when-picker (mode chips; fuzzy = timescale + band chips; options = dynamic date/time rows with stable ids).
  - `screens/EventDetail.tsx`: **phase-aware** - collecting (react inline + creator tally/"Lock it"), moment (blind countdown + in/in-if/can't, reuses the conditional bottom sheet), cleared (reveal who's in), fizzled (quiet message). 5s poll + 1s countdown ticker. Reacting was **folded into EventDetail** rather than a separate `ReactToOptions` screen.
  - `screens/Dashboard.tsx`: phase-aware rows + "It's coming together" banner for live moments + 5s poll.
  - `ui/StatusCheck.tsx`: added a `reacting` state (pink dot).
- **docs/tech-debt.md**: new entry "Real-time is polling; no real push notifications" (records the deferred dev-build + APNs/FCM work).

### 3. Verification
- **Backend end-to-end via curl** (dev server + `x-user-id` to simulate multiple users): all three when-modes (exact -> instant blind moment; options -> react -> creator locks best slot -> moment; fuzzy -> react days -> lock -> cleared AND a silent-fizzle run); confirmed private creator-only counts, blind reveal (`revealed:false`, `going:[]` during the moment), cleared reveal, and that fizzled plans are excluded from the dashboard.
- **Gates**: `pnpm lint` clean, `pnpm typecheck` clean (all 3 packages), shared 23/23, api 8/8. (The full `pnpm test` including mobile's jest-expo dummy was *not* observed to completion this session - see caveats.)
- **Adversarial review workflow** (5 reviewers x verify): 8 confirmed findings, **all minor/nit, zero blockers**. All 8 fixed (see Key decisions).

### 4. Branch / merge (performed by the user near the end)
- While the session was still waiting on the full test run, the user committed the work on `feat/m3-convergence-model` (`1f70fb1`), switched to `dev`, and ran `pnpm kill && pnpm dev`. That boot **crashed** on `reseedDemo` with a foreign-key violation - the docker Postgres volume already had the `candidate_reactions` table (migration 0002 applied during testing) but `dev`'s *old* seed deleted `events` without first clearing `candidate_reactions`. This was a transient cross-branch mismatch.
- The work was then merged: **PR #28 (feat/m3-convergence-model -> dev), merge commit `f822900`.** `dev` now contains the new convergence code, so the seed-FK crash no longer applies on a fresh boot.

## Key decisions & rationale

| Decision | Rationale / alternatives |
|---|---|
| **One plan; precision of `when` is the "type", invisible to the user** | The SWE instinct was two distinct flows; the user-centred answer is one creation gesture. Forcing a category up front is friction and people don't know which they mean. Backend still branches (exact/options/fuzzy) under the hood. |
| **React to 1-4 candidate times; NO availability grid** | when2meet-style grids are exactly what people won't fill in ("no one can be arsed"). Reacting to a small pool is 1-3 taps. This also makes "multiple fixed options" (movie showtimes) the general engine rather than a bolt-on. |
| **Blind + timed moment as the commit step (in / in-if / no, no "maybe")** | Directly attacks the uncertainty cascade and FOMO from the research; Luke proposed it unprompted. Chosen over open async RSVP (which M2 had) because the anti-cascade blindness is the differentiator. |
| **Creator-fired lock (not auto-fire)** | Legible + demoable + keeps booking control; kills the asymmetric chasing without full "magic". Auto-fire deferred. |
| **Under-quorum: fizzle (contingent) vs always-happen (exact), implied by precision** | Avoids a separate user question. Exact = committed (always happens); options/fuzzy = contingent (silent fizzle, no trace - backed by 56% having lied to dodge plans + "no public no"). |
| **Reactions private; only the creator sees per-candidate counts** | Preserves the privacy invariant from the original spec; members see `count: null`. |
| **Polling (~5s) for real-time, push as tech debt** | Real remote push needs a dev build + physical device + Apple Developer account; the iOS Simulator cannot receive remote push and Expo Go dropped it in SDK 53+. Polling satisfies the DRP "real-time" requirement for supervised testing. Bundle real push with the planned dev-build migration. |
| **Additive-only DB migration** | `drizzle-kit generate` is interactive and hangs on rename-vs-create ambiguity in non-TTY. Adding columns/tables/enums (no renames, no NOT NULL alters) keeps generation non-interactive. |
| **Fold reacting into EventDetail (no separate ReactToOptions screen)** | One phase-aware screen is cleaner UX and reuses the existing detail route + conditional bottom sheet; less surface area. |
| **Match the current neobrutalist theme, not the archived sage palette** | The shipped app uses the DRP-25 refined-neobrutalist system (pink #FF5CA8, hard shadows, Archivo). The archived loose-availability screens use a different (sage) look - reused their *structure*, not their *style*. |

### Review findings fixed (all minor/nit)
1. **Exact-plan moment window** (`events.ts`): removed the `min(start, now+1d)` cap that prematurely revealed far-future exact plans and locked out late responders (and insta-cleared past ones). Now `momentEndsAt = startsAt`, clamped to a 60-min minimum window if the time is past/imminent. Verified via curl.
2. **`window.ts` empty fallback**: rolled forward to the next valid slot instead of emitting a past time (+ a new test).
3 + 4. **Dead/duplicated enums**: `PlanPhase` was exported-but-unused and `seed.ts` re-declared `Phase`/`WhenMode`/`Part` - fixed by importing the shared types in `seed.ts` (restores Zod-first single-source-of-truth; gives `PlanPhase` a consumer).
5. **1s countdown ticker** (`EventDetail`): gated on `phase === "moment"` so it stops on terminal phases (mirrors the poll guard).
6. **Conditional responder copy** (`EventDetail`): a committed conditional showed "Awaiting your answer"; now shows "You're in if your people are".
7. **Reaction clobber** (`EventDetail`): reseed once per `eventId` (a `seededFor` ref) instead of once per focus, so refocus doesn't discard unsaved candidate taps.
8. **`CreateEvent` local unions**: import shared `WhenMode`/`Timescale`/`PartOfDay` instead of hand-rolling them.

## Things learned / discovered
- **drizzle-kit generate** is interactive; additive-only schema changes generate non-interactively. Local DB reset (`docker compose down -v && pnpm db:up`) is the recovery if a baseline is reset.
- **Cross-branch DB hazard**: the local Postgres is a persistent docker volume (`drp_pgdata`, host port 5433). Running an old-code branch against a DB that a newer branch migrated causes seed FK violations (old `reseedDemo` doesn't clear the new `candidate_reactions`). Reset the volume when switching between schema-divergent branches.
- **tRPC client is vanilla** (`createTRPCClient`, imperative `.query()/.mutate()`), **no React Query** - so "polling" is a manual `setInterval`, not `refetchInterval`.
- **No transformer** on the tRPC server (plain JSON), so curl works directly: `GET /trpc/<proc>?input=<urlencoded JSON>` for queries, `POST /trpc/<proc>` with a JSON body for mutations; `x-user-id` header selects the dev user (DEV_AUTH_BYPASS=1).
- **Shared package uses vitest**; **api uses node:test** (`node --import tsx --test`). New shared tests must use vitest.
- **Push reality**: iOS Simulator cannot receive remote push; Expo Go dropped remote push in SDK 53+; real push needs a dev build (`expo-dev-client`) + device + Apple Developer account. `expo-notifications` is not currently a dependency.
- **Expo SDK pin**: stay on SDK 54 (CLAUDE.md) - the App Store Expo Go only runs the latest SDK it shipped with; higher pins get rejected.
- The original loose-availability model (the convergence ancestor) is archived under `archive/loose-availability/` - its `matching.ts`/`quorum.ts`/`time.ts` import types (`Activity`, `PartOfDay`) that no longer exist in shared, so it does not compile against current code; this revamp wrote fresh logic rather than un-archiving verbatim.

## Current state
- **`dev`** contains the merged M3 convergence work (PR #28, merge `f822900`). Current branch is `dev`; working tree shows `M CLAUDE.md`, `M README.md` (user edits, unrelated to the feature code).
- **Verified**: backend lifecycle (curl, all 3 modes), lint, typecheck (3 packages), shared 23/23, api 8/8, adversarial review (8 findings fixed).
- **Not verified this session**: the **mobile app rendering** (never run live - the user's `expo start --ios` boot crashed on the stale-DB seed FK before the new code was on `dev`); the **full `pnpm test`** including mobile jest-expo to completion.
- **Linear DRP-29** was created In Progress; it was **not** moved to Done with the PR reference this session.

## Conventions, commands & workflows
- `pnpm` only. Gates before any PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` (`pnpm format` auto-fixes biome). `pnpm db:up`/`db:down` (docker Postgres, host 5433). `pnpm dev:api` / `pnpm dev:mobile`; the user also has `pnpm dev` (concurrently api + `expo start --ios`) and `pnpm kill` (frees ports 3000/8081).
- Type chain: Zod schemas in `packages/shared` -> tRPC procedures -> mobile infers types. Never hand-write API types. `apps/api` is ESM (relative imports need `.js`). No em dashes anywhere.
- Branching: work on `dev`; massive features get a `feat/*` branch -> PR into `dev` (as done here). Never push to `main`; ship via PR `dev` -> `main`. CI runs on PRs into `main`; CD on push to `main`.
- Track all work in Linear (team DRP_02).
- Reseed local demo on boot via `SEED_ON_BOOT=reset` (default local).

## Known issues / caveats / risks
- **Mobile UI unrendered**: screens typecheck and match the API contract but were never run in Expo. Real-user A/B testing needs a live boot first.
- **Local DB volume may be dirty** from cross-branch testing. Recommended before running: `pnpm db:down` (or `docker compose down -v`) then `pnpm db:up`, then `pnpm dev:api` (which migrates + reseeds with the new seed).
- **Full test run unconfirmed**: mobile's jest-expo dummy test was not observed green this session (shared + api were).
- **Exact-plan "blind until the event"**: a far-future exact plan hides "who's in" until the event itself (no `+1d` cap anymore). This is deliberate but may surprise testers expecting early social proof - revisit in user testing.
- **No real push notifications** (polling only) - logged in `docs/tech-debt.md`; ties to the deferred dev-build migration.
- **Auth remains the dev `x-user-id` stub** (unchanged; existing tech debt). The new procedures rely on `requireMember` for scoping, not real auth.

## Next steps
1. **Run the app**: reset the local DB volume, `pnpm dev`, and click through all three when-modes on device/simulator to confirm rendering and the live polling/countdown.
2. **Confirm the full test suite** (`pnpm test`) is green including mobile.
3. **Close Linear DRP-29** as Done, referencing PR #28 / merge `f822900`.
4. **A/B test** the new convergence model (version B on this `dev` line) against the shipped M2 concrete-RSVP model (version A) with real users, per the M3 plan; interview on how each feels.
5. Consider whether exact plans should reveal earlier (social proof) vs stay blind to the event.
6. (Later) dev-build migration to unlock real push notifications + an SDK bump.

## References
- Plan/design: `/Users/gong/.claude/plans/ultrathink-we-want-to-rippling-prism.md` (outside repo); Linear **DRP-29**.
- User research: `docs/drp-context/interviews/*.txt`, `docs/drp-context/Friend Meetup Dynamics Survey (Responses) - Form Responses 1.csv`, `docs/mockups/m2/`.
- Shared: `packages/shared/src/schemas.ts`, `packages/shared/src/logic/{candidates,window,resolve,reveal}.ts`.
- API: `apps/api/src/routers/events.ts`, `apps/api/src/db/{schema,seed}.ts`, `apps/api/src/db/migrations/0002_windy_bruce_banner.sql`.
- Mobile: `apps/mobile/src/screens/{CreateEvent,EventDetail,Dashboard}.tsx`, `apps/mobile/src/ui/StatusCheck.tsx`, `apps/mobile/src/lib/format.ts`.
- Tech debt: `docs/tech-debt.md` ("Real-time is polling; no real push notifications").
- PR: #28 `feat: iteration 1 of flexible scheduling` (merge `f822900`); feature commit `1f70fb1`.
- Archived ancestor model: `archive/loose-availability/`.
