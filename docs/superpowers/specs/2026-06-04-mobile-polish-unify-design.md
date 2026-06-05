# Mobile polish + unification (DRP-44)

Date: 2026-06-04. Branch: `feat/redo-from-previous-meetup`. Status: approved, building.

A cohesive polish pass on the Expo mobile app that (a) clears a 19-item UX punch-list and (b) unifies as many duplicated components / styles / copy as possible into one shared vocabulary. Design language is unchanged (refined neobrutalist: 2px ink borders, hard offset shadows, Archivo/Inter, peach->lavender gradient); the work is consistency + de-slopping, not a restyle.

Backed by a 5-lens parallel audit of `apps/mobile/src` (component patterns, controls/displays, copy, style tokens, status logic). Findings drive the primitive set below.

## Approved decisions

- **Dashboard**: a pinned pink "N ACTION(S) REQUIRED" panel (contained card, not full-bleed) + a colour-coded `Going / Open / Done` segmented filter, default **Going**.
- **Detail top**: the meetup title sits in the back bar; the group drops to a hero sub-line ("Group . Location").

## Status model (the awaiting-bug fix) - `lib/status.ts` (NEW)

Single source of truth for plan categorisation, consumed by Dashboard + EventDetail + notifications. The client must NOT trust raw `myStatus` for bucketing (the server returns `awaiting` for a cleared/past plan the user ignored - the reported bug).

- `isTerminal(e)` = `phase === 'cleared' || phase === 'fizzled'`; `isLive(e)` = `!isTerminal`.
- `isPast(e)` = `(phase === 'moment' || phase === 'cleared') && new Date(e.startsAt) < now`. (During `collecting`, `startsAt` is a placeholder - earliest candidate or now+7d - so it is never trusted for past-ness.)
- Buckets (mutually exclusive + total):
  - `GOING` := `myStatus === 'going' && !isPast && phase !== 'fizzled'`
  - `OPEN`  := `(phase === 'collecting' || phase === 'moment') && myStatus !== 'declined' && myStatus !== 'going' && !isPast`
  - `DONE`  := `phase === 'cleared' || phase === 'fizzled' || myStatus === 'declined' || isPast`
  - `planBucket(e): 'going' | 'open' | 'done'` returns the first match in that order.
- `isActionRequired(e)` (orthogonal overlay, drives the pink panel) := `(phase === 'moment' && !iResponded) || (phase === 'collecting' && !iReacted && myStatus !== 'declined')`.
- `activeDeadline(e): { iso, label }` - phase->field+label map: moment -> `momentEndsAt` / "RSVP closes"; collecting -> `decidesBy` / "Voting closes"; else null. Used by both the dashboard action cards and the detail banner so field + wording never drift.
- `statusLabel(myStatus)` and `statusLine(e)` - one going/declined/awaiting -> copy map.
- Sorting: upcoming soonest-first, then past most-recent-first; `Done` is recent-first and dimmed.

## Unified primitives (`ui/`)

New / changed, foundation-first:

- **`theme.ts`**: add `open` `#7E6BB0`, `gutter` 16, `onInk` `#FFFFFF`, `tint` `#F1EEF6`, `rPill` 999.
- **`Text` (`AppText`)**: variants `screenTitle` (Archivo 27), `title` (display 16 ink), `caption` (Inter medium 11 muted - canonical, kills the 10/11 wobble), `overline` (folds FieldLabel). Replaces ~22 inline text recipes.
- **`Segmented<T>`**: `variant: 'tabs' | 'bar'` + optional `activeColor(opt)`. Replaces `Tabs` + `Toggle`; powers the coloured dashboard filter (Going=green / Open=purple / Done=grey).
- **`Pill`**: small-label base, `tone: 'outline' | 'solid'`, optional `tilt`, `mono`. `DateChip` -> `Pill outline mono`; `StickerTag` -> `Pill solid tilt`. Plus `StatusPill` convenience driven by `statusLabel`.
- **`Countdown`**: `ms`, `label`, `variant: 'band' | 'inline'`, auto-`hot` under 1h (big, brand, tabular-nums). Owns the "Closing now" / "<label> in <dur>" string. Replaces `CountdownBanner` + the `DeadlineCard` countdown line + the "Locks .." sticker. Time-left becomes the dominant element.
- **`Band`**: full-bleed ink-ruled banner (`-gutter` bleed). Shared by the (now contained) action panel styling source and the detail countdown banner.
- **`Card`**: gains `onPress?` + `disabled?` (renders Pressable internally), killing the `Pressable>Card` boilerplate in 4+ cards.
- **`PersonRow`**: gains `onPress?` + `divided?` so the two BottomSheet pickers reuse it.
- **`SelectCheck`**: gains `size`; becomes the ONLY checkbox glyph.
- **`CheckOption`**: pressable + SelectCheck + label/sub column (+ `tinted`, `accent`). Replaces CreateWizard `CheckRow` and the EventDetail opt-out row.
- **`Section`**: `title` + optional `sub` + `size: 'sm' | 'lg'`. Replaces EventDetail `Section`, CreateWizard `Step`, sheet titles, GroupDetail inline heading.
- **`ScreenHeader`**: `title` + optional back + optional `right` slot. Replaces `Heading` + `BackBar`; carries the top-right account avatar on Dashboard/Groups.
- **`ScreenScroll`**: standard gradient-bg scroll shell with shared content padding (`gutter`), `bottomPad` override. Wraps every screen.
- **`Button`**: add `size: 'sm'` + `ghost` variant (themed inline Add/Cancel).
- **`TextButton`**: `label` + `onPress` + `disabled?` + `tone: 'brand' | 'muted'`. Replaces inline Add/Save/Edit/Cancel/x affordances.
- **`AddComposer`**: ONE expand-to-add affordance for both time (DateTimePill) and activity (Field), with themed `Add`/`Cancel`. Fixes the inconsistent/ugly voting add flows.
- **`EmptyState`**: centered muted note for empty lists + inline fetch errors (shared `ERR_NETWORK`).

## Copy - `lib/copy.ts` (NEW)

One vocabulary. Verb = **vote** (not weigh-in/have-your-say/react). Noun = **meetup** (not meet/plan). Decline = **Can't make it**. Notes = **Top pick wins** / **Blind**. Privacy = **No names, just the group.** Errors = `ERR_NETWORK` / `ERR_SAVE`. Helpers `candidateCountLabel(n)` ("3 options", kills "on the table"), `statusLabel`. Wizard step titles/subs + `confirmMirror` trimmed to terse fragments. STEP_COPY map keyed by step.

## Screens

- **App.tsx**: drop the Account tab; custom 2-tab bar with a filled active pill (visible boundaries); register `Account` (with back) in both stacks; top-right avatar opens it.
- **Dashboard**: ScreenHeader + avatar; contained pink action panel "N ACTION(S) REQUIRED" (big Countdown per row); `Segmented` Going/Open/Done (default Going) via `planBucket`; cards drop "on the table"/"weigh in"/"had your say"; cleared card = "3 going" text only (no face pile); StatusPill `In`/`Open`.
- **EventDetail**: title in back bar, group->hero sub-line; one hero-card shell + rhythm across collecting/moment/cleared; voting board uses `Section` + `VoteRow` + `AddComposer`; `Countdown` band; `CheckOption` opt-out; `PersonRow` pickers; copy trims.
- **CreateWizard + redo.ts (+test)**: split the bloated `options` step into `details` (location + notes) and `deadlines` (decides-by + reply-by). Update `wizardSteps`, `valid()`, progress dots, `redo.test.ts`. Adopt Segmented/Button-sm/CheckOption/Section/STEP_COPY.
- **GroupsList / GroupDetail / Account / CreateGroup**: ScreenHeader, Card onPress, PersonRow, EmptyState, copy constants.

## Build order

1. Tokens + `lib/copy.ts` + `lib/status.ts` + `format.ts` helper.
2. Primitives (Text, Pill, Segmented, Countdown, Band, CheckOption, Section, ScreenHeader, ScreenScroll, TextButton, AddComposer, EmptyState; extend Card/PersonRow/SelectCheck/Button/FieldLabel).
3. Rewire screens (App, Dashboard, EventDetail, CreateWizard+redo, Groups*, Account, CreateGroup).
4. `pnpm lint` + `typecheck` + per-package `test` green.
5. Adversarial multi-agent review: categorization correctness, unification completeness, punch-list coverage, copy. Fix, re-verify.

Commit each wave as a working chunk.
