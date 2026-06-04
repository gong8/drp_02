# DRP-43 UX fixes: create-flow locks, editable meetups (per-field CAS), typography, countdown - 2026-06-04

**Branch:** work done on `dev`; commits now also sit in `feat/redo-from-previous-meetup` history (which since added unrelated DRP-42 work on top). **PRs:** none opened this session (code is on `dev`, awaiting the usual `dev -> main` ship). **Linear:** DRP-43 (Done). **Scope:** address five UX complaints against the unified suggest flow as one cohesive pass.

## TL;DR

The user dumped five UX complaints (oversized create step, un-editable meetups, a "programmer" mono font, and a confusing green countdown bar) and asked to discuss seriously. We brainstormed, grounded the work in the real code via exploration agents, and settled a design. The headline decision: meetup title/location/notes become editable by **anyone in the group**, which the user explicitly flagged as a consistency/race-condition problem - so editing uses a **per-field compare-and-set (CAS)** under a `SELECT ... FOR UPDATE` lock (no schema migration, no lost updates, no false cross-field conflicts). Implemented via a dependency-ordered multi-agent workflow, verified green (typecheck + lint + shared 39 / api 26 tests), and shipped in four modular commits. Adversarial review of the CAS surfaced and fixed a real adjacent race in the auto-lock title-derive path. The mobile UI has **not** been visually run on a device - that is the main open item.

## What was done

- **Brainstormed + grounded (no code first).** Invoked the brainstorming skill, then ran a read-only exploration workflow (5 parallel `Explore` agents) over the five pain areas, and additionally read `CreateWizard.tsx`, `theme.ts`, `events.ts`, `schemas.ts`, `db/schema.ts`, and `create-plan.ts` directly to confirm details before proposing anything.
- **Locked the design via 4 explicit forks** (AskUserQuestion). User answers shaped scope: minimal create-step change ("just move the locks"), optional title at create + editable after, edit scope = title/location/notes editable by **anyone** with an emphasis on race-condition consistency, and an **inline edit sheet** UI.
- **Wrote + committed the spec** `docs/superpowers/specs/2026-06-04-ux-fixes-design.md` (commit `5e4eab3`); created Linear **DRP-43** (In Progress).
- **Implemented via a 3-wave workflow** (7 agents, file-ownership lanes, barriers between waves):
  - Wave 1 Foundation: shared `FieldEdit`/`UpdateEventInput` + api `events.update` mutation + `titleRaw` in `get`; `formatTimeLeft` helper; create-flow lock relocation + optional Title field.
  - Wave 2 Consumers: `Dashboard.tsx` (countdown + fonts), `EventDetail.tsx` (edit sheet + countdown + fonts), `DateChip`/`StickerTag` fonts.
  - Wave 3 Cleanup: remove `font.mono` from theme, stop loading SpaceMono, delete `DrainBar.tsx` + its barrel export.
- **Verified centrally + fixed integration**: typecheck clean across all 3 packages; lint had 2 pure-format issues (fixed with `pnpm format`); shared 33 + api 26 tests passed.
- **Adversarial review caught a real race** (see Key decisions) and I hardened `settleCollecting` + `lock`.
- **Added a `UpdateEventInput` parse test** (`packages/shared/src/schemas.test.ts`, 6 cases -> shared 39 tests).
- **Shipped four modular commits** and closed DRP-43 with a commit-referenced comment.

### The four implementation commits (on `dev`)
| SHA | Commit |
| --- | --- |
| `101176b` | feat(api): editable meetup metadata via per-field compare-and-set |
| `cb541ce` | feat(mobile): move lock toggles onto their steps, optional title at create |
| `dd122ce` | feat(mobile): plain-language countdown + edit-details sheet, drop the green bar |
| `644b571` | style(mobile): remove SpaceMono, keep typography in-theme |

## Key decisions & rationale

- **Per-field compare-and-set over a version token or last-write-wins.** Because *anyone* can edit, two members can edit the same plan at once. Options weighed: (a) LWW with `updatedAt` - silently clobbers; (b) a row-level `rev`/`updatedAt` optimistic token - needs a migration and produces *false* conflicts when two people edit *different* fields; (c) **per-field CAS** - the client sends `{from, to}` per changed field and the server writes `to` only if the current DB value still equals `from`. CAS won because the field values themselves are the concurrency token (so **no schema migration**, and there is no `updatedAt` column on `events` anyway), and it is precise: different-field edits never collide, same-field edits surface a conflict carrying the now-current value instead of clobbering. A `SELECT ... FOR UPDATE` inside `db.transaction` serializes concurrent writers so the read-modify-write is atomic.
- **Title stays auto-derived but becomes settable/editable.** Today the creator never sets a title (`const title = ""`); the server fills it from the winning activity at lock (`resolveTitle` only derives when the stored title is empty). We kept that elegance: title is optional at create and editable after, and an empty value reverts to auto-derive. The edit sheet must prefill from the **raw** stored title (often `""`) - not the derived `displayTitle` that `get` returns - so `get` now also returns `titleRaw`, and the sheet shows the derived title as the input *placeholder*.
- **Hardening the auto-lock title race (the bug the user's instinct predicted).** `settleCollecting` and `lock` derived the title from a possibly-stale, unlocked in-memory `e.title` and wrote it **unconditionally**. With a new concurrent title editor, an edit landing exactly as a plan auto-locks could be lost (the derived title overwrites "Pub"). Fix: drop `title` from the main `.set(...)` and fill it with a **SQL-guarded** write - `UPDATE events SET title = :derived WHERE id = :id AND title = ''` - only when the derived title is non-empty. This is outcome-identical on the no-conflict path (`resolveTitle` already returns `e.title` unchanged when non-empty) and never overwrites an explicit/edited title. This made the spec's claimed "R3" reconciliation actually true.
- **"Just move the locks" (minimal create-step change).** The user chose not to restructure the "A few options" step; we only relocated `Lock the times` under the times list and `Lock the activity` under the activities list (each lock now sits next to what it governs) and added the optional Title field. The deadline cards stayed.
- **Plain text over a percentage bar.** `DrainBar` (green fill, flips pink under 25% elapsed) was deleted along with `remainingFrac`. Countdowns now read "Voting closes in 2 days" / "RSVP closes in 5 hours" / "Closing now", with urgency expressed by pink text under a **fixed 1-hour threshold** (not a percentage, per the user). A new bare-duration helper `formatTimeLeft(ms)` returns "2 days"/"5 hours"/"23 minutes"/"under a minute"/"now"; callers compose the phase-aware label and special-case `<= 0` as "Closing now".
- **Kill SpaceMono, preserve digit alignment.** `font.mono` is removed everywhere; numerics (counts, "N on the table", countdowns) use Inter `font.bold` with `fontVariant: ["tabular-nums"]` so digits stay fixed-width (the one good property mono provided); the hero clock uses Archivo `font.display`; stickers use `font.display`.
- **Workflow execution with file-ownership lanes + barriers.** `EventDetail.tsx` and `Dashboard.tsx` are each touched by multiple areas, so each file had exactly one owning agent per wave; waves were sequenced (Foundation -> Consumers -> Cleanup) because consumers depend on the new types/helper and the theme `mono` removal must come after all consumers stop referencing it.

## Things learned / discovered

- **No `updatedAt` on `events`** (only `createdAt`) - directly motivated the migration-free CAS design.
- **`resolveTitle`/`displayTitle` semantics** (`apps/api/src/routers/create-plan.ts`): `resolveTitle` keeps a non-empty title and derives from the most-voted activity only when the stored title is blank; `displayTitle` falls back to the literal placeholder `"An activity"`. `get` returns the *derived* title, which is why `titleRaw` was needed for editing.
- **Auth helpers already fit "any member".** `requireMember(groupId, userId)` + `loadEvent(eventId, userId)` (events.ts) give exactly the membership-scoped, non-creator authorization the edit feature needed. `loadEvent` does **not** lock, so `update` inlines its own `tx.select(...).for("update")`.
- **No API integration test harness exists.** Every `apps/api/**/*.test.ts` is a pure-logic / auth / seed unit test (`node:test`, no DB, no tRPC `createCaller`). The CAS mutation is intrinsically DB+transaction bound, so it is **statically verified only** (typecheck) plus a shared-schema parse test; there is no automated test exercising the live CAS/lock behavior.
- **biome reflows multiline drizzle chains.** `pnpm lint` failed twice on pure formatting (a collapsed `.for("update")` select; a guarded `.update(...).where(...)` chain) - `pnpm format` (`biome check --write`) fixed both. Always `pnpm format` before re-linting after hand edits.
- **Aggregate `pnpm test` still hangs** (mobile jest leaks a handle - pre-existing, see memory). Ran `pnpm --filter @bethere/shared test` and `pnpm --filter @bethere/api test` separately.
- **Workflow ergonomics:** agents editing *disjoint* files within one wave share the working tree with no conflict; dependency ordering is enforced with `await parallel([...])` barriers between waves. The cleanup agent was told to grep-and-gate (refuse to remove `font.mono` if any reference remained) - a useful safety check that confirmed the consumer wave's completeness.

## Current state

- **DRP-43: Done.** Four implementation commits + one spec commit on `dev`. Working tree clean at session end.
- **Verified:** `pnpm typecheck` clean (shared/api/mobile), `pnpm lint` clean (97 files), `packages/shared` 39 tests pass, `apps/api` 26 tests pass.
- **NOT verified:** the mobile app was never launched. Edit-sheet feel, countdown wording/layout, font rendering, and the moved lock toggles are unconfirmed visually.
- **Branch note:** the gathered facts show the current branch is `feat/redo-from-previous-meetup` with DRP-42 commits (`events.pastForGroup`, redo shells) layered on top of the DRP-43 commits. That DRP-42 work is **not** part of this session; it started after these commits landed.
- **Two deliberate visual defaults left open:** hero clock = Archivo `font.display` (vs Inter bold); countdown copy = "Voting closes / RSVP closes in X".

## Conventions, commands & workflows

- **Gates before any PR:** `pnpm typecheck`, `pnpm lint` (auto-fix via `pnpm format`), and per-package tests. Do **not** run aggregate `pnpm test` (mobile jest hang); run `pnpm --filter @bethere/<pkg> test`.
- **Type chain:** data shapes are Zod in `packages/shared` (`UpdateEventInput`, `FieldEdit`), exposed via tRPC in `apps/api/src/routers/events.ts`; the mobile client's types follow automatically.
- **ESM in api:** relative imports use `.js` extensions.
- **No em dashes** anywhere (hyphens only) - followed throughout.
- **Branching:** routine work on `dev`; ship via a `dev -> main` PR (the only branch allowed into `main`). These commits are on `dev`.
- **Linear:** DRP-43 tracked from In Progress to Done with a commit-referenced comment, per repo policy.

## Known issues / caveats / risks

- **Mobile UI unverified on device** - the highest-value follow-up given the complaints were largely visual.
- **CAS has no automated integration test** - only a shared-schema parse test + static typecheck. The transaction/lock/conflict behavior is unexercised by CI.
- **Pre-existing double-settle race (NOT fixed, out of scope):** two concurrent requests can both pass `settleCollecting`'s stale in-memory phase guard and each write a `moment` transition with a *different* `momentStartsAt`/window. This predates DRP-43 and was left alone.
- **Transient in-memory title staleness:** after the guarded title fill, `settleCollecting`/`lock` still set `e.title = derived` in memory; if a concurrent edit won the DB write, that single response can show the derived title before the next poll reconciles. DB stays correct.
- **Unused dependency:** `@expo-google-fonts/space-mono` is now unused in `apps/mobile/package.json` but was left installed (package.json was outside assigned edit scope).
- **"A few options" step may still feel large** - per the user's "just move the locks" choice, Location/Notes/Decides-by/Reply-by remain on it.

## Next steps

1. **Run the app** (`pnpm dev:mobile` or the `/run` skill): walk create -> moved locks -> optional title; open the Edit-details sheet (incl. a simulated conflict); check the countdown copy and fonts.
2. **Tweak the two visual defaults** if desired (hero clock font; countdown wording).
3. **Ship:** open the `dev -> main` PR (will carry DRP-43 and the later DRP-42 work).
4. Optional: remove the unused `@expo-google-fonts/space-mono` dependency.
5. Optional: stand up an api integration harness (tRPC `createCaller` + a test DB) to cover `events.update` CAS, the phase gate, and the auto-lock title-fill guard.

## References

- **Spec:** `docs/superpowers/specs/2026-06-04-ux-fixes-design.md`
- **API:** `apps/api/src/routers/events.ts` - `update` mutation (CAS + `FOR UPDATE`), `get` (`titleRaw`), `settleCollecting` + `lock` (guarded title fill); `apps/api/src/routers/create-plan.ts` - `resolveTitle`/`displayTitle`.
- **Shared:** `packages/shared/src/schemas.ts` - `FieldEdit`, `UpdateEventInput`; `packages/shared/src/schemas.test.ts` - parse tests.
- **Mobile:** `apps/mobile/src/screens/EventDetail.tsx` (edit sheet + `CountdownBanner`), `apps/mobile/src/screens/Dashboard.tsx` (countdown, DrainBar removal), `apps/mobile/src/screens/CreateWizard.tsx` (lock relocation + Title), `apps/mobile/src/lib/format.ts` (`formatTimeLeft`), `apps/mobile/src/theme.ts` + `apps/mobile/App.tsx` (SpaceMono removal), `apps/mobile/src/ui/DateChip.tsx` + `StickerTag.tsx` (fonts), `apps/mobile/src/ui/DrainBar.tsx` (deleted) + `apps/mobile/src/ui/index.ts`.
- **Linear:** DRP-43 - https://linear.app/drp-02/issue/DRP-43
- **Workflow scripts (this session):** exploration `...workflows/scripts/explore-ux-pain-points-wf_80956d63-675.js`; implementation `...workflows/scripts/ux-fixes-implement-wf_a3f45f7b-fb0.js`.
