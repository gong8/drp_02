# Redo a meetup + unify the plan name onto "activity" - 2026-06-04

**Branch:** `feat/redo-from-previous-meetup` | **PR:** [#39](https://github.com/gong8/drp_02/pull/39) (OPEN, into `dev`) | **Linear:** DRP-42 | **Scope:** Add a "redo a past meetup" flow, then collapse the four words for a plan's name (title/activity/thing/name) into one concept, `activity`, everywhere.

## TL;DR
This session started as a brainstorm about recurring meetups ("weekly DnD") and "redo a meetup at a different time," which we scoped down to **redo only** (recurring deferred) and built as a conditional step in the create wizard. While live-testing redo, the user surfaced that the **title/activity/thing/name** model was incoherent (DRP-43 had added an explicit Title field on top of the existing activity-derived naming). We then brainstormed and implemented a **full unification**: a plan's name IS its activity, one word everywhere, with a schema rename + migration, the explicit Title field removed, and a group-name heading fallback. Everything is green (typecheck 3 packages, api 30/30, mobile jest 10/10, lint clean), reviewed per-task plus a final holistic review, and shipped as one PR (#39) into `dev`. Recurring meetups remain explicitly deferred.

## What was done

### Phase 1 - Redo feature (brainstorm -> spec -> plan -> build)
- **Brainstormed** the idea. Separated two concepts: **redo** (manual one-off re-launch) vs **recurring** (automated cadence). Decided redo is the primitive; recurring = "auto-redo on a timer," deferred.
- Grounded in the codebase: discovered the dashboard `events.mine` **already retains all past (cleared) plans with no time cutoff** ("All doubles as your history"), so there was no need to build history storage. Fizzled plans leave no trace (returned as `null` from `mine`).
- **Spec:** `docs/superpowers/specs/2026-06-04-redo-from-previous-meetup-design.md`. **Plan:** `docs/superpowers/plans/2026-06-04-redo-from-previous-meetup.md`.
- **Built (subagent-driven, fresh agent per task + spec review + code-quality review):**
  - `9f96847` pure shaper `shapePastMeetups` (api, `node:test`).
  - `0a41fe8` `events.pastForGroup` query (cleared plans -> clonable shells).
  - `136e414` pure mobile helpers `redo.ts` (`wizardSteps`, `prefillFromMeetup`, `EMPTY_PREFILL`) + first jest tests in `src/lib`.
  - `6564b35` conditional "source" step in `CreateWizard` (Start fresh vs a past meetup).
  - Review-driven fixes: `8ad8a10` async-race guard on the `pastForGroup` fetch (`let active` cleanup, matching repo convention); `8e3aa19` cap cloned activities to the create limit (later removed by the unification); `f7db0b3` made the source cards actually selectable (root cause: `Card` forwards `style` to its `HardShadow` wrapper, not the bordered inner View, so a `borderColor` override never rendered - switched to the existing `SelectCheck` child) and an initial title-carry (later reworked).

### Phase 2 - Activity unification (brainstorm -> spec -> plan -> build, folded into the same branch)
- User: "unify title, activity, thing, name - they should all be the same thing EVERYWHERE."
- Inventoried every usage across schema/shared/api/mobile. Found **"name" was overloaded** (the plan title, people's names, AND the anonymity copy "No names - it's the group's"), so "name" had to be retired for this concept.
- Decisions (see below): full collapse; the word is **activity**; sequencing **C** (fold into the redo branch, one PR); heading = activity with **group-name fallback**.
- **Spec:** `docs/superpowers/specs/2026-06-04-activity-unification-design.md`. **Plan:** `docs/superpowers/plans/2026-06-04-activity-unification.md` (staged foundation-first: shared -> schema+api -> mobile -> verify).
- **Built (subagent-driven):**
  - `02447f1` shared: `CreateEventInput` drops `title`, `lockThings`->`lockActivity`; `UpdateEventInput.title`->`activity`.
  - `7647440` api: column rename (`title`->`activity`, `lock_things`->`lock_activity`) + hand-written migration `0008_activity_rename.sql` + `_journal.json` entry; helper renames (`resolveTitle`->`resolveActivity`, `displayTitle`->`displayActivity` which now returns `""` not a placeholder, deleted `FALLBACK_TITLE`); `events.create` drops the title param; `events.update` activity edit gated to post-lock (throws BAD_REQUEST while `collecting`); `mine`/`get`/`pastForGroup` return `activity` (+ `activityRaw`); seed + seed-test updated.
  - `59cf265` mobile: removed the Title field from create; `lockThings`->`lockActivity` throughout `CreateWizard`; Dashboard/EventDetail heading = `activity || groupName`; EventDetail name edit only post-lock; `notifications.ts` reminder text uses `activity || groupName`; reworded anonymity copy.
  - `0aff779` review fix: SourceCard fallback when a past plan has no activity; tidied stale "title" comments.
- **Live-test bug fix `286aea3`** (the key correction): redo wasn't preloading activities into the "What do you fancy?" step. **Root cause:** `pastForGroup` derived the clone from activity candidate ROWS, which are empty for plans whose name lives in the `events.activity` scalar (e.g. seeded plans). **Fix + redesign per user request:** carry the `events.activity` scalar; `prefillFromMeetup` preloads the won activity as a **single chip with `lockActivity` pre-ticked** ("do football again" = football, locked, just pick a time). Deleted the now-dead `activityCandidates` carry and the `MAX_CLONE_ACTIVITIES` cap; `pastForGroup` no longer fetches candidate rows.
- `dc0c10a` dropped an unused import (last lint warning) -> fully clean tree.
- Updated Linear DRP-42 with a completion comment; pushed; opened PR #39.

## Key decisions & rationale

- **Redo only; recurring deferred.** Re-creation friction was the user's primary pain; redo solves it and makes "weekly DnD" a few taps. Automated recurring needs a scheduler the codebase deliberately lacks (everything settles lazily on read) and reopens an honesty question, so it is out of scope.
- **No roster / RSVP carry-over on redo.** The app's soul is *honest attendance* (the blind moment). Each redo is a fresh honest round - you cannot carry forward a "yes" because life changes. Redo clones only the plan shell, never RSVP data.
- **Redo lives only in the create wizard** (not the dashboard or group screen). The dashboard already is the history; the wizard's group step is the natural entry point, gated on the group having past meetups.
- **Full collapse of title==activity (option A), not rename-only.** The plan's name IS what you are doing. The one case it loses (a named occasion with separately votable activities, e.g. "Friday plans" + bowling/cinema) is rare and survives as an activity label. DRP-43's separate Title field was the source of the incoherence and is removed.
- **The single word is `activity`.** It is already the `candidate_kind` enum value (zero enum migration), reads cleanly in all UI spots, and its empty-state need is handled by the group fallback. ("thing"/"idea" would need an enum migration and read worse; "name"/"title" collide or read poorly.)
- **Heading = activity, group-name fallback** (chosen over "Group . Activity" combined, and over keeping the "An activity" placeholder). Activity-primary is most scannable across groups; when there is no activity yet the group name carries the card and the group is dropped from the subline to avoid repetition.
- **Editing the name is post-lock only.** While `collecting`, the name is the live leading candidate (shaped by votes), so there is nothing single to edit; this deletes the old "empty title = auto-derive" hack. Enforced on both client (sheet only renders post-lock) and server (BAD_REQUEST while collecting).
- **Redo carries the won activity (single, locked), not the full candidate list.** Final user-driven decision: "do it again" should reproduce the same thing by default; preload one chip + pre-tick the lock; the creator can untick to reopen it to a vote. This also fixed the empty-preload bug by sourcing the always-populated `events.activity` scalar instead of candidate rows.
- **Sequencing C: one combined PR.** The tRPC type chain couples schema/shared/api/mobile, so the rename must land together; folding redo + unification into one branch/PR was the user's call (bigger PR, but honest coupling).
- **Hand-written migration, not `drizzle-kit generate`.** Per CLAUDE.md, `generate` is interactive and hangs on rename-vs-create ambiguity. `0008_activity_rename.sql` is two pure `RENAME COLUMN`s; `migrate` (run on boot) only needs the `.sql` + a `_journal.json` entry (snapshots are only for `generate`).

## Things learned / discovered

- **The dashboard already stores all past meetups.** `events.mine` returns every non-fizzled plan in the user's groups with no recency filter; `Dashboard.tsx` comment: "All doubles as your history." This collapsed the redo design to "add an entry point + clone," no storage.
- **`Card` (mobile) ignores `style.borderColor`.** `Card.tsx` forwards the `style` prop to its `HardShadow` wrapper, while the visible border/background are hardcoded on its inner `View`. So you cannot recolour a Card's border/background via `style`; use a child indicator (`SelectCheck`) for selection. `HardShadow`'s shadow rect is `pointerEvents="none"`, so it does not block taps.
- **DRP-43 changed the wizard under the redo work.** It added an optional Title field at create and moved lock toggles onto their own steps; the redo plan (written against the pre-DRP-43 wizard) had to be reconciled. This is what exposed the title/activity incoherence.
- **`displayActivity` returning `""`** (instead of a placeholder) is safe: its only consumers are `events.mine`/`get`, which pass it straight to the client, and the clients apply the fallback. The API now returns raw-ish display values; presentation handles emptiness.
- **`pastForGroup` does not call `settleLifecycle`** - a plan whose moment just elapsed but has not been read since will not appear in the redo list until something else settles it to `cleared`. Acceptable for M2 (a just-ended plan is not urgent to clone; `mine`/`get` settle it on the next load). Noted as a freshness caveat.
- **`notifications.ts`** has its own `title` concept (the OS notification's `content.title` / `schedule(date, title, body)`) that is unrelated to the plan name - it must NOT be renamed. Only `e.title` -> `e.activity || e.groupName` and the `Pick` field changed; the type there is `ReminderEvent` (not `RemindableEvent`).
- **Tooling quirks:** aggregate `pnpm test` can hang on mobile jest (leaked handle) - run per package and use `--forceExit`; `pkill -f jest` after. zsh expands `--include=*.ts` oddly in some `grep` invocations - quote globs or target dirs directly.
- **Test counts shifted intentionally:** api 31 -> 30 (removed the obsolete `MAX_CLONE_ACTIVITIES` cap test when redo stopped cloning a list); mobile 9 -> 10 (added a time-only-plan prefill test).

## Current state

- **Branch `feat/redo-from-previous-meetup`** is 16 commits ahead of `dev`, pushed, with **PR #39 OPEN into `dev`**. Working tree clean.
- **Verified green:** `pnpm typecheck` (shared+api+mobile), `pnpm --filter @bethere/api test` (30/30), `pnpm --filter @bethere/mobile exec jest --watchAll=false --forceExit` (10/10), `pnpm lint` (no warnings). Migration `0008` verified to apply on a fresh DB (`pnpm db:down && pnpm db:up && db:migrate`).
- **Reviews:** every task passed an independent spec-compliance review and a code-quality review (subagent-driven), plus a final holistic review (verdict: ready to merge).
- **Not yet done:** PR not merged; no manual on-device pass of the *final* combined build by the human beyond the redo source-step testing that drove the fixes. Recurring meetups not built (deferred by design).
- A stray `b21f792 chore: add summary` (a DRP-43 summary doc) rode along on the branch from earlier work; left as-is (not ours to remove).

## Conventions, commands & workflows

- **One concept = `activity`.** A plan's name is its activity. No `title` field anywhere; lock flag is `lockActivity` / column `lock_activity`. Do not reintroduce a separate title.
- **Naming map applied:** `events.title`->`events.activity`, `events.lock_things`->`events.lock_activity`, `lockThings`->`lockActivity`, `resolveTitle`->`resolveActivity`, `displayTitle`->`displayActivity` (returns `""` when none), `FALLBACK_TITLE` deleted, `get` returns `activity` + `activityRaw`.
- **Display rule:** heading = `activity || groupName`; when activity is empty the group is the heading and is dropped from the subline; the redo source card uses `activity || "Untitled meetup"`.
- **Migrations:** hand-write rename migrations + a `_journal.json` entry; never run interactive `drizzle-kit generate` for renames. If the baseline is reset, reset the local DB (`docker compose down -v && pnpm db:up`).
- **Tests:** run per package; mobile jest needs `--forceExit` (then `pkill -f jest`). api tests are `node:test` (`pnpm --filter @bethere/api test`).
- **Pre-PR gates:** `pnpm lint`, `pnpm typecheck`, per-package tests, all green.
- **Branching:** work on `dev`/feature branches; PR into `dev` (never `main`). This branch -> `dev` via PR #39.
- **Linear:** DRP-42 tracks this; updated with a completion comment. Move to Done when #39 merges.

## Known issues / caveats / risks

- **`pastForGroup` freshness:** does not settle a just-ended moment, so very-recently-finished plans may lag into the redo list (see above). Low impact.
- **Combined PR size:** #39 mixes two features (redo + unification) by design - larger to review; staged commits keep it bisectable.
- **Migration on live data:** `0008` is a pure rename (data-preserving) and live runs `SEED_ON_BOOT=if-empty`, so risk is low; still, it is the first hand-written rename of a NOT NULL column in this repo - confirm it applies on the live DB at deploy.
- **Drizzle snapshot drift:** the hand-written `0008` has no generated snapshot; a future `drizzle-kit generate` may want to reconcile. Documented in the spec's risks.
- **No on-device verification** of the final combined build by the human yet (only the redo source step was exercised during fixes).

## Next steps

1. Review & merge **PR #39** into `dev` (then DRP-42 -> Done).
2. On-device smoke of the combined build: create a plan named by one locked activity (concrete) and by a vote; check the dashboard/detail heading + the no-activity group fallback; edit the name post-lock; redo a past meetup (activity preloaded + lock pre-ticked, time blank).
3. Confirm migration `0008` applies cleanly on the live/deploy DB.
4. When ready to ship to production: PR `dev` -> `main`.
5. Future: recurring meetups (deferred) as its own spec/plan; optionally `pastForGroup` settling for fresher redo lists; consider regenerating the drizzle snapshot baseline.

## References

- Specs: `docs/superpowers/specs/2026-06-04-redo-from-previous-meetup-design.md`, `docs/superpowers/specs/2026-06-04-activity-unification-design.md`
- Plans: `docs/superpowers/plans/2026-06-04-redo-from-previous-meetup.md`, `docs/superpowers/plans/2026-06-04-activity-unification.md`
- Key code: `apps/api/src/routers/events.ts` (`pastForGroup`, `create`, `update`, `mine`, `get`, `lock`, `settleCollecting`), `apps/api/src/routers/past-meetups.ts`, `apps/api/src/routers/create-plan.ts` (`resolveActivity`/`displayActivity`/`planOpensMoment`), `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0008_activity_rename.sql`, `packages/shared/src/schemas.ts`, `apps/mobile/src/lib/redo.ts`, `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/src/screens/Dashboard.tsx`, `apps/mobile/src/screens/EventDetail.tsx`, `apps/mobile/src/lib/notifications.ts`
- UI quirk reference: `apps/mobile/src/ui/Card.tsx` + `HardShadow.tsx` (style forwarding), `apps/mobile/src/ui/SelectCheck.tsx`
- PR: https://github.com/gong8/drp_02/pull/39 | Architecture: `ARCHITECTURE.md` | Project guidance: `CLAUDE.md`
