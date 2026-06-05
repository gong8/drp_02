# Sync top-level docs to the activity model + fix a stale test - 2026-06-04

**Branch:** `feat/redo-from-previous-meetup` | **PRs:** #39 (Redo + activity unification) is **CLOSED** (not merged) as of 2026-06-04T20:06:44Z - see Current state | **Scope:** Update `CLAUDE.md` and `README.md` (then `ARCHITECTURE.md` and one stale test) so the docs match the code after the DRP-42 activity unification and the DRP-42/43 redo + editable-meetup work.

## TL;DR
A short, accuracy-critical documentation session. The three top-level docs still described the old plan model (`title`, `lockThings`) even though DRP-42 renamed the plan's name to `activity` and the second lock flag to `lockActivity` end to end, and DRP-42/43 added two new capabilities (redo a past meetup, editable meetups). I ran a 5-agent verification workflow to ground-truth every doc claim against the live source (not the session summaries, which can drift), then surgically rewrote `CLAUDE.md`, `README.md`, and `ARCHITECTURE.md`, and fixed the one real straggler the workflow found: a shared test still asserting on a `title` field that Zod now silently strips (so its "oversize" case mis-passed). Everything is verified green (shared 39/39, lint clean on 101 files, shared typecheck clean) and committed in two logical commits (`cda4a05` test, `d019df0` docs). Nothing was pushed.

## What was done

### Trigger
User asked to "update CLAUDE.md and README.md" (with `/effort` set to **ultracode** and the keyword **ultrathink**). The repo had just finished the DRP-42 "redo a meetup + activity unification" work (commits `2f5f43a`..`a07159b`), and the docs lagged behind it.

### Verification workflow (ground-truth before editing)
Rather than transcribe from the recent session summaries (which are detailed but can drift from code), I launched a background `Workflow` named **`verify-docs-against-code`**: 5 parallel agents, each returning schema-structured findings (`area`, `verifiedFacts`, `staleDocClaims[{doc,currentText,correction}]`, `newToDocument`). Areas:
- **terminology** - grep the whole repo for `title`/`lockThings`/`activity`/`lockActivity`; confirm the rename fully landed; find stragglers.
- **api-surface** - enumerate `CreateEventInput`/`UpdateEventInput`/all `events.*` procedures from `packages/shared/src/schemas.ts` + `apps/api/src/routers/*`.
- **db-and-commands** - tables, migrations, `SEED_ON_BOOT`, `.env.example`, package scripts.
- **mobile-screens** - screen filenames, the redo `source` step, the edit sheet, fonts.
- **docs-audit** - read `CLAUDE.md`/`README.md` in full and list every stale claim.

Stats: ~245k subagent tokens, 89 tool uses, ~141s. (Script: `.../workflows/scripts/verify-docs-against-code-wf_c7c2b94c-73f.js`.) The findings were consistent across agents and matched a direct read of `apps/api/src/routers/create-plan.ts`.

### Edits to `CLAUDE.md` (commit `d019df0`, `## Project` section)
- `lockThings` -> **`lockActivity`** in the flag bullet.
- Concrete-shortcut sentence corrected to require **both axes pinned** (see decisions), not just one time + `lockTimes`.
- Lifecycle wording: "if the title is empty ... becomes the title" -> "the most-voted ACTIVITY candidate becomes the plan's **activity** (its name) if one is not already set".
- Added a dense paragraph: a plan's name **IS** its `activity` (no `title` field - "don't reintroduce a title"); plus the two new capabilities - `events.update` (any member, per-field compare-and-set, activity editable only post-lock) and `events.pastForGroup` redo.

### Edits to `README.md` (commit `d019df0`, `## How a plan works`)
- Dropped "optional title" from the create sentence; added "the activity that wins becomes the plan's name".
- `lockThings` -> **`lockActivity`**.
- "the most-voted activity becomes the title" -> "becomes the plan's name".
- Shortcut reworded to "a fully pinned plan - one time with `lockTimes`, and the activity locked too".
- New product-facing paragraph: "Plans are editable and repeatable" (editing + redo), keeping the `ARCHITECTURE.md` pointer at the end.

### Edits to `ARCHITECTURE.md` (commit `d019df0`)
- `lockThings` -> `lockActivity`; both "title" -> "activity" in the model summary and the lifecycle prose.
- Concrete-shortcut prose updated to both-axes-pinned.
- Component mermaid: UI node `CreateEvent` -> **`CreateWizard`** (the real filename).
- DB node + plain-text fallback: **7 -> 8 tables**, added `event_opt_outs`.
- Lifecycle sequence diagram: real `events.create` payload (`{ groupId, description?, location?, timeCandidates?, activityCandidates?, lockTimes, lockActivity, decidesBy?, replyBy?, quorum? }` - no `title`, no `lockThings`, name rides in `activityCandidates`); `alt 1 time candidate AND lockTimes` -> `alt both axes pinned (concrete shortcut)`; `addCandidate` gate `lockTimes/lockThings` -> `lockTimes/lockActivity`; lock step "if title empty ... -> title" -> "if activity empty ... -> activity".
- New prose paragraph after the lifecycle mermaid describing **Editing** (`events.update` CAS under `SELECT ... FOR UPDATE`) and **Redo** (`events.pastForGroup` shells, activity preloaded + `lockActivity`-pinned).
- Packages table: added `UpdateEventInput` + `FieldEdit` + `SetOptOutInput` to the shared-schema list; noted `events.update`/`events.pastForGroup` on the api row; `CreateEvent` -> `CreateWizard` in the mobile screen list.

### Test fix (commit `cda4a05`, `packages/shared/src/schemas.test.ts`)
The terminology agent flagged the **only** remaining `title` straggler in source: this test passed `title: { from, to }` to `UpdateEventInput.safeParse(...)`. The schema field is now `activity` (`UpdateEventInput = ByEvent.extend({ activity, location, description })`, envelope key `eventId`). Zod strips unknown keys by default, so:
- the success cases still passed (the `title` key was silently dropped), but
- **"rejects an oversize title `to` (> 80)"** mis-passed: with `title` stripped, the parse succeeded and `expect(success).toBe(false)` would have failed - except the DRP-42 verification never ran the shared `vitest` suite (its "green" check covered typecheck + api `node:test` + mobile jest only), so the broken assertion went unnoticed.

Fix: renamed `title` -> `activity` in all four cases and the two `it(...)` descriptions, so the length bound is actually exercised. Confirmed by running `pnpm --filter @bethere/shared test` -> 39/39.

## Key decisions & rationale

- **Verify against code, not summaries.** Even though the 2026-06-04 summaries are recent and detailed, docs that an agent will follow must match the source exactly (a stale field name in `CLAUDE.md` makes an agent write wrong code). Spending a 5-agent workflow to ground-truth was the right call under ultracode; it also surfaced the real test bug and the 7->8 table drift that the summaries did not mention.
- **Correct the concrete-shortcut rule, not just the vocabulary.** `apps/api/src/routers/create-plan.ts` `planOpensMoment(timeCount, lockTimes, activityCount, lockActivity)` returns `timePinned && activityPinned` where `timePinned = timeCount === 1 && lockTimes` and `activityPinned = activityCount <= 1 && lockActivity`. The old docs said only "exactly ONE time candidate AND lockTimes", which is now incomplete - the activity axis must also be pinned. I read the source directly (rather than trust the agent paraphrase) before rewording, because the zero-activity edge is subtle.
- **Respect scope, then offer the coupled fix.** The user asked for `CLAUDE.md` + `README.md`. I did exactly those, then surfaced that `ARCHITECTURE.md` (which both docs point to as "the full model") was stale in the same ways, plus the test straggler, and asked before touching them. User replied "yes update it all and make sure to commit." This kept me from silently expanding scope while still delivering a consistent doc set.
- **Two commits, not one.** Per `CLAUDE.md`'s "commit in modular chunks": the test fix is a behavior-relevant code change (a real, if latent, bug) and belongs apart from the docs-only sync, so history stays bisectable.
- **Commit, do not push.** The user said "commit"; the harness rule is push only when asked. Left unpushed on the feature branch.
- **What I deliberately did NOT change:** the historical migration SQL/snapshots (`title`/`lock_things` there are frozen, append-only history); the OS-notification `content.title` in `apps/mobile/src/lib/notifications.ts` and generic UI `title=` props (unrelated to the plan name); `settlePhase` naming in ARCHITECTURE (not verified against code this session, out of scope); the unused `@expo-google-fonts/space-mono` dependency (code cleanup, not docs).

## Things learned / discovered

- **The activity rename is fully landed in production source.** DB columns are `activity` (`text notNull`) and `lock_activity` (`schema.ts:61,74`); shared `CreateEventInput` has `lockActivity` (default false) and **no** `title`; `events.update` writes `set.activity` via CAS; mobile uses `activityRaw`/`lockActivity`. The lone straggler was the shared test (now fixed).
- **`events` table has no `updatedAt`** - only `createdAt`. This is exactly why DRP-43 editing uses per-field compare-and-set (the field value is the concurrency token) rather than an optimistic `rev`/timestamp.
- **8 Drizzle tables, not 7:** `users, groups, group_members, events, event_candidates, candidate_reactions, event_opt_outs, responses`. ARCHITECTURE.md said 7 (missing `event_opt_outs`, the `setOptOut` table). Now corrected.
- **Migrations live at `apps/api/src/db/migrations/`** (next to `index.ts`), not a top-level `drizzle/`. Latest is `0008_activity_rename.sql`, a pure `RENAME COLUMN title TO activity` + `lock_things TO lock_activity` (data-preserving). `migrate()` runs on boot (`apps/api/src/index.ts`); renames are hand-written because `drizzle-kit generate` is interactive and hangs on rename-vs-create.
- **The create screen file is `CreateWizard.tsx`, not `CreateEvent`.** There is no `CreateEvent.tsx`. ARCHITECTURE listed `CreateEvent` in two places (component diagram + packages table); both fixed. The 8-screen count was correct.
- **Three test runners:** shared = `vitest`, api = `node --test` via `tsx`, mobile = `jest` (jest-expo). Aggregate `pnpm test` (`pnpm -r --if-present test`) can hang because mobile jest leaks a handle (see memory `pnpm-test-mobile-jest-hang`); run per package. This session's DRP-42 predecessor never ran the shared vitest suite, which is how the broken test slipped through.
- **`pnpm check` runs four steps**, not three: `lint && typecheck && test && quality` (`node scripts/quality-check.mjs`). README references `pnpm check`; CLAUDE only lists lint/typecheck/test.
- **Zod strips unknown keys by default**, which is precisely why the stale-`title` test mis-passed rather than erroring - a good reminder that `safeParse` success on a renamed field proves nothing about the field.
- **`displayActivity` returns `""`** (not a placeholder) when there is no activity and no candidates; the mobile client applies the `activity || groupName` fallback. `resolveActivity` keeps a non-empty activity and otherwise derives the plan name from the winning ACTIVITY candidate (`pickWinnerOrBestId`, quorum 1).
- **The session-start git snapshot is stale by design.** HEAD was reported as `a07159b`, but `449133e chore: update gitignore` already sat on top before my commits; `git merge-base --is-ancestor a07159b HEAD` confirmed a clean linear history, so my two commits are correctly based.

## Current state

- **Branch `feat/redo-from-previous-meetup`**, working tree clean. Two new commits on top of `449133e`:
  - `cda4a05` test(shared): fix stale title->activity in UpdateEventInput test (DRP-42)
  - `d019df0` docs: sync CLAUDE/README/ARCHITECTURE with activity model + redo + editing (DRP-42/43)
- **NOT pushed.** 
- **PR #39 is CLOSED (not merged)** per the gathered facts (closed 2026-06-04T20:06:44Z). The previous session's summary expected #39 to be OPEN into `dev`; it has since been closed without merging. It is unclear from this session whether the DRP-42 work will be reopened, re-PR'd, or merged via another path - this needs confirmation before assuming the branch lands in `dev`.
- **Verified green this session:** `pnpm --filter @bethere/shared test` 39/39; `pnpm lint` clean (101 files); `pnpm --filter @bethere/shared typecheck` clean. Did not run api/mobile suites (no api/mobile source changed - the only code change was the shared test).
- **Doc grep checks pass:** no `lockThings`/`lock_things`/`CreateEvent`/`7 tables` strings remain in the three docs or the test; the only `title` left is the deliberate "there is no separate `title`, do not reintroduce a title" guidance in `CLAUDE.md`; no em dashes.

## Conventions, commands & workflows
- **One word for the plan name: `activity`.** No `title` field anywhere; the second lock flag is `lockActivity` (DB column `lock_activity`). Do not reintroduce a title.
- **Gates before a PR:** `pnpm lint` (auto-fix `pnpm format`), `pnpm typecheck`, and per-package tests. Avoid aggregate `pnpm test` (mobile jest hang); run `pnpm --filter @bethere/<pkg> test`. Note `pnpm check` also runs `pnpm quality`.
- **Migrations:** hand-write rename migrations + a `_journal.json` entry; never run interactive `drizzle-kit generate` for renames. Reset the local DB if you reset the baseline.
- **Branching:** work on `dev`/feature branches; PR into `dev` (never `main`). Commit in modular chunks. Push only when asked.
- **Docs as code:** `CLAUDE.md`, `README.md`, and `ARCHITECTURE.md` cross-reference each other; when the model changes, sync all three (this session is the precedent). Ground doc claims in the source, not in prior summaries.

## Known issues / caveats / risks
- **PR #39 closed, not merged** - the DRP-42 branch's path into `dev` is unresolved (see Current state). Confirm before relying on this work being shipped.
- **Unused dependency:** `apps/mobile/package.json` still lists `@expo-google-fonts/space-mono`, dead since SpaceMono was removed (DRP-43, `644b571`). Not removed this session (out of scope).
- **Mobile/api suites not run this session** - unnecessary (only the shared test changed), but stated for completeness.
- **`pastForGroup` freshness** (pre-existing): it does not settle a just-ended moment, so a very-recently-finished plan may lag into the redo list until something else settles it to `cleared`. Low impact.

## Next steps
1. **Decide how the DRP-42 branch lands in `dev`** given PR #39 is closed (reopen, new PR, or it was already folded in elsewhere). Then push these two doc/test commits along the chosen path.
2. Optional: drop the unused `@expo-google-fonts/space-mono` dependency.
3. Optional: when shipping `dev -> main`, this doc sync rides along.
4. Optional follow-up flagged by the workflow but not docs: stand up an api integration harness (tRPC `createCaller` + test DB) to actually exercise `events.update` CAS / the auto-lock activity-fill guard, which are currently typecheck-only.

## References
- **Edited this session:** `CLAUDE.md` (`## Project`), `README.md` (`## How a plan works`), `ARCHITECTURE.md` (model summary, both mermaids, Packages table), `packages/shared/src/schemas.test.ts`.
- **Source of truth read for the rewrite:** `packages/shared/src/schemas.ts` (`CreateEventInput`/`UpdateEventInput`/`FieldEdit`/`ByEvent`), `apps/api/src/routers/create-plan.ts` (`planOpensMoment`/`resolveActivity`/`displayActivity`), `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0008_activity_rename.sql`, `apps/mobile/src/lib/redo.ts`, `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/src/screens/EventDetail.tsx`.
- **Prior session summaries this builds on:** `docs/summary/2026-06-04-2106-redo-meetup-and-activity-unification.md` (DRP-42), `docs/summary/2026-06-04-1905-drp43-ux-fixes-and-cas-editing.md` (DRP-43).
- **Verification workflow script:** `.../9bc97651-.../workflows/scripts/verify-docs-against-code-wf_c7c2b94c-73f.js` (run id `wf_c7c2b94c-73f`).
- **Commits:** `cda4a05` (test), `d019df0` (docs). **PR:** #39 (CLOSED). **Linear:** DRP-42 / DRP-43.
