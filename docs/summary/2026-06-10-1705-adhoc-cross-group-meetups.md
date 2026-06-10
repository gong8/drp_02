# Ad-hoc & cross-group meetups (freely-composed live roster) - 2026-06-10

**Branch:** `dev` (feature built on `feat/adhoc-cross-group-meetups`, merged `--no-ff` via `70ceb2f`, pushed -> dev stack redeploying) | **PRs:** none (merged locally to dev per the user's choice; `gh` was unavailable) | **Linear:** DRP-62 (Done) | **Scope:** Decide the next product iteration from the M4 Luca interview, then design, plan, and ship it end-to-end: a meetup's roster decouples from a single group.

## TL;DR
The session began as a product-strategy question ("we implemented some of the Luca M4 interview; for the next iteration we were thinking +1 - what should we do?"). A grounded analysis (multi-agent workflow over interviews + codebase + M4 rubric) concluded **+1 is already done well and the rubric penalises feature volume**, but the user overrode the grading-first framing and chose to solve the real validated user problem instead: **inviting friends-of-friends to one meetup without adding them to the group, and running a meetup across more than one friend group.** We brainstormed the model (freely-composed, live-union roster), wrote a spec and a TDD plan, and executed it with **subagent-driven development** (8 tasks, fresh subagent + two-stage review per task, plus a final whole-branch review). The feature shipped to `dev` with `pnpm check` green; a final integration review caught and fixed a real gap (`events.update` was still gated on origin-group membership). The only remaining step is the human demo dry-run on `bethere-dev.vercel.app`.

## What was done

### 1. Strategy analysis (what to build next)
- Read `docs/drp-context/interviews/m4 interviews/luca interview.md` (truncated to first 30 min) and triangulated against the earlier interview rounds (`initial interviews/`, `m3 interviews (iteration)/`).
- Ran a **background Workflow** (`bethere-next-iteration-strategy`): 6 parallel readers (interviews, groups/invite code, +1/RSVP code, notifications, M4 grading rubric, the DRP-56 meetup-link funnel) -> a 3-lens strategy panel -> an adversarial critic. Key findings:
  - The **+1 / vote / conditional-RSVP engine is the best-tested, most-validated part of the codebase**; the M4 rubric grades "favouring volume of features over refinement" DOWN, and the only empty rubric row is **quantitative evaluation** (SUS / task-success / telemetry, all `[TEAM TO FILL]`).
  - The interview frontier moved to **adoption**: web-first link onboarding (shipped in DRP-56) and the ad-hoc/cross-group invite gap.
  - The critic corrected several roadmap claims (the "dropdown of everyone" was already gone from the UI; email-to-web-users is a 5-part dependency chain, not an M; request-to-join consent is mostly already solved by the opt-in link).
- Recommendation given: evaluation-first, with only thin re-testable slices. **The user redirected**: they want to address the user problem (one-off + cross-group invites), not optimise grading. This decision drove the rest of the session.

### 2. Brainstorming the model (superpowers:brainstorming)
- Established the problem precisely: today `events.groupId` is a single FK and **everything that needs "who is in this meetup" derives from that one group's members**; the vote tables (`candidateReactions`/`responses`/`eventOptOuts`) are already `(eventId,userId)`-keyed and group-agnostic.
- Clarifying questions (one at a time) settled:
  - **Model B (freely-composed audience)**, not "home group + extras". No required home group; a group is a bulk-add convenience.
  - **Individuals added by LINK ONLY** (no people directory - honours the rejected "dropdown of everyone"); reuses the DRP-56 share link.
  - **New idea from the user:** "form a group from an event that already happened" - the mirror of the existing "redo a past meetup" flow.
  - **Live group membership is a hard requirement:** "if new members join a group that is part of a meetup, the roster must update." This forced **live group references**, not snapshots.
- Discovered prior context: the DRP-56 session (`docs/summary/2026-06-10-1332-meetup-link-conversion-funnel-and-og-cards.md`) already recognised web-onboarding and ephemeral guests as the **same primitive** and **deferred the `event_participants` model to "the next iteration"** (this one), with locked owner answers: Google sign-in, stay-ephemeral, names-shown.

### 3. Spec (committed `df3022a`)
- `docs/superpowers/specs/2026-06-10-adhoc-cross-group-meetups-design.md`.
- Final model: **roster(event) = live members(origin group) ∪ live members(every attached group) ∪ ad-hoc participants**, recomputed on read.
- **Additive data model, no backfill:** keep `events.groupId` as the origin; add `event_groups(eventId, groupId)` and `event_participants(eventId, userId)`. Empty tables => byte-for-byte today's behavior.
- One new abstraction (`rosterUserIds`) behind the event read paths; vote engine untouched; `joinByToken` flips to inserting a participant. New flows: `events.addGroup`, `groups.createFromEvent`.
- Friday-demo cut lines: fully groupless meetups, "people you've met" picker, per-group name-hiding all **deferred**.

### 4. Plan (committed `a3e5d90`, superpowers:writing-plans)
- `docs/superpowers/plans/2026-06-10-adhoc-cross-group-meetups.md`: 8 bite-sized TDD tasks with exact file paths, code, and commands, grounded in the real code (verified `memberIdsOf`/`requireMember`, `events.mine`, `joinByToken`, the migration journal style, the mobile imperative tRPC proxy, and the DB-backed test harness before writing).

### 5. Implementation (subagent-driven, commits `1fd0ee6`..`82acb74`)
Each task: fresh implementer subagent (sonnet) -> spec review -> code-quality review -> fix loop. Mobile task and final review used the most capable model.

| Task | Commit(s) | What |
|---|---|---|
| 1 | `1fd0ee6` | `event_groups` + `event_participants` Drizzle tables + hand-authored migration `0011` + journal entry |
| 2 | `c74e55b`, `1e4dab5` | `rosterUserIds`/`isInRoster` in `db/groups.ts`; `requireInRoster` in `events.ts`; wired into `events.get` (single read, gate-before-settle) + the `loadEvent` mutation gate. Fix commit collapsed a 6-queries-to-3 amplification flagged by review. |
| 3 | `69b1758` | `events.mine` returns plans where the caller is in the roster (origin OR attached group OR participant), via a JS-collected id union |
| 4 | `97e5091` | `joinByToken` inserts an `event_participants` row (not `group_members`); updated the existing `events-share.test.ts` assertion to participant semantics |
| 5 | `ade6843` | `events.addGroup` (+ `AddGroupInput` in shared) - attach a group you belong to; idempotent; origin no-op |
| 6 | `2039b66` | `groups.createFromEvent` (+ `CreateGroupFromEventInput`) - crystallize a meetup's roster into a new group |
| 7 | `f11c9cd`, `b4fc40d` | Mobile `AddGroupSheet` + `MakeGroupSheet` wired into `EventDetail`; polish (refresh list on open, nav-ready guard, copy) |
| Final fix | `82acb74` | `events.update` re-gated on the roster (see Key decisions) + tech-debt note |

### 6. Final review, merge, and Linear (merge `70ceb2f`)
- A final whole-branch integration review (opus) over `a3e5d90..b4fc40d` caught a missed roster path; fixed it; re-ran the full gate.
- `pnpm check` green (shared 131, full API suite `fail 0`, mobile 209, quality clean). Merged `--no-ff` to `dev`, verified the merged tree is byte-identical to the gate-tested tip (`git diff dev feat/... ` empty), pushed `origin dev` (deploys the dev stack), deleted the local feature branch.
- DRP-62 moved to **Done** with a completion comment.

## Key decisions & rationale

- **Solve the user problem over grade-optimising.** The strategy analysis recommended evaluation-first (the rubric rewards a closed HCD loop + quantitative data, not features). The user explicitly redirected to the ad-hoc/cross-group invite problem. User instruction wins; we built the feature.
- **Model B (freely-composed), not "home group + extras".** The user picked B because it honestly models "two friend groups, no host" and the friend-of-a-friend plus-one. It is a deeper change, but the only model that cleanly keeps guests out of groups in all cases.
- **Live union roster, NOT snapshots.** The user required that a new member of an attached group flow into the meetup automatically. Snapshotting at attach time cannot do that, so groups are attached **by reference** and the roster is recomputed at read.
- **Additive tables, keep `events.groupId` as "origin".** Chosen over making `groupId` nullable / a pure participant table because it needs **zero data backfill** and existing single-group meetups behave identically (empty join tables). The trade-off: "fully groupless meetup" is deferred (would need nullable groupId + migration). For a 2-day demo, additive was the safe call.
- **Rejected the "ephemeral hidden group" implementation.** It would reuse the entire group-keyed pipeline, but it has a fatal seam: a link-joined guest on a meetup anchored to a *real* group would join that real group (today's force-join bug), unless every meetup spawned a throwaway group (proliferation + breaks dashboards). It was effectively the participant model implemented by abusing the groups table.
- **Individuals by link only (no people directory).** Honours the user's and Luca's explicit rejection of "the dropdown of everyone in the app"; reuses the DRP-56 link rails wholesale.
- **One `rosterUserIds` abstraction behind every read path.** Keeps the change surgical: only "who is the roster" changes; the vote engine (already `(eventId,userId)`-keyed) does not move.
- **`events.get` gates before `settleLifecycle`.** A non-roster caller must not be able to trigger a settle write. The optimised path computes the roster once, throws FORBIDDEN if the caller is absent, then settles.
- **`--no-ff` merge to `dev`.** Matches the DRP-56 precedent (`6d2c99d`) and keeps a clear feature boundary in history. Pushing `dev` is the intended deploy mechanism for the dev stack the team demos on.

## Things learned / discovered

- **The final whole-branch review caught a real gap the per-task reviews and the plan all missed:** `events.update` has its **own preamble** and does NOT route through `loadEvent`, so it was still calling `requireMember(e.groupId, ...)`. Under model B a roster member who is NOT in the origin group (a participant or attached-group member) could read/vote/RSVP but got `FORBIDDEN` on edit - while the mobile Edit button is shown to the whole roster (gated only on phase). Fixed by swapping to `requireInRoster(e.id, e.groupId, ctx.userId)` (`events.ts:805`) + a regression test. **Lesson: enumerate ALL member-gated procedures, not just the ones behind the shared `loadEvent` helper.**
- **The plan's TDD tasks omitted a lint/format step**, so the first implementer (Task 2) committed single-line `insertEvent({...})` calls that biome reformats - a CI-blocking miss caught by code-quality review. Remedy: every subsequent implementer dispatch included `pnpm format` + `pnpm lint` (root) before commit. There is **no per-package lint script**; linting is the root `pnpm lint`/`pnpm format` (biome), and **biome excludes `**/migrations`** (so the `_journal.json` trailing-newline is a non-issue).
- **`resetTables` in the test harness uses `TRUNCATE ... RESTART IDENTITY CASCADE`**, so adding FK-referencing tables (`event_groups`/`event_participants`) needs no harness change - CASCADE clears them when `events`/`groups`/`users` are truncated. Verified empirically.
- **`@bethere/shared` is consumed source-direct** (tsx resolves the TS source at runtime); adding a new Zod export is immediately visible to `apps/api` with no build step.
- **The mobile client is the imperative tRPC proxy** (`trpc.x.y.mutate(...)` / `.query(...)`), not React Query. `EventDetail` reloads via a `load` `useCallback`; cross-stack navigation (Meetups -> Groups/GroupDetail) requires the root `navigationRef` from `App.tsx` (guard with `navigationRef.isReady()`), since `navigation.navigate` is stack-local.
- **Real `ui/` component API differs from intuition:** `Text` is exported as `AppText` with variants like `caption`/`rowLabel` (no `muted`); `Button` variants are `primary | affirmative | outline | ghost` (no `secondary`); `FormError` takes `children`, not `message`; `Field` requires a `label`; sheet titles use `<Section title size sub>`. Implementers must read `apps/mobile/src/ui/index.ts` and adapt - the plan's template code was explicitly labelled "adapt to the real API".
- **Quorum is an absolute stored integer** (`events.quorum`), never derived from member count, so a larger composed roster does not silently change quorum/fizzle math. `settleCollecting`/`openMoment`/`resolveIn` read only candidates/reactions/responses - group-agnostic.
- **Workflow tool quirk reconfirmed:** the strategy workflow's `args` are not needed when data is baked into the script; the readers were given explicit file paths.

## Current state
- **`dev` is at `70ceb2f`** (merge) and pushed to `origin/dev` -> the dev stack (App Runner `bethere-api-dev` + Vercel web `bethere-dev.vercel.app`) is redeploying.
- All DRP-62 code is on `dev`. `pnpm check` was green on the exact merged tree. The local `feat/adhoc-cross-group-meetups` branch was deleted (merged).
- **Verified:** unit/integration tests (API DB-backed roster tests in `apps/api/src/routers/events-roster.test.ts` and `groups-createFromEvent.test.ts`; full suite + mobile + quality). **Not yet verified:** the end-to-end flow clicked through on the deployed dev site (the demo dry-run) - this is the outstanding human step.
- Migration `0011_adhoc_cross_group_meetups.sql` applied locally; it will run on API boot (`db:migrate`) for the dev deploy.
- Working tree at session end also shows unrelated/untracked items not touched by this work: `M CLAUDE.md`, `?? .claude/settings.json`, `?? .knownissue/` (left unstaged).

## Conventions, commands & workflows
- Pre-PR / pre-merge gate: **`pnpm check`** (lint + typecheck + test + quality). API DB tests need `pnpm db:up` (Postgres on host port 5433). Run a single API test file: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/<file>.test.ts`.
- **No per-package lint script** - use root `pnpm lint` / `pnpm format` (biome). `pnpm quality` bans `as any`/`@ts-*`/`biome-ignore`. No em dashes anywhere (hyphens).
- Migrations are **hand-authored**: numbered SQL under `apps/api/src/db/migrations/` + a matching `meta/_journal.json` entry (`db:generate` is unusable). 0011 is additive `CREATE TABLE`-only (inline `REFERENCES`; cosmetically diverges from drizzle's `ALTER TABLE ADD CONSTRAINT` style but functionally identical - acceptable for hand-authored).
- Branching: feature work on `feat/*` -> merge/PR into `dev`; only `dev` -> `main` (protected). Pushing `dev` deploys the dev stack.
- The roster abstraction: any new code that needs "who is in this meetup" must use `rosterUserIds`/`isInRoster`/`requireInRoster` (`apps/api/src/db/groups.ts`, `apps/api/src/routers/events.ts`), NOT `memberIdsOf(e.groupId)`/`requireMember(e.groupId, ...)`. `requireMember` remains correct for true group-CRUD (the groups router) and for `events.addGroup`'s "must belong to the group you attach" check.

## Known issues / caveats / risks
- **Demo flow not browser-tested end-to-end** on the deployed dev site yet (the hero path: create from group A -> add group B -> share link -> outsider joins as participant -> all vote/RSVP -> reveal by name -> "Make a group from this"). Do this before the Friday M4 progress demo.
- **Tech-debt (logged in `docs/tech-debt.md`):** `groups.removeMember` purges a removed user's reactions/responses/opt-outs only for events where the group is the ORIGIN; votes on meetups where their group is ATTACHED are not purged on removal (cross-group, mid-collecting edge). Revisit with removeGroup/un-invite.
- **Deferred features (spec + Linear):** fully groupless meetups (needs nullable `groupId` + migration), the "people you've met" picker / contacts, per-group name-hiding (cross-group meetups reveal roster names across groups in the conditional picker + reveal - this is by-design "names shown", but worth a privacy pass later).
- **UX detail (out of scope, noted by review):** a cross-group plan's dashboard card shows the *origin* group's name, not the viewer's attached group. "Add a group" is shown during `collecting` and `moment` (adding mid-moment is allowed by the API - intentional but worth a product look).
- `AddGroupSheet` lists ALL the user's groups including the origin/already-attached (tapping them is a harmless backend no-op); not filtered.

## Next steps
1. **Demo dry-run** on `bethere-dev.vercel.app` once the deploy finishes; rehearse the cross-group + guest + make-a-group path. (Offer stands to drive a local run to confirm before the demo.)
2. Consider the deferred **evaluation work** the strategy analysis flagged as the real M4 mark-mover (run the SUS/usability protocol with 5-8 users; instrument family-D telemetry) - separate from this feature.
3. When ready, ship `dev -> main` via PR (deploys prod).
4. Follow-on iterations: ephemeral guest niceties (the "people you've met" picker), fully groupless meetups, and the `removeMember` cross-group purge fix.

## References
- Spec: `docs/superpowers/specs/2026-06-10-adhoc-cross-group-meetups-design.md`
- Plan: `docs/superpowers/plans/2026-06-10-adhoc-cross-group-meetups.md`
- Interview driving it: `docs/drp-context/interviews/m4 interviews/luca interview.md`
- Prior iteration (the link rails this builds on): `docs/summary/2026-06-10-1332-meetup-link-conversion-funnel-and-og-cards.md`; DRP-56.
- Core code: `apps/api/src/db/schema.ts` (`eventGroups`, `eventParticipants`), `apps/api/src/db/groups.ts` (`rosterUserIds`, `isInRoster`), `apps/api/src/routers/events.ts` (`requireInRoster`, `get`, `mine`, `joinByToken`, `addGroup`, `update`), `apps/api/src/routers/groups.ts` (`createFromEvent`), `packages/shared/src/schemas.ts` (`AddGroupInput`, `CreateGroupFromEventInput`), `apps/mobile/src/screens/event-detail/AddGroupSheet.tsx`, `apps/mobile/src/screens/event-detail/MakeGroupSheet.tsx`, `apps/mobile/src/screens/EventDetail.tsx`.
- Tests: `apps/api/src/routers/events-roster.test.ts`, `apps/api/src/routers/groups-createFromEvent.test.ts`, updated `apps/api/src/routers/events-share.test.ts`.
- Migration: `apps/api/src/db/migrations/0011_adhoc_cross_group_meetups.sql`.
- Linear: DRP-62 (Done).
