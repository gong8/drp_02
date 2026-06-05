# Mobile polish + component unification (DRP-44) - 2026-06-04

**Branch:** `feat/redo-from-previous-meetup` | **Linear:** DRP-44 (Done) | **Scope:** A cohesive polish pass on the Expo mobile app that clears a 19-item UX punch-list AND unifies the bulk of the UI into one shared component/copy/status vocabulary.

## TL;DR
The user gave a long, blunt punch-list of UX complaints about the mobile app (ugly/inconsistent voting screen, "chopped" dashboard, slop copy, a buggy "Awaiting" tab, an arbitrary detail header, no active-tab highlight, account buried in a tab, a bloated wizard step, etc.) and a strong directive: "unify AS MANY THINGS AS POSSIBLE." We ran brainstorming, confirmed two layout decisions with the user, ran a 5-lens parallel **unification audit**, then rebuilt the app foundation-first: a new `lib/status.ts` (single source of plan categorisation, which fixes the awaiting bug), a new `lib/copy.ts` (one vocabulary), and a unified `ui/` primitive set, then rewired every screen onto it and deleted 6 now-superseded primitives. A 16-agent adversarial review surfaced 11 findings (2 real `med` bugs, 9 `low` single-sourcing nits); all were fixed. End state: all 19 items addressed, both bugs fixed, `pnpm typecheck`/`pnpm lint`/mobile jest (17)/api tests (30) all green, committed across 11 commits on the branch. Not yet pushed; no PR opened (work stays on this branch per the user).

## What was done

### Process (this session, in order)
1. **Brainstormed** (superpowers:brainstorming). Explored the whole mobile codebase first (every screen, every `ui/` primitive, `theme.ts`, `App.tsx` nav, and the API status model in `apps/api/src/routers/events.ts`).
2. **Confirmed 2 pivotal layout decisions** with the user via `AskUserQuestion` (with ASCII previews), because guessing wrong would be expensive:
   - Dashboard: **Band + 3 tabs** - a pinned pink "N ACTION(S) REQUIRED" panel + a colour-coded `Going / Open / Done` segmented filter, default Going.
   - Detail top: **Title in bar** - the meetup's name in the back bar; group drops to a hero sub-line.
3. Wrote + committed the design spec (`docs/superpowers/specs/2026-06-04-mobile-polish-unify-design.md`) and created Linear **DRP-44** (In Progress).
4. **Unification audit workflow** (5 parallel agents, read-only): enumerated every duplication/inconsistency across `apps/mobile/src` along 5 lenses (component patterns, controls/displays, copy slop, style tokens, status logic). This produced the concrete primitive set + the vetted `lib/status.ts` predicates (incl. the confirmed root cause of the awaiting bug).
5. **Built foundation-first** (committed per wave; typecheck/lint each wave):
   - Wave 1: tokens + `lib/copy.ts` + `lib/status.ts` (+ `status.test.ts`).
   - Wave 2: the new `ui/` primitives (purely additive, so every commit compiled).
   - Wave 3: rewired all screens; then deleted the superseded primitives.
6. **Adversarial review workflow** (5 lenses -> per-finding independent verifier; 16 agents total). 11 findings survived verification. Fixed all: 2 `med` (a real categorization bug + a real wizard race) committed separately; 9 `low` copy/unification single-sourcing nits batched.
7. Marked DRP-44 **Done** with a writeup; wrote this summary.

### Concrete changes
- **`apps/mobile/src/lib/status.ts` (NEW)** - the single source of plan categorisation on the client, consumed by the dashboard + detail. Exports `isTerminal`/`isLive`, `isPast`, `planBucket` (`going`|`open`|`done`), `isActionRequired`, `activeDeadline`, `compareForDisplay`, `compareActions`. The client no longer buckets off raw `myStatus` (the server returns `awaiting` for a cleared/ignored plan - the bug). `status.test.ts` locks the predicates incl. the awaiting-bug case.
- **`apps/mobile/src/lib/copy.ts` (NEW)** - one vocabulary: verb `Vote`, noun `meetup`, `LABEL_CANT_MAKE_IT`, `DEADLINE_VOTING`/`DEADLINE_RSVP`, `NOTE_TOP_PICK`/`NOTE_BLIND`, `NO_NAMES`, `ERR_NETWORK`/`ERR_SAVE`, `DIDNT_COME_TOGETHER`, `candidateCountLabel` (kills "on the table" -> "N options"), `goingCountLabel`, `statusLabel`, and `STEP_COPY` (wizard step titles/subs).
- **`apps/mobile/src/lib/format.ts`** - added `HOT_MS` (under-an-hour threshold) and `countdownLabel(ms)` ("Closing now" / "<dur> left"), shared by `Countdown` and the dashboard footer.
- **`theme.ts`** - new tokens: `open` `#7E6BB0` (purple), `gutter` 16, `onInk` `#FFFFFF`, `tint` `#F1EEF6`, `rPill` 999.
- **New `ui/` primitives:** `Text` (`AppText` variants: screenTitle/title/rowLabel/body/caption/overline), `Pill`+`StatusPill`, `Segmented` (variant tabs|bar + `activeColor`), `Countdown` (duration-first, hot under 1h), `Band` (full-bleed), `CheckOption`, `Section` (sm|lg), `ScreenHeader`, `ScreenScroll`, `TextButton`, `AddComposer`, `EmptyState`, `FormError`.
- **Extended primitives:** `Card` (`onPress`, `disabled`, `tone`), `PersonRow` (`onPress`, `divided`), `SelectCheck` (`size`), `Button` (`size: 'sm'` + `ghost` variant), `FieldLabel` (`tone`).
- **Deleted (superseded):** `Heading`, `BackBar` (-> `ScreenHeader`), `Tabs`, `Toggle` (-> `Segmented`), `DateChip`, `StickerTag` (-> `Pill`/`StatusPill`).
- **Screens rewired:** `App.tsx` (drop Account tab; custom 2-tab bar with a filled active pill; Account is a pushable screen with back in both stacks, opened by the top-right avatar). `Dashboard` (contained pink action panel; coloured Going/Open/Done filter; no face pile; "3 going" as text). `EventDetail` (title in bar; one hero shell across collecting/moment/cleared; voting board uses one `AddComposer` for both lists; big `Countdown` banner; `CheckOption` opt-out; `PersonRow` pickers; copy trims). `CreateWizard` + `lib/redo.ts` (+test): split the bloated `options` step into `details` (location+notes) and `deadlines` (decides-by + reply-by); `DeadlineField` extracted (the two deadline blocks were one shape). `GroupsList`/`GroupDetail`/`Account`/`CreateGroup` onto the unified chrome.

## Key decisions & rationale
- **Confirm only the 2 expensive layout calls; decide the rest.** The user said "do not be lazy" and gave detailed direction, so we did NOT ask a pile of questions. We asked only where a wrong guess meant a big rework (dashboard structure/categorisation; detail header), using ASCII previews. Everything else (bottom-bar pill, copy, composer unification, wizard split, awaiting fix) we decided and put in the spec.
- **Author the foundation + the two hard screens by hand (not via parallel agents).** Coherence/taste is the whole point of a unification pass; fanning screen edits across agents risks re-introducing the very inconsistency we were removing. We used workflows for the parts where parallelism is safe and high-value: the read-only **audit** and the **adversarial review**.
- **`lib/status.ts` as the single categorisation source, and the client must not trust raw `myStatus`.** The server's `computeBaseStatus` returns `awaiting` for a cleared/past plan the user ignored; the old `Dashboard.matchesFilter` mapped `awaiting` straight into the Awaiting tab with no phase/past guard, so finished meetups sat in Awaiting forever. The bucket predicates guard on phase + `isPast`, neutralising the stale server value on the client. Buckets are mutually exclusive + total: `GOING = going && !isPast && !fizzled`; `OPEN = (collecting||moment) && !declined && !going && !isPast`; `DONE = cleared || fizzled || declined || isPast`. `ACTION` is an orthogonal overlay (drives the pink panel) and action items are excluded from the tab list so they never double-show.
- **`isPast` keys a moment off its RSVP window, not the event time** (review fix). A moment can legitimately stay live past its event time (the server's `resolveMomentEnd` degenerate branch returns `openMs + 1h` when the chosen time is already at/behind the open instant - reachable via the concrete shortcut for a now/just-passed time, or `settleCollecting` auto-locking on a winning candidate that is already past). With the old `startsAt < now` test, a committed "going" member dropped out of the Going tab mid-event. Fix: `cleared` keys off `startsAt`; `moment` keys off `momentEndsAt` (so a still-live moment is never past); `collecting` never past (its `startsAt` is a placeholder).
- **Contained pink action panel, not a full-bleed band.** The old dashboard had a full-bleed band + tabs + cards = three visual languages = "chopped". A contained pink `Card` (via the new `tone` prop) keeps the screen one card system.
- **Account is a pushable screen in both stacks (not a hidden tab).** Gives it a real back button; the top-right avatar pushes it. Uses the typed stack `navigation.navigate('Account')`.
- **Keep the design language (refined neobrutalist).** The complaint was inconsistency + slop, not the aesthetic, so we applied the existing system consistently rather than restyling.
- **Honoured "unify everything" down to low-value nits.** Even the 9 `low` review findings (a duplicated `title` recipe, a duplicated row-label recipe, a duplicated form-error wrapper, hardcoded copy literals) were collapsed (AppText variants, `FormError`, copy constants, `DeadlineField`). The one initially-skipped nit (#8 row label) was then also done per the directive.

## Things learned / discovered
- **The awaiting bug's true root cause** is server-side `computeBaseStatus` (`apps/api/src/routers/events.ts` ~210-224) returning `awaiting` for a revealed/cleared plan when the caller is neither IN nor a "no". The client fix (don't trust `myStatus`; bucket on phase + is-past) is the right layer; a secondary server cleanup (emit a terminal state instead of `awaiting`) is possible but not required and was not done.
- **`startsAt` is a placeholder during `collecting`** (earliest candidate, or `now + DEFAULT_HORIZON` ~7d when there are no times). It is only a real time once a slot locks. So is-past must never trust it while collecting.
- **The mobile jest suite leaks a handle and never exits** ("Jest did not exit one second after..."). Run with a `timeout` and `pkill -f jest`; the pass/fail summary prints BEFORE the hang. All 4 suites / 17 tests pass. (Matches the existing `pnpm-test-mobile-jest-hang` memory.)
- **`biome` `info`-level findings don't fail `pnpm lint`** but are worth fixing (e.g. a redundant `<></>` fragment via `noUselessFragments`). `pnpm exec biome check --write <paths>` auto-fixes formatting.
- **The Workflow tool is effective for read-only audits and adversarial review here**; the per-finding verifier (refute-by-default) correctly down-graded one over-stated sub-claim while keeping the real bug. 16 agents, ~693k tokens for the review.
- **`Card` could not be recoloured via `style`** (its `style` goes to the `HardShadow` wrapper, not the inner bordered View), so a `tone` prop was added for the pink action panel.

## Current state
- All work committed on `feat/redo-from-previous-meetup` (11 DRP-44 commits, `775711e..b20b1b3`). Working tree clean. **Not pushed; no PR opened.**
- Verified green: `pnpm typecheck` (shared + api + mobile), `pnpm lint` (biome, 111 files, 0 issues), mobile jest 17/17 (4 suites), api tests 30/30.
- DRP-44 is **Done** in Linear with a full comment.
- This branch also carries earlier DRP-42/43 work (redo-from-past-meetup + the title->activity rename + docs sync); PR #39 for DRP-42 is CLOSED (not merged). The branch has NOT been merged to `dev`/`main`.

## Conventions, commands & workflows
- `pnpm lint` / `pnpm typecheck` / `pnpm test` before any PR. Mobile tests: `cd apps/mobile && timeout 90 npx jest --watchAll=false` then `pkill -f jest`.
- No em dashes anywhere (use hyphens). Middot `·` is fine and used as the group/location separator.
- Branching: `main` protected; work normally lands on `dev`; only PR `dev -> main`. This branch is a `feat/*` kept per the user's "stay on this branch".
- **The mobile UI vocabulary is now centralised** - future screens should compose from `ui/` (ScreenScroll, ScreenHeader, Card, Segmented, Pill/StatusPill, Countdown, Section, CheckOption, AddComposer, TextButton, FormError, EmptyState, AppText variants) and route copy through `lib/copy.ts` + categorisation through `lib/status.ts`. Do not re-inline font/colour recipes.

## Known issues / caveats / risks
- **No on-device/simulator run this session.** Verification is typecheck + lint + the `App.test.tsx` render smoke test + unit tests. The visual result (spacing, the pink panel on the gradient, the tab pill, the AddComposer expand) has NOT been eyeballed on a device. Recommend an Expo Go pass before merging.
- The `isPast` moment bug only manifested in a degenerate near-/just-past event window; the fix is covered by `status.test.ts` but the degenerate server path itself (`TimeCandidateInput.startsAt` has no future validation in `packages/shared`) is unchanged - a separate hardening if desired.
- The wizard race fix gates the group step's Next on the past-meetups query settling (brief disable ~1 RTT). Acceptable, but it does add a tiny wait on the first step.
- `lib/lock.ts` is still a hand-maintained mobile mirror of `packages/shared` lock helpers (pre-existing tech debt, untouched).

## Next steps
1. Run the app in Expo Go and eyeball every screen/phase (dashboard buckets incl. an ignored-past plan landing in Done; the action panel countdown; the voting AddComposer; the wizard's new details/deadlines steps; the bottom-tab pill + avatar -> Account back).
2. When happy, decide the integration path for this branch (it bundles DRP-42 redo + DRP-43-era renames + DRP-44 polish): open a PR into `dev`.
3. Optional server hardening: have `computeBaseStatus` return a terminal state rather than `awaiting` for resolved+no-response; add future-time validation to `TimeCandidateInput`.
4. Optional further unification not done: member-picker rows already use `PersonRow`; the `Band` primitive exists but `EventDetail`'s `CountdownBanner` builds on it directly while the dashboard panel uses a `tone` Card - acceptable divergence (contained vs full-bleed) but could be reconciled.

## References
- Spec: `docs/superpowers/specs/2026-06-04-mobile-polish-unify-design.md`
- Status logic + tests: `apps/mobile/src/lib/status.ts`, `apps/mobile/src/lib/status.test.ts`
- Copy: `apps/mobile/src/lib/copy.ts`; format helpers: `apps/mobile/src/lib/format.ts`
- Primitives: `apps/mobile/src/ui/*` (+ barrel `index.ts`); theme tokens: `apps/mobile/src/theme.ts`
- Screens: `apps/mobile/src/screens/*`; nav: `apps/mobile/App.tsx`; wizard steps: `apps/mobile/src/lib/redo.ts`
- Server status model: `apps/api/src/routers/events.ts` (`computeMyStatus`/`computeBaseStatus`/`resolveMomentEnd`/`settleCollecting`)
- Linear: DRP-44 (Done) - https://linear.app/drp-02/issue/DRP-44
- Commits: `775711e..b20b1b3` (11 commits, all tagged DRP-44)
