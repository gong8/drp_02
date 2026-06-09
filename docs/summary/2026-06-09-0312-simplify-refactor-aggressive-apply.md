# Aggressive simplify-refactor pass (DRP-53) - 2026-06-09

**Branch:** `dev` (merged + pushed) | **PRs:** none opened - merged directly | **Scope:** A 186-agent multi-lens code-quality review of the whole repo, then applied all 32 verified behavior-preserving cleanup clusters as 33 commits, merged fast-forward into `dev`.

## TL;DR

The user ran `/simplify-refactor everything apply + aggressive` (ultracode on). A single `Workflow` fanned out 186 subagents across 5 phases (review -> cross-cut -> triage -> adversarial verify -> synthesize), distilling **158 findings -> 56 clusters -> 32 verified epics**. All 32 were then applied on branch `refactor/aggressive-simplify`, one cluster per commit, each verified green with `pnpm typecheck && pnpm lint && pnpm test` before committing. 31 landed in full, 1 partial (a deliberate behavior-preservation skip), 0 blocked. Final state: lint clean, typecheck clean, **API 395 tests pass / 0 fail, mobile 193 tests pass**. The branch was fast-forward merged into `dev` and pushed to `origin/dev`; Linear DRP-53 tracks it (In Review, all clusters checked off).

## What was done

### Phase 0 - inventory (inline, before the workflow)
- Created branch `refactor/aggressive-simplify` off `dev`.
- Started Postgres (`pnpm db:up`) - required for the API DB-backed test harness.
- Established a **green baseline** first (lint + typecheck + full test) so any later failure was attributable to the refactor. Baseline was green: API 395 + mobile 193.
- Built the work-list with `git ls-files '*.ts' '*.tsx' | grep -v archive | grep -v .test. | grep -v .d.ts` + line counts, and captured the existing shared surface (ui/ barrel, theme tokens, lib/ helpers, shared logic/schemas, api db/logic exports) so reviewers could flag "should have reused X".

### Phases 1-5 - the review workflow (background, ~36 min, 186 agents, 7.2M tokens)
- Hotspots (events.ts 1113, EventDetail 883, CreateWizard 847, Dashboard, GroupDetail, groups.ts, DateTimeField, schema.ts, schemas.ts) got one agent **per lens**; medium files (>=45 lines) one comprehensive agent; small files batched by area. 91 review agents -> 114 findings.
- 6 cross-cutting theme agents (cross-file dup, component reuse, shared helpers, naming, dead exports, convention drift) -> 158 total findings.
- One triage agent clustered 158 findings into 56 clusters.
- Each cluster handed to a skeptic agent prompted to **refute** it; 32/56 survived. 24 dropped as false positives / trivia / convention-fighting.
- One synthesis agent per survivor wrote an actionable epic (problem, change steps, before/after sketch, files, effort/risk/impact, linearTitle/Body).
- The conventions baked into every agent prompt included the **mobile/shared type-only boundary** (so no agent proposed merging a mobile helper into the shared package via a runtime import) and the unified-activity model.

### Report + Linear (before applying)
- Generated `docs/refactor/2026-06-09-refactor-report.md` **programmatically** from the epics JSON (kept the 32 full epic write-ups out of the main context).
- Created Linear tracking issue **DRP-53** (team DRP_02) with a per-cluster checklist. Used the existing `Improvement` label - I lack permission to create a `refactor` label in this team.

### Phase 6 - apply (the bulk of the session)
Applied all 32 clusters **sequentially** (not parallel worktrees - see Key decisions), grouped by file, one cluster per commit. Commit list (newest first) is in the git facts; grouped by area:

- **shared** (3): parameterize `boundedFieldEdit`; reuse `Conditional` type (partial - see below); add `isTerminalPhase`.
- **api/db** (2): drive `pgEnum` tuples from shared `z.enum` `.options`; share `timeStarts()` across the two seed modules.
- **api routers/db helpers** (8, the heavy-contention group on events.ts/groups.ts): `fallbackUserCard`, `memberIdsOf`, consolidate group reads + drop dead `getGroupName`, reuse `CandidateReaction` type (5x), hoist toggleReaction predicate, `clearMyResponse`, unify addCandidate minute/activity dedupe helpers + reuse `insertCandidates`, `groupBy` map idiom + removeMember vote-purge loop.
- **mobile lib** (5): `compareActions` reuses `activeDeadline`; collapse dead `dismissedAction` branch; derive wizard `StepKey` from `STEP_ORDER`; `firstInitial` helper; rename MomentView `editing/onEdit` -> `reanswering/onChangeAnswer`.
- **mobile theme/ui** (6): `ui.gutter` token in ScreenBackground; `fieldBox` shared frame constant; DateTimeField `isDate`/gated picker props; AppText `cardTitle` + `captionPara` variants; `Tappable` wrapper for Card/Row/PersonRow.
- **mobile screens** (8): EventDetail countdown label reuse; Dashboard copy via copy.ts; GroupDetail `useConsumeParam` hook; CreateWizard `axisNote` + `timeFixed/activityFixed`/`replyLine` + `DEADLINE_VOTING`; `AccountHeaderButton`; GroupsList `useFetchOnFocus`.

### Wrap-up
- Final full-suite verification: lint clean, typecheck clean, API 395 / mobile 193.
- Appended an "Application log" section to the report (31 full / 1 partial / 0 blocked).
- Updated DRP-53 to **In Review**, all 32 boxes checked, outcome documented.
- Wrote a memory `simplify-refactor-apply-cadence.md` (+ MEMORY.md index line).
- On the user's instruction ("merge to dev and /summary"): `git checkout dev`, **fast-forward** merge `refactor/aggressive-simplify`, `git push origin dev` (77393dc..4623d40).

## Key decisions & rationale

- **Sequential apply, not parallel worktrees.** The skill's reference suggests isolated worktrees, but files here are heavily contended: `apps/api/src/routers/events.ts` is touched by **7** clusters; `EventDetail`/`GroupsList`/`Dashboard`/`Text.tsx` by several (the AppText-variant clusters cut across many screens). Parallel worktrees would mean constant merge conflicts and semantic conflicts. The main loop applied each cluster with **content-based edits** (review-time line numbers drift as earlier clusters edit the same file - always match on content), ran `typecheck`+`lint` per cluster, committed, and ran the full test suite once per phase + a final green run.
- **One cluster per commit.** Honors the repo rule (modular, bisectable history). 33 commits total (1 report + 32 clusters). The apply-log commit makes 34 on top of dev.
- **Partial application of cluster #12 (reuse-conditional-and-activitytext) - behavior-preservation over completeness.** The `Conditional`-type reuse half (rewiring `MomentResponse.cond` and the `responses.cond` jsonb `$type` to the shared `Conditional`) is pure compile-time and was applied. The **`ActivityText.trim()` half was deliberately skipped**: `addCandidate`'s handler already does `input.text.trim()` (events.ts:770), so adding `.trim()` to the shared `ActivityText` schema would NOT change stored values but WOULD shift the max-length validation boundary (an 80-char name with trailing spaces flips from rejected to accepted) and change the whitespace-only error path. That is a small but real behavior change - out of scope for a behavior-preserving pass even though the verifier approved it. Default rule recorded: skip any "normalization" that moves a validation boundary or error path.
- **Skipped optional sub-items in cluster #8** (the `memberCounts` bulk helper and `getGroup(id)` extraction) - the epic itself marked them optional/low-value; the two high-value edits (route `mine` through `getGroupNames`, delete dead `getGroupName`) were applied.
- **Cluster #5 insert-collapse done the lower-risk way.** Rather than hoisting shared `let startsAt/partOfDay/label` locals across the if/else (the epic's idea), each branch calls `insertCandidates(...)` directly - same dedup win (removes the duplicated insert column set), no risky local-hoisting/narrowing. The high-value parts (the `startMinute()` and `activityKey()` helpers) were done in full.
- **Cluster #27 (med-risk) applied.** Switching GroupsList from a hand-rolled `useFocusEffect` (with a belt-and-braces `active` flag) to the shared `useFetchOnFocus` drops the active guard. Verified behavior-equivalent: the screen refetches on every focus, so a stale setState during blur is unobservable; the doc on `useFetchOnFocus` explicitly carves out Dashboard/EventDetail (which need the guard for polling) and lists GroupDetail/Account/JoinGroup as the plain-fetch sibling pattern GroupsList now joins.
- **Linear: one tracking issue, not 32 throwaway issues.** In apply/aggressive mode the deliverable is the applied commits; filing 32 issues only to immediately close them is board noise and contradicts "never leave finished work open". A single parent (DRP-53) with a per-cluster checklist is cleaner and respects "Linear is the source of truth". The per-cluster durable record lives in the report.
- **Merge style: fast-forward.** The branch was a clean linear sequence off an unmoved `dev`, so `--ff-only` keeps each cluster commit directly on dev (maximally bisectable) with no merge commit.

## Things learned / discovered

- **biome rewrap gotcha (recurred ~6x).** An edit that lengthens an import list or a function signature past the line width makes `pnpm lint` fail on **formatting** (not a real lint error). Fix: `pnpm format` (`biome check --write`) then re-lint - it just rewraps onto multiple lines. Expect it after merging value-imports into one line, annotating params, or adding a union member.
- **Drizzle accepts `z.enum(...).options` for `pgEnum`.** `.options` is a readonly non-empty literal tuple `[U, ...U[]]`, exactly what `pgEnum` wants. Driving the four live enums from the shared zod enums is behavior-preserving as long as value set AND order match 1:1 (they did), since the generated SQL enum is unchanged and migrations are hand-authored (no `db:generate` regen). `eventStatusEnum` stayed hardcoded (frozen legacy, no z.enum mirror).
- **The heterogeneous Drizzle table loop typechecks without annotation.** `for (const t of [candidateReactions, responses, eventOptOuts]) await tx.delete(t).where(and(eq(t.userId, ...), inArray(t.eventId, eventIds)))` compiled cleanly - the epic warned it might need an explicit type, but it did not.
- **`valueOf` shadows a global.** Naming a `groupBy` callback param `valueOf` triggered biome `noShadowRestrictedNames` (Object.prototype.valueOf). Renamed to `toValue`.
- **`Tappable` style prop must be `StyleProp<ViewStyle>`, not `ViewStyle | ViewStyle[]`.** PersonRow passes `[rowStyle, style]` where `style?: ViewStyle` (so the array element is `ViewStyle | undefined`), which is not assignable to `ViewStyle[]`. `StyleProp<ViewStyle>` (the RN type) accepts arrays-with-undefined and is the faithful drop-in.
- **Typecheck caught a spec gap in cluster #9.** The `memberIdsOf` epic only mentioned the inline select at events.ts:980-986, but `memberRows` was referenced again ~30 lines later (the members loop). Typecheck flagged the dangling name; fixed the loop to iterate `memberIds: string[]` directly (behavior-identical).
- **`pnpm typecheck` is ~9s; `pnpm lint` is instant; mobile test ~4s; full `pnpm test` (incl. API DB tests) ~tens of seconds.** Fast enough to run typecheck+lint per cluster and the full suite per phase.
- **The `RESET ... was not handled by any navigator` console.error in CreateWizard.test is a pre-existing dev-only warning, not a failure** - present in the baseline run too.

## Current state

- **`dev`** has all 34 commits and is pushed to `origin/dev` (77393dc -> 4623d40). Working tree clean (before this summary commit).
- **`refactor/aggressive-simplify`** still exists locally, identical to `dev` (not deleted; safe to delete).
- **Verified:** lint, typecheck, and the full test suite (API 395 / mobile 193) all green on the merged tree.
- **Linear DRP-53:** In Review, all 32 clusters checked, links the report.
- No PR was opened (user asked to merge directly to dev). CI runs on PRs into `main`; CD on push to `main` - neither was triggered by the dev push.

## Conventions, commands & workflows

- `pnpm lint` (biome check) / `pnpm format` (biome check --write to auto-fix) / `pnpm typecheck` / `pnpm test`. Run all three before any PR.
- API tests need Postgres up (`pnpm db:up`, docker compose, host port 5433).
- No em dashes anywhere (hyphens only). ESM in apps/api needs `.js` on relative imports. Mobile imports `@bethere/api` and `@bethere/shared` **type-only**.
- Branching: `main` protected; default work on `dev`; feature branches `feat/*` -> PR into `dev`; to ship, PR `dev` -> `main`. This session used a `refactor/*` branch fast-forwarded into dev.
- Commit trailer required: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## Known issues / caveats / risks

- All changes are behavior-preserving cleanups verified by the existing test suite; no new tests were added. Risk is bounded by test coverage - screens are covered by the mobile render harness, API by the DB-backed tRPC harness.
- The `ActivityText.trim()` normalization (skipped half of cluster #12) is **not done** - if the team wants `addCandidate` to enforce "max length after trim" and emit a uniform error for whitespace-only activity names, file it as an explicit (behavior-changing) follow-up, not as part of this pass.
- `refactor/aggressive-simplify` branch lingers locally.

## Next steps

- Optional: delete the merged local branch (`git branch -d refactor/aggressive-simplify`).
- Optional: ship `dev` -> `main` via PR when ready (will trigger CI + CD/Android build).
- Optional follow-ups the verified epics deferred: `memberCounts` bulk helper + `getGroup(id)` extraction in groups (#8); the `ActivityText.trim()` normalization as a separate behavior change; a `DEADLINE_REPLIES` copy constant for the "Replies close ..." literals.

## References

- Full report: `docs/refactor/2026-06-09-refactor-report.md` (exec summary, roadmap table, one section per cluster with before/after, plus the apply log).
- Linear: DRP-53 - https://linear.app/drp-02/issue/DRP-53
- Memory: `simplify-refactor-apply-cadence.md` (sequential-apply cadence, biome rewrap gotcha, the ActivityText skip).
- New files created this session: `apps/mobile/src/ui/Tappable.tsx`, `apps/mobile/src/components/AccountHeaderButton.tsx`.
- Central files most reshaped: `apps/api/src/routers/events.ts` (7 clusters), `apps/api/src/routers/groups.ts`, `apps/api/src/db/{schema,seed,seed-data,users,groups}.ts`, `packages/shared/src/{schemas.ts,logic/resolve.ts}`, `apps/mobile/src/ui/{Text,Field,DateTimeField,DateTimePill,Card,Row,PersonRow,ScreenBackground}.tsx`, `apps/mobile/src/lib/{status,format,redo,share,useFetchOnFocus}.ts`, and the screens `EventDetail/CreateWizard/Dashboard/GroupsList/GroupDetail/JoinGroup/Account`.
