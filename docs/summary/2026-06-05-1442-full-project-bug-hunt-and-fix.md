# Full-project multi-agent bug hunt and fix - 2026-06-05

**Branch:** dev | **PRs:** none opened this session (work committed locally, not pushed) | **Scope:** Ran a whole-codebase code review via parallel agents, found 36 verified bugs, fixed all of them via file-owned parallel lanes, verified green, and committed in 13 modular chunks. Tracked as Linear DRP-48 (Done).

## TL;DR
The user invoked `/code-review` at "ultracode" effort but redirected it to review the **entire project** (not just the diff) and "hunt for bugs". A parallel Workflow (18 finder lanes + adversarial verification + a gap sweep) surfaced **36 verified findings** (30 CONFIRMED, 6 PLAUSIBLE; 35 bugs + 1 cleanup). The user then said "fix ALL OF THEM" with parallel agents. A second Workflow ran **13 file-owned fix lanes** (no two agents touch the same file, so no edit conflicts), each fixing every finding in its files plus regression tests. After folding in the user's own parallel edits (a confirm-screen anonymity note in `CreateWizard.tsx` + `copy.ts`), full verification passed (typecheck, biome lint, and the whole test suite: shared 136 pass / 1 skip, API 374 / 0 fail, mobile 186 pass). Everything was committed to `dev` in 13 modular commits (`02cc3cc..7ae2173`); nothing was pushed and no PR was opened.

## What was done

### 1. Whole-project bug hunt (read-only)
- Inventoried the source tree (excluding `archive/`, `node_modules`, build output). The bug-dense areas: `apps/api/src/routers/events.ts` (982 lines), `create-plan.ts`, `groups.ts`; the shared decision logic in `packages/shared/src/logic/*` (voting, lock, conditional-RSVP resolution); and the large mobile screens `EventDetail.tsx` (852), `CreateWizard.tsx` (675), `Dashboard.tsx`.
- Launched a background **Workflow** (`bethere-fullproject-bughunt`) with 18 independent finder lanes (by subsystem + cross-cutting lenses: datetime/timezone, etc.). Each finder returned up to 8 structured candidates. Every candidate was **adversarially verified** by a separate agent the moment its lane finished (pipeline, 3-state: CONFIRMED / PLAUSIBLE / REFUTED; recall mode - a single non-REFUTED vote keeps the finding). A final two-reviewer gap sweep saw the confirmed list and hunted only for misses.
- Result: 58 agents, ~2.9M subagent tokens; 38 candidates verified, **36 survived** (30 CONFIRMED, 6 PLAUSIBLE). Findings were reported to the user ranked, bugs first, each with a concrete failure scenario and the verifier's reasoning.

### 2. Parallel fix (13 file-owned lanes)
- Launched a second background **Workflow** (`bethere-bughunt-fixes`) with **13 lanes**, each owning a disjoint set of files (source + its test file) and fixing every finding in those files, with regression tests where practical. Hard rules baked into every agent prompt: own only your files; no em dashes (project rule); ESM `.js` import extensions in `apps/api`/`packages/shared`; do NOT run the test suite/typecheck/lint/migrations (the coordinator verifies afterward, to avoid concurrent DB-test races and tsbuildinfo contention); update tests that assert old buggy behavior.
- All 13 lanes returned `done` (0 partial, 0 blocked), 29 distinct fix-actions, 28 files changed.

The 13 lanes and their fixes:

| Lane | File(s) | Fix |
|---|---|---|
| A | `events.ts` (+ 6 `events-*.test.ts`) | Run `settleLifecycle(e)` on every write path (respond/unrespond/addCandidate/toggleReaction/setOptOut/lock) so the phase guard checks the post-settle phase; phase-guard the `lock`/`settleCollecting` UPDATEs with `.returning()`; make `toggleReaction` +1 idempotent (`onConflictDoNothing`) and atomic (wrap insert + opt-out delete in a txn); trim/dedupe activity candidates in `create`; reject past `startsAt` in `create`. |
| B | `groups.ts` (+ test) | Last-member guard on `removeMember`; cascade-delete the removed user's reactions/responses/opt-outs in the same txn; `addMember` validates the user exists (NOT_FOUND not 500). |
| C | `index.ts` | Defensive env parsing (`envInt` helper + trim-or-default) for `RATE_LIMIT_MAX`/`RATE_LIMIT_WINDOW`/`PORT`. |
| D | `schemas.ts` (+ test) | Shared `Instant` Zod refinement on `startsAt`/`decidesBy`/`replyBy`; `.trim().min(1)` on activity labels. |
| E | `db/schema.ts` | `responses` unique index on `(eventId,userId)` + FK on `userId`. (Migration authored by coordinator - see below.) |
| F | `lib/status.ts` (+ test) | Add `&& e.myStatus !== "declined"` to the moment branch of `isActionRequired`. |
| G | `EventDetail.tsx` (+ test) | Refresh the CAS edit baseline on conflict; `load()` when any field applied on a partial save. |
| H | `CreateWizard.tsx` (+ test) | Minute-dedupe `timeIsos`; gate `decidesInvalid` on `!isConcrete` + add the past-deadline lower bound; cap activity list at 10. |
| I | `GroupDetail.tsx` (+ `Groups.test.tsx`) | Reset `error` on success; seed `nameDraft` only on first load (preserve unsaved rename); only remove from addable picker on real success. |
| J | `ui/DateTimeField.tsx` (+ new clamp test) | Exported `clampDate`; clamp the date-mode seed/`temp` to `[minimumDate, maximumDate]`. Web variant left unchanged (no analogous default). |
| K | `lib/notifications.ts` | Re-arm the "Who's in?" moment-open ping in the moment branch (added `momentStartsAt`/`iResponded` to `ReminderEvent`). |
| L | `lib/auth.ts` (+ new test) | `useDisplayName`: use `||` with `.trim()` so an empty `firstName` falls through to username/fallback. |
| M | `admin/reset-auth.ts` (+ test) | Compare reset token by byte length (`Buffer.from`) not UTF-16 code-unit length, to avoid `timingSafeEqual` RangeError -> 500. |

### 3. Coordinator-side integration work
- **Migration (lane E follow-up):** `drizzle-kit generate` is interactive in this repo and prompted about an unrelated `candidate_kind` enum baseline drift, so I hand-authored `apps/api/src/db/migrations/0009_responses_constraints.sql` (CREATE UNIQUE INDEX + ADD FK matching drizzle's exact statement style) and appended an entry to `meta/_journal.json`. This matches the team's existing convention (migrations `0005`+ are hand-named/hand-written).
- **Cross-lane test fix:** lane D's new `Instant` validation made `events-create.test.ts`'s "an invalid time candidate is never persisted alongside valid ones" fail - that test asserted the OLD silent-drop behavior that D1 deliberately replaced with boundary rejection. Rewrote it to assert `BAD_REQUEST` (matching the sibling NaN tests). This was the only test that needed inverting.
- **Formatting:** `pnpm format` (biome --write) fixed 8 line-width wraps in changed files (and a whitespace-only normalization of `Dashboard.tsx`, which the user later reverted).
- **DB:** ran `pnpm db:up` so the DB-backed API tests could run.

### 4. User's parallel edits (kept, not reverted)
While I was verifying, the user edited `CreateWizard.tsx` and `copy.ts` in parallel to add a confirm-screen ("Ready to send?") anonymity note (`ANON_SEND_TITLE`/`ANON_SEND_BODY`). I initially mistook this for fix-lane scope creep and began reverting it; the user interrupted with "do not revert anything i did". I stopped immediately (both revert edits had already failed due to their concurrent modification, so nothing was actually reverted) and folded their changes into the final verification and the `5c1a15e` commit. Note the separately-listed `feat(mobile)` commits `ab76fcc` and `b622eb4` in the git log are the user's own related work, not from this session's agents.

### 5. Verification + commit + tracking
- Final verification (with the user's edits): `pnpm typecheck` clean (all 3 packages), `pnpm lint` clean (143 files), `pnpm test` exit 0 - shared 136 pass / 1 skip, API 374 pass / 0 fail, mobile 186 pass / 13 suites.
- Committed in **13 modular commits** on `dev` (`02cc3cc..7ae2173`), one logical fix per commit, each with a `Refs DRP-48` line and the required `Co-Authored-By` trailer.
- Linear **DRP-48** ("Fix 36 bugs from full-project code review") created, set In Progress at the start, and marked **Done** with a comment listing all 13 commit SHAs.

## Key decisions & rationale

- **Use Workflow (parallel agents), not solo, for both hunt and fix.** Session was in "ultracode" mode (explicit opt-in). The hunt is a fan-out/verify shape; the fix is a fan-out of independent tasks - both ideal for the Workflow tool.
- **Ownership-by-file lanes for the fixes (the central safety decision).** Many findings cluster in the same files (`events.ts` had 7, `CreateWizard.tsx` 4, `GroupDetail.tsx` 3). Letting parallel agents edit the same file would clobber each other. Assigning each file (and its test file) to exactly one agent makes the file sets disjoint, so concurrent edits in a single shared working tree are safe with **no git worktrees needed** (worktrees are expensive and would fragment the change set). This mirrors the existing `[[large-refactor-execution-pattern]]` memory.
- **Verification by the coordinator, serially, after the fan-out - not inside the fix agents.** API tests are DB-backed and share one Postgres; parallel `pnpm test` runs would race on data, and concurrent `tsc`/biome would contend on build artifacts. So fix agents only edited + wrote tests; the coordinator ran the single authoritative verification pass.
- **Hand-author the migration instead of `drizzle-kit generate`.** Generate is interactive here (prompts on a pre-existing `candidate_kind` enum baseline drift) and would hang/produce noise. The team already hand-writes migrations from `0005` onward. `migrate()` (used at boot and in the test harness) only reads the journal + `.sql` files, so the `meta/*_snapshot.json` (used only by the broken `generate`) is not needed for the migration to apply.
- **Rewrite, not delete, the one failing test.** `events-create.test.ts`'s silent-drop assertion encoded the exact bug D1 fixed; the correct new contract is boundary rejection (`BAD_REQUEST`), consistent with the sibling NaN tests.
- **Strip nothing the user authored.** When the user claimed the `copy.ts`/`CreateWizard` anonymity note, I stopped reverting and folded it in. Their authorship overrides my "keep the batch faithful to the findings" instinct.
- **Commit modular chunks on `dev`, do not push.** The repo's CLAUDE.md explicitly mandates modular commits ("one logical change per commit ... bisectable") and working directly on `dev`. Pushing / opening a PR is outward-facing and was left for the user to authorize. Commits were ordered shared -> db -> api -> mobile so the shared `Instant` schema (which the api create test depends on) lands before that test.
- **One Linear umbrella issue (DRP-48), not 36.** Honors the repo's "track all work in Linear" rule without spamming 36 tickets the user did not ask for.

## Things learned / discovered

- **`drizzle-kit generate` is unusable here** - it prompts ("Is candidate_kind enum created or renamed...") on a baseline drift unrelated to any new change, and hangs in non-TTY. Confirmed the team's workaround by the migration filenames (`0005_unify_suggest_additive.sql` ... `0008_activity_rename.sql` are hand-named). Saved as memory `[[drizzle-migrations-hand-authored]]`.
- **Root-cause clusters** (one fix kills several findings):
  - *Lazy-settle gap:* `loadEvent` never settled, so all write paths gated on the stale stored phase (settlement is lazy, no scheduler). The High "late RSVP" bug and several Medium write-after-deadline bugs share this root.
  - *`??`-vs-empty-string:* `process.env.X ?? default` keeps an empty string (only null/undefined trigger the default), so `RATE_LIMIT_MAX=""` -> `Number("")===0` -> every request 429s; `RATE_LIMIT_WINDOW=""` -> per-request 500; `PORT=""` -> random port. One trap, three sites.
  - *`create` vs `addCandidate` divergence:* `create` skipped the trim/dedupe/future-time validation `addCandidate` enforces, so the open API accepted inputs the UI never sends.
- **Workflow script validator rejects literal `Date.now(` / `new Date(` / `Math.random(` in the script source - even inside agent-prompt strings.** First fix-workflow launch failed on this; reworded the prompts to prose (e.g. "epoch ms <= current epoch ms") and it launched.
- **The `??`-vs-empty-string finding generalized** beyond rate-limit to `PORT` during the hunt's sweep - a good example of the gap-sweep catching a same-class miss.
- **Verifier nuance preserved:** several "PLAUSIBLE" findings had real mechanisms but timing/env/Clerk-config-dependent triggers (e.g. duplicate `responses` rows only matter if two concurrent `respond` calls interleave; empty-string `firstName` requires Clerk to emit `""` not `null`). They were still fixed because the user asked for all.
- **Biome wrapped a few changed lines past 100 cols;** `pnpm format` is the sanctioned auto-fix (`pnpm lint` is check-only).

## Current state

- **Branch `dev`**, working tree clean. 13 new fix commits on top of the user's `ab76fcc`/`b622eb4` feature commits.
- **Verified:** typecheck, lint, full test suite all green as of the final committed state (with the user's parallel edits included).
- **Not done:** nothing pushed; no PR `dev -> main` opened; CI (which runs on PRs into `main`) has not run on these commits.
- **Linear DRP-48:** Done, with the commit list in a comment.
- **Local Postgres** is up (`pnpm db:up`) from this session.
- New files added this session: `apps/api/src/db/migrations/0009_responses_constraints.sql`, `apps/mobile/src/lib/auth.test.ts`, `apps/mobile/src/ui/DateTimeField.clamp.test.ts` (+ the summary file this commit adds).

## Conventions, commands & workflows

- **Verify before claiming done:** `pnpm typecheck && pnpm lint && pnpm test` (API tests need `pnpm db:up`). `pnpm format` to auto-fix biome.
- **Migrations are hand-authored:** edit `schema.ts`, hand-write `apps/api/src/db/migrations/NNNN_name.sql` in drizzle's statement style (`--> statement-breakpoint` separators), append an entry to `meta/_journal.json`. Do not rely on `db:generate`.
- **No em dashes** anywhere; use hyphens.
- **Commit in modular chunks on `dev`** (one logical change per commit); `main` is protected - ship via PR `dev -> main` only. Don't push without being asked.
- **Parallel multi-file edits:** use ownership-by-file lanes (one agent per file + its test); verify serially afterward (DB tests can't run concurrently).

## Known issues / caveats / risks

- **Not pushed / no CI run.** These fixes have only been validated locally; CI on a `dev -> main` PR has not exercised them.
- **The `responses` unique constraint + FK migration (0009) has only been applied to local/test DBs.** On a live DB with pre-existing duplicate `(event_id,user_id)` responses, the `CREATE UNIQUE INDEX` would fail. The lane verified seed/respond data has no dupes, but a production apply should be checked. `SEED_ON_BOOT` behavior: `reset` local / `if-empty` live.
- **PLAUSIBLE fixes are defensive** against timing/config triggers that are hard to reproduce in tests; their regression tests assert the guard, not the race.
- **`auth.test.ts` is the first `renderHook`-based mobile test;** it passed in this run, but if a future jest-expo/renderHook environment quirk surfaces, the `auth.ts` source fix stands alone and the test can be trimmed.
- **Benign noise:** the mobile suite prints `RESET ... not handled by any navigator` console warnings from a pre-existing submit test; tests still pass.

## Next steps

1. Decide whether to **push `dev`** and open a **PR `dev -> main`** to run CI and ship (the natural next action; awaiting user authorization).
2. Before a production deploy, confirm no duplicate `(event_id,user_id)` rows exist in the live `responses` table so migration `0009` applies cleanly.
3. Optionally split the user's confirm-screen anonymity note out of the `5c1a15e` fix commit if a cleaner history is wanted (currently it rides along).
4. Consider follow-up hardening the verifiers flagged but were out of scope: a global tRPC error handler mapping pg constraint violations (23505/23503) to clean codes.

## References

- **Linear:** DRP-48 - https://linear.app/drp-02/issue/DRP-48 (Done; comment has the 13 commit SHAs).
- **Commits this session:** `02cc3cc..7ae2173` on `dev` (6 backend: shared schemas, responses migration, events lifecycle, groups, env parsing, reset-auth; 7 mobile: status, EventDetail CAS, CreateWizard, GroupDetail, DateTimeField, notifications, auth).
- **Migration:** `apps/api/src/db/migrations/0009_responses_constraints.sql` + `meta/_journal.json` (idx 9).
- **Key source files touched:** `apps/api/src/routers/events.ts`, `groups.ts`, `index.ts`, `admin/reset-auth.ts`, `db/schema.ts`; `packages/shared/src/schemas.ts`; `apps/mobile/src/lib/{status,notifications,auth}.ts`, `screens/{EventDetail,CreateWizard,GroupDetail}.tsx`, `ui/DateTimeField.tsx`.
- **Project docs:** `ARCHITECTURE.md`, `CONTRIBUTING.md`, `docs/tech-debt.md`, `CLAUDE.md`.
- **Related memories:** `[[drizzle-migrations-hand-authored]]`, `[[large-refactor-execution-pattern]]`, `[[testing-setup]]`, `[[mobile-ui-vocabulary]]`, `[[unified-suggest-flow]]`, `[[no-em-dashes]]`, `[[workflow-args-gotcha]]`.
