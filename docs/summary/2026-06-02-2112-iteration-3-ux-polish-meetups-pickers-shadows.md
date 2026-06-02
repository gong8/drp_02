# Iteration 3 build + a long UX-polish iteration (meetups screen, pickers, banners, shadows) - 2026-06-02

**Branch:** `dev` (all committed, nothing PR'd to `main` this session) | **PRs:** none opened | **Scope:** Implement BeThere "iteration 3" (deadline auto-lock, private opt-out, local reminders, create-flow QOL) end-to-end, then iterate hard on the mobile UX with the user across many small rounds - date/time picker, the EventDetail plan header + full-bleed countdown banners, the "Your meets" dashboard (multiple redesigns), the Action Required state machine, and a long-running "filled hard shadow" consistency fix.

## TL;DR
This session first implemented all of iteration 3 from an approved plan (see the earlier summary `docs/summary/2026-06-02-1838-iteration-3-lockin-optout-reminders.md` for the plan/backend detail), then spent the bulk of its time on **interactive UX refinement** driven by the user reacting to the running app. Major outcomes: a split-pill date/time control, full-bleed pink "banner" motif for all time-pressured things (lock/moment countdowns and the dashboard's Action Required), a hero time-banner plan header, removal of pre-lock vote counts (privacy), an Action-Required state machine that keys off whether you've actually answered (new `iResponded` + `unrespond`), and the "Your meets" screen rebuilt several times before settling on: **full-bleed Action Required panel → tabs (All/Going/Awaiting/Declined, history included) → plans**. A recurring lesson: **HTML mockups in the visual companion don't faithfully match the RN render** (fonts/scaling), so mid-session we pivoted to iterating directly on the real app. End state: everything typechecks/lints, iOS+web bundles export clean, backend smoke tests pass; **on-device visual verification by the user is the ongoing loop** (a couple of items, e.g. the chip shadow, were still being confirmed at session end).

## What was done

### Iteration 3 core (committed `a78456d`..`2f628e2`, plus the Metro fix `11d441b`)
This was the planned work (full detail in the 1838 summary). Recap of what shipped:
- **Deadline + auto-lock:** `events.lockAt` column; `defaultLockAt` helper (shared, "evening before", clamped); lazy `settleCollecting` auto-locks the best slot at the deadline (no scheduler); `momentEnd` clamps the moment to end by the event; `addCandidate` rejects slots before the deadline; `__DEV__`-only "Force lock now" (no user-facing early lock). Single flexible time allowed (`WhenInput` options `min(1)`).
- **Private opt-out:** `eventOptOuts` table + `setOptOut`; "I can't make it" row in CollectingView; fully private; reversible.
- **Local reminders:** `expo-notifications` (`lib/notifications.ts`, `syncReminders`) - device-local scheduled pings, no dev build.
- **Create-flow QOL:** concrete toggle (Flexible/Fixed), quick-picks (`lib/quickpicks.ts`), description field, optional/mandatory labels.
- **Metro fix (`11d441b`):** mobile cannot *value*-import `@bethere/shared` (its barrel uses `.js`-suffixed re-exports that Metro can't resolve, only tsx/tsc can). `defaultLockAt` was copied into `apps/mobile/src/lib/lock.ts`. **This constraint still holds - do not value-import `@bethere/shared` from mobile; types-only is fine.**

### UX iteration rounds (the bulk of the session; commits `5966dd3`..`a9540b2`)

**Date/time control (`DateTimeField`, new `DateTimePill`)**
- `DateTimePill` (`fc18786`): one bordered hard-shadow box split by an ink hairline into `date | time`, each half a `bare` `DateTimeField` (new `bare` prop strips the half's own border/shadow/label). Replaced the old "card wrapping two boxes + a TIME label" everywhere (create exact/flexible/deadline, EventDetail add-a-time). The create form's split pill was explicitly **not** to be changed later.
- Placeholder saga (`bc941b2` then `9afbc80`): user wanted the redundant "Pick a date/time" title removed from the **picker sheet**, NOT the empty-trigger placeholder. First over-removed both; restored the empty-trigger placeholder ("Pick a date"/"Pick a time"), sheet has no title.
- Remove-a-time control (`a082ac9`): the inline bare ✕ resized the pills (flex sibling). Replaced with a tidy **circular badge floated on the pill's top-right corner** (absolute → pill stays full-width, never resizes).

**EventDetail (plan detail) screens**
- Full-bleed countdown banners (`5966dd3`, earlier `cf9d303`): the lock/moment countdown is a **full-bleed pink bar** (edge-to-edge, ink rules top+bottom, big mono countdown), not a rounded card. `CountdownBanner` is shared by collecting ("Locks in") and moment ("Closes in").
- Hero time-banner header (`4a0c49c`): the cramped time chip became a **hero**: a bold mono `SAT 6 JUN / 7:00 PM` block split by an ink rule from the title + "at <location>" body (shown once a slot is locked; collecting shows just title+location). New `dayUpper`/`clock12` format helpers (12h).
- Privacy (`97cb5c5`): `events.get` no longer returns per-candidate `count` - nobody (not even creator) sees how many are free per slot before the lock.
- Card clip (`6c7bcc8`): `Card` got `overflow: hidden` so full-bleed rows (the tinted opt-out row) don't poke square corners past the radius.
- Moment "Change my answer" un-commits (`c4db5e4` + `6e62907`): pressing Change now calls a new `events.unrespond` (clears the response) so the plan returns to Action Required until re-answered.

**Dashboard ("Your meets") - rebuilt several times**
- `ActionCard` with **draining countdown bar** (`4a4c5de`): each Action-Required item shows title+group, the explicit action ("Say if you're in ›" / "Pick your times ›"), a live deadline ("closes 22m"/"locks 16h"), a green→pink **drain bar** (width = time left), and the specific time/`N OPTIONS`. Needs `createdAt`+`momentStartsAt` from `events.mine` (`2c73535`) for the bar window. A 1s ticker drives live countdowns/bars.
- Sticky headers (`dad8582`): `ScreenBackground` gained a fixed `header` slot; every screen's title/back-bar moved out of the ScrollView so it pins while content scrolls.
- Several simplification passes: removed tabs → "Needs you/Coming up" sections (`73dcb77`), then a full-bleed Action Required banner + Show/Hide-past toggle (`12f7166`), then the banner made to **cover** its cards as one panel + past toggle dropped (`ff407fb`), then **tabs brought back** with history living in the list (`aebaf47`). Net final structure (see Current state).
- Action Required state machine (`c4db5e4`): a plan leaves the tray once you've made your choice (collecting: ticked ≥1 time; moment: answered at all via `iResponded`, so a blind "I'll go if" also clears it), and returns if you reverse it (untick all / Change). "Going" plans sort to the top of the list.

**Cross-app polish**
- Safe-area (`ba98d4a`): `ScreenBackground` adds `insets.top + 14` so headers/back-button clear the notch.
- Keyboard (`fb4f00b`): CreateEvent wrapped in `KeyboardAvoidingView` + `keyboardShouldPersistTaps="handled"` + `keyboardDismissMode="on-drag"`.
- Day-of-week everywhere; "Change my answer" promoted to a clear outline button.
- **Hard-shadow consistency (`b715a6a`, `a9540b2`):** user repeatedly flagged chip/sticker shadows looking like a hollow "outline" not a filled drop shadow. First bumped `Chip`/`StickerTag` `HardShadow offset` 2→3. User said still wrong; diagnosed the real cause as **shape**: a full pill (`borderRadius: 999`) only ever gets a thin crescent shadow; cards look filled because they're rounded *rectangles* (the shadow fills the corner). Changed `Chip` to a rounded-rect (`borderRadius: ui.rInput` = 12). **This was unverified at session end** (the user's confirming screenshot failed to attach - arrived as a blank PNG placeholder).

## Key decisions & rationale
- **Banner motif for everything time-pressured.** The user's instinct: reuse the full-bleed pink banner (from the lock/moment countdowns) for the dashboard's Action Required, so "urgent/attention" reads identically everywhere. Action Required became a full-bleed pink **panel that wraps its cards** (not a rounded box, not a thin header) - the old tray reimagined edge-to-edge.
- **Counts removed pre-lock (privacy).** Deliberate: no one, not even the creator, sees who's free for each slot before the auto-lock picks the winner server-side.
- **`iResponded` over `myStatus` for "needs action".** `myStatus === "awaiting"` can't distinguish "no answer" from a blind conditional ("I'll go if", which stays awaiting). Added `iResponded` (any yes/no/conditional on record) so answering in any way clears Action Required. **Change un-commits** (via `unrespond`) so the plan re-enters Action Required if you reopen and don't re-answer - the user explicitly wanted "press change then nothing → back to action required".
- **History via tabs, not a separate screen/toggle.** Tried: hide past entirely; a "Show past" toggle (user disliked it); a dedicated Past screen / per-group history (offered). User chose "tabs like before, with All and stuff" - so the All/Going/Awaiting/Declined tabs returned and the list includes past plans (upcoming first, then most-recent past). "All" doubles as history.
- **Pivot away from HTML mockups to real-app iteration.** The visual companion (superpowers brainstorming) was used for several rounds (date/time, collecting, plan header, dashboard simplification) and the user picked directions ("split pill", "1 for sure", Direction B hero). But mockups consistently mis-rendered vs RN (system-ui vs Archivo/Inter, fixed-height frames, overlapping FAB), which **frustrated the user and wasted effort**. Mid-session we stopped mocking and started editing the real screen so the user judges the actual render. Workflow-generated mockups were noticeably lower quality than hand-authored ones.
- **Shadow consistency = shape, not offset.** The "outline vs filled" perception on chips came from the pill shape (crescent shadow), not the offset px. Fix is a rounded-rect.
- **Commit in modular chunks** (per a CLAUDE.md rule added earlier): every coherent step is its own commit on `dev`.

## Things learned / discovered
- **Visual companion fidelity gap:** HTML mockups can't match the RN app (fonts, scaling, layout engine). Good for *layout direction*, bad for *look*. Hand-authored mockups >> workflow-farmed ones. For polish, iterate on the real app.
- **Pill shadows look like outlines:** `HardShadow` (a solid ink rect offset behind the child) on a `borderRadius: 999` pill renders a thin tapering crescent; rounded rectangles get a chunky filled-corner shadow. All app hard shadows go through `ui/HardShadow.tsx` (no native blurry `shadow*`/`elevation`); offsets are now 3 (small: Field, DateTimePill, BackBar, Chip, StickerTag) or 4 (cards/buttons). `DateChip` is deliberately flat (border only, no shadow).
- **Metro vs `@bethere/shared` barrel** (carried from earlier): value-importing shared into mobile breaks the bundle (`.js`-suffixed re-exports). Keep mobile→shared imports type-only; duplicate tiny pure helpers (`lib/lock.ts`).
- **`expo-notifications` ~0.32.17 (SDK 54):** DATE trigger is `{ type: SchedulableTriggerInputTypes.DATE, date }`; local scheduled notifications work in Expo Go (remote push dropped in SDK 53). Verify on device.
- **jest-expo hangs/doesn't flush** its summary in this sandbox (still exits 0). Verified pure logic via `tsx` scripts and the jest exit code; don't block on jest stdout.
- **Bash cwd persists between tool calls.** A stray `cd apps/mobile/src` made a later `pnpm lint` and `git add` fail ("Command 'lint' not found", pathspec errors). Always `cd /Users/gong/Programming/drp_02` first or use absolute paths.
- **Backend smoke pattern:** throwaway `appRouter.createCaller({ userId, log })` scripts under `apps/api/src/_smoke-*.ts`, run with `pnpm --filter @bethere/api exec tsx ...`, deleted after. Used to verify auto-lock/opt-out (20 assertions) and the `iResponded`/`unrespond` state machine (8 assertions).
- **`events.mine` now returns** `createdAt`, `momentStartsAt`, `lockAt`, `msLeftToLock`, `iResponded` (additive; no schema change for the latter three beyond the iteration-3 `lockAt` column).

## Current state
- All work committed to **`dev`**; tip `a9540b2`. Not PR'd to `main`.
- **"Your meets" final structure:** sticky "Your meets" title → full-bleed pink **Action required** panel (covers the action cards; count on the right; only if items) → **tabs** (All/Going/Awaiting/Declined) → list of `MeetCard`s (history included: upcoming soonest-first, then past most-recent-first) → floating "Suggest a meetup" CTA. No count-badge circle, no Show/Hide-past toggle.
- **Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm --filter @bethere/api test` (14) green; iOS + web `expo export` bundles clean after each change; backend smokes passed (then deleted).
- **Pending on-device confirmation:** the chip rounded-rect shadow fix (`a9540b2`) - user's confirming screenshot didn't attach; ask them to fully reload (press `r`) and re-share. Also all the interaction flows (auto-lock, reminders firing, drain bars, opt-out, Action Required enter/exit on focus refetch) need a real Expo Go pass.
- **Code locations:** dashboard `apps/mobile/src/screens/Dashboard.tsx` (ActionPanel, ActionCard, MeetCard, tabs, list); detail `EventDetail.tsx` (CountdownBanner, hero header, CollectingView, MomentView); pickers `ui/DateTimeField.tsx`(+`.web`,`.types`), `ui/DateTimePill.tsx`; `ui/Chip.tsx`, `ui/StickerTag.tsx`, `ui/Card.tsx`, `ui/ScreenBackground.tsx`; create `screens/CreateEvent.tsx`; API `apps/api/src/routers/events.ts`; helpers `apps/mobile/src/lib/{format,quickpicks,lock,notifications}.ts`.

## Conventions, commands & workflows
- **Commit in modular chunks** on `dev`; PR `dev`→`main` to ship. Each commit message ends with the Claude co-author trailer.
- Run from repo root: `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bethere/mobile exec expo export --platform ios|web --output-dir /tmp/x` (bundle check). `pnpm format` auto-fixes. **No em dashes.**
- Hard shadows: always via `ui/HardShadow.tsx`, offset 3 (small) or 4 (cards/buttons); never native `shadow*`/`elevation`. Rounded rects (not pills) so shadows read filled.
- Time-pressured UI = full-bleed pink banner motif (`CountdownBanner` / dashboard `ActionPanel`).
- Mobile imports `@bethere/shared` **type-only**; duplicate tiny pure helpers if needed.
- Iterate UX on the **real app** (reload Expo Go), not HTML mockups, for look/feel.
- The visual companion (superpowers brainstorming) server lives under `.superpowers/brainstorm/` (gitignored); start/stop scripts under the superpowers plugin cache. Stop it when done.

## Known issues / caveats / risks
- **Chip shadow fix unverified on device** (screenshot didn't load). May need a different value or the user may still see the pill/old build (full reload required).
- **Lazy auto-lock + Action-Required transitions update on read/focus**, not live cross-screen - a plan moves in/out of Action Required when you return to the dashboard (focus refetch), not while you're on the detail screen. Intended, but worth confirming it feels right.
- **`unrespond` on "Change" is destructive:** pressing Change deletes your moment answer immediately; navigating away without re-answering leaves you un-committed (by design).
- **Local notifications are device-local + seen-only; no remote push** (carried tech-debt). `expo-notifications` behavior in the team's Expo Go still needs a real-device check.
- **`DateChip` is intentionally flat** (no shadow). If the user wants total shadow uniformity, it'd need one.
- **History sort:** "All" shows upcoming-then-recent-past; if a plan just cleared (startsAt ~ now) it drops to the past section quickly - confirm that's acceptable.
- Context window hit ~91% at session end; this summary is the handoff.

## Next steps
1. **User reloads Expo Go (full reload, `r`)** and confirms: chip/sticker shadows now read as filled; the date/time empty-trigger placeholder is back; remove-time badge looks clean and doesn't resize pills; the Action Required panel + tabs + history feel right.
2. If the chip shadow still looks like an outline, get a *working* screenshot and target the exact element (could be `DateChip`, the corner remove badge, or a non-reloaded build).
3. Device pass on the iteration-3 interactions (auto-lock flipping to moment, reminders firing, drain bars, opt-out, conditional answering).
4. When the UX settles: `pnpm lint && typecheck && test`, then PR `dev` → `main`.
5. Update Linear (DRP_02) - tracking has been stale (MCP unauthenticated).

## References
- Prior (same-day) summaries: `docs/summary/2026-06-02-1838-iteration-3-lockin-optout-reminders.md` (plan + backend detail), `2026-06-02-1553-...`, `2026-06-02-1547-your-meets-card-redesign.md`.
- Plan file: `~/.claude/plans/docs-drp-context-interviews-m3-interview-lexical-sprout.md`.
- Tech debt: `docs/tech-debt.md`. Conventions: `CLAUDE.md`, `ARCHITECTURE.md`.
- Key commits this session: `fc18786` (split pill), `cf9d303`/`5966dd3` (banners), `4a0c49c` (hero header), `97cb5c5` (counts removed), `4a4c5de`/`2c73535` (drain-bar cards), `c4db5e4`/`6e62907` (Action Required state machine + `unrespond`), `aebaf47` (tabs+history), `a082ac9` (corner remove), `b715a6a`/`a9540b2` (shadow fixes).
