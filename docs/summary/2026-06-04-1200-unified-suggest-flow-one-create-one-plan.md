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
