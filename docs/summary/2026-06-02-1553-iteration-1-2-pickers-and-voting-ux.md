# Iteration 1 & 2: native date/time pickers, add-time-while-voting, and a voting-screen UX redesign - 2026-06-02

**Branch:** `dev` | **PRs:** none opened this session (work committed to `dev`; recent merged PR #29 "feat: iteration 1") | **Scope:** Mobile create/vote flow - gate whenModes per iteration, replace free-text date/time with native pickers, add member-proposed times during voting, fix a timezone bug, and redesign the confusing react-vs-lock voting UX.

## TL;DR
This session built up the BeThere "Suggest a meet" and voting flows in presentation-driven iterations. Iteration 1 hid the `options`/`fuzzy` whenMode buttons (leaving only `exact`) and replaced free-text date/time inputs with the inbuilt native iOS picker (`@react-native-community/datetimepicker`), themed and wrapped in a reusable `DateTimeField` component (with a web fallback using browser `<input type=date/time>`). Iteration 2 re-enabled the `options` button and added a cross-stack feature: **any group member can add a new candidate time during the collecting/voting phase** (new `events.addCandidate` tRPC mutation, verified end-to-end via an in-process smoke test). Along the way we fixed a real "times land one hour off" bug (Hermes parses offset-less date strings as UTC), removed the Done button on pickers (save-on-dismiss), unified the time-entry UI into boxed cards with 50/50 date/time, removed redundant field labels, and - via a design-panel workflow - redesigned the voting screen so reactions **auto-save on tap** (no submit button) and the creator's **lock lives alone in a fenced "Organizer" zone**. All changes are mobile-only except the `addCandidate` backend mutation + shared schema. `pnpm typecheck`/`lint`/`test` are green; the only un-verified-on-device piece is the final voting redesign (needs an Expo Go re-test).

## What was done (chronological)

### 1. Iteration 1 - exact-only create flow with native pickers (committed; part of merged PR #29)
- **Hid `options` and `fuzzy` whenMode chips** in `apps/mobile/src/screens/CreateEvent.tsx` by commenting out those entries in the `MODES` array (kept, not deleted - JSX blocks and backend untouched). Left the single "Set a time" chip (user chose "keep the single chip" over "hide selector entirely").
- **New reusable component `apps/mobile/src/ui/DateTimeField.tsx`** wrapping `@react-native-community/datetimepicker` (installed via `pnpm --filter @bethere/mobile exec expo install ...`, resolved to **v8.4.4** for SDK 54). iOS nuance baked in: **date = `display="inline"` + `accentColor` (brand pink)**, **time = `display="spinner"` + `minuteInterval` + `textColor`** (because `accentColor` is ignored in spinner mode and `minuteInterval` only works in spinner mode on iOS). Trigger mirrors the `Field` look; opens the picker inside the existing `BottomSheet`. Output strings stay `"YYYY-MM-DD"` / `"HH:mm"`, byte-compatible with the existing `isoFrom` so the API payload is unchanged.
- **Web fallback `DateTimeField.web.tsx`** (+ shared `DateTimeField.types.ts`): the package has no web build and its entry pulls in native-only components, so a platform-specific file keeps it out of the web bundle entirely (verified: `expo export --platform web` built clean with **0** picker refs). Web uses raw `<input type="date">` / `<input type="time" step={900}>` styled to match - their value formats already equal our state strings, so no conversion.
- **User-chosen time granularity:** native wheel at **15-minute** steps (`minuteInterval={15}`).

### 2. Iteration 2 - re-enable `options` + add-time-while-voting
- **Re-enabled the "A few options" chip** (uncommented in `MODES`); only `fuzzy` remains commented for iteration 3. Each option row now uses `DateTimeField` pickers (consistent with exact mode).
- **New feature: any member can add a candidate time during `collecting`.**
  - Shared schema: `AddCandidateInput = z.object({ eventId, startsAt })` in `packages/shared/src/schemas.ts` (auto-exported via `export *`).
  - Backend: `events.addCandidate` mutation in `apps/api/src/routers/events.ts`. Guards mirror `react`/`lock`: event exists (NOT_FOUND) -> `requireMember` (any member, FORBIDDEN otherwise) -> `phase === "collecting"` (BAD_REQUEST) -> valid date. **De-dupes identical minutes** (returns the existing candidate id). New candidate id = `${eventId}_c_${randomUUID()}`, `partOfDay: null`, no author column needed.
  - Mobile: inline "+ Add a time" control in `CollectingView` (`apps/mobile/src/screens/EventDetail.tsx`); parent `addCandidate()` calls the mutation then `load()`.
  - **No DB schema change** - `eventCandidates` already has no `createdBy`.
  - **Verified end-to-end** with a temporary in-process `appRouter.createCaller` smoke test against the local Postgres (migrate + reseed): 10 assertions passed (creator add 2->3, dedup, member add 3->4, FORBIDDEN non-member, BAD_REQUEST on exact/non-collecting, NOT_FOUND unknown). Smoke script deleted afterward.

### 3. UI refinements on the time-entry surfaces
- **Add-a-time form boxed in a `Card`** (user feedback: floating form looked "messy"). Unified the look.
- **Done button removed from the iOS picker sheet** (user request "better UX"): the picker now saves live on `onChange`, and crucially **commits the shown value on dismiss** (`onClose`) so an untouched default still gets saved (fixed the "if the time is already the one I want, closing doesn't set it" bug).
- **50/50 date/time everywhere** (`flex: 1` each), including option rows.
- **Each "Option N" boxed in a Card** with a clean "Remove" text action in the header (replaced the ugly bare `x`).
- **Compact, right-aligned "Add" button** + hide the react/lock actions while the add form is open.
- **Removed redundant "DATE"/"TIME" field labels** (made `label` optional on `DateTimeField`; dropped from all 6 call sites) - the box already says "Pick a date/time".

### 4. Timezone bug fix ("all times one hour off")
- **Root cause:** `isoFrom` did `new Date("2026-06-05T19:00:00")` (no offset). The spec says parse offset-less date-time as **local**, and V8/web do - but **Hermes (React Native) parses it as UTC**. In BST (UTC+1, UK in June) 19:00 became `19:00Z`, which displayed back as 20:00. Device-only bug (web was fine).
- **Fix:** never parse an offset-less string - build the Date from numeric components (`new Date(y, m-1, d, h, min)`, local in every engine). Centralized in a shared `isoFrom` in `apps/mobile/src/lib/format.ts` (de-duped the two screen-local copies) and the picker's `seed`/`displayValue` parses.
- **Verified** with a Node repro under `TZ=Europe/London`: new code -> `18:00Z` -> displays 19:00 (correct); Hermes-style UTC parse -> `20:00` (the bug).

### 5. Voting-screen UX redesign (react vs lock confusion)
- **Problem:** "These work for me" (member react) and "Lock it in" (creator) read as equal-weight sibling buttons - unclear which to press / the sequence.
- **Process:** ran a **design-panel Workflow** (3 independent redesign proposals from distinct lenses - minimal relabel, auto-save, organizer-zone - then a synthesis/judge pass; 4 agents, ~153k tokens). Presented the synthesized recommendation + 2 alternatives to the user via `AskUserQuestion`.
- **User chose "Auto-save, lock alone"** (the cleaner long-term model; panel's recommendation was actually the lower-risk "fenced organizer card + keep submit", but user opted for the more elegant one).
- **Implemented:**
  - **Reactions auto-save on tap**: `toggleReact` toggles optimistically + `flushReact` saves after a 500ms debounce. **No "These work for me" button.** No refetch after save (the `seededFor` guard already prevents the 5s poll from re-seeding/clobbering optimistic picks). `flushReact()` also runs on screen blur so the last tap isn't lost. Failures are swallowed (next poll reconciles).
  - **Creator lock alone in a fenced "ORGANIZER" zone** (labelled divider + Card), disabled until `readyToLock`, and **names the winning slot** in its label ("Lock in Fri 5 Jun, 19:00"). The slot is computed client-side (max count, earliest tiebreak) and **passed as `candidateId` to `lock()`** so the label and the actually-locked time can't disagree.
  - Members see no buttons in the list (just tap + optionally add); subtitle "saved automatically, private to you"; empty-state line "Nothing works? Leaving them all unticked is a fine answer."

## Key decisions & rationale
- **`@react-native-community/datetimepicker` over third-party pickers:** it is bundled inside Expo Go (SDK 54), so it runs on the team's App Store Expo Go with **no dev build**. `react-native-date-picker` etc. need a custom dev build - unusable here.
- **Reusable `DateTimeField` + platform `.web.tsx`:** one component, native uses the inbuilt picker, web uses browser inputs; platform-file resolution guarantees the native-only module never enters the web bundle. Chosen over a runtime `Platform.OS` guard (which would still bundle the module on web).
- **Keep iterations gated by commenting `MODES` entries, not deleting:** presentation-driven rollout (iter 1 = exact, iter 2 = options, iter 3 = fuzzy). Backend/JSX stay intact so re-enabling is trivial.
- **Picker saves on dismiss (no Done button):** user wanted "just save the last state". Committing on `onClose` (not only on `onChange`) is what makes an untouched default save. Kept uniform for date and time (no auto-close) for predictability.
- **Build dates from components, not string parse:** the only engine-independent way to get local time; fixes the Hermes UTC-parse bug at the source rather than chasing it in display code. Considered Temporal - rejected (not reliable in Hermes yet); the `Date` object is fine, the parse was the bug.
- **`addCandidate` allows ANY member, gated only by `collecting` phase:** matches the product ask ("everyone should be able to add a time"). No `whenMode` restriction needed because exact plans never enter `collecting`. Dedup by identical minute avoids clutter from two proposers.
- **Voting redesign = auto-save + organizer zone:** the panel's key insight - the two buttons are confusing because they read as the *same kind* of thing when they're different categories (personal reversible answer vs one-way group decision). Fix by making them differ *in kind*. User picked auto-save (removes the competing button entirely) over the lower-risk "keep submit + fence the lock". Mitigated the risks the panel flagged (poll clobber, lost last tap, out-of-order saves, label/lock mismatch).
- **Lock passes `candidateId` (the client-named slot):** so the button label ("Lock in <slot>") and the locked time always agree. Safe because the max-count candidate always meets quorum when `readyToLock` is true, and `lock()` validates the id server-side.

## Things learned / discovered
- **Hermes Date parsing:** `new Date("YYYY-MM-DDTHH:mm:ss")` (no offset) is parsed as **UTC** by Hermes, **local** by V8 - the classic RN off-by-timezone-offset bug. Always construct from numeric components for local wall-clock times.
- **`@react-native-community/datetimepicker` iOS quirks:** `minuteInterval` only takes effect in `display="spinner"`; `accentColor` only applies in `inline`/`compact` (ignored in spinner, where `textColor` works instead). Hence date=inline, time=spinner.
- **The picker has no web build** (`src/index.js` imports native-only `./datetimepicker`); needs a `.web.tsx` sibling to stay out of the web bundle.
- **`expo install` side effects:** it auto-added `@react-native-community/datetimepicker` to `app.json` `plugins` (a no-op in Expo Go, only matters for prebuild) and reformatted `app.json` (Biome then re-collapsed the `platforms` array via `pnpm format`).
- **Drizzle `timestamp` columns are plain `timestamp` (no tz)** in `schema.ts`; they round-trip correctly as long as the API server's tz is consistent. The client parse was the only timezone bug. (A future `timestamptz` migration would be the bulletproof move but was not needed.)
- **No tRPC procedure/DB integration-test harness exists** - existing tests are auth-resolution (`apps/api/src/auth/resolve.test.ts`, node:test) and shared logic (`packages/shared/.../candidates.test.ts`, vitest). For the `addCandidate` feature we used a throwaway `appRouter.createCaller` script against the live local DB and deleted it; nothing DB-dependent is in CI.
- **Local DB:** docker-compose Postgres on host port **5433**, creds `drp:drp@localhost:5433/drp` (in `apps/api/.env`, with `DEV_AUTH_BYPASS=1`). API boots run `migrate` + seed (`SEED_ON_BOOT=reset` locally); seed creates user `u_dev` ("You") in groups.
- **Biome `pnpm lint` is check-only; `pnpm format` writes fixes.** Bash working directory persists between tool calls (a stray `cd apps/mobile` earlier caused a later `pnpm lint` to run in the wrong dir).
- **Linear MCP is not authenticated this session** - could not create/move the DRP_02 issue per CLAUDE.md; flagged to the user.

## Current state
- All work is on **`dev`** (uncommitted in the working tree at session end - the git facts show a clean tree but that snapshot predates this session's edits; the recent commits `4433438 feat: iteration 1, date and time`, `5cc0984 feat: various frontend aesthetic changes`, `7037a28 feat: action required bit at the top` are prior/related work, and PR #29 "feat: iteration 1" is merged). **The session's edits were NOT committed** - user has repeatedly been offered a commit and deferred.
- **Verified:** `pnpm typecheck`, `pnpm lint`, `pnpm test` all green after every change; `addCandidate` verified via in-process smoke test; timezone fix verified via Node repro; web bundle verified via `expo export`.
- **Not verified on device:** the picker dismiss-commit fix, the label removal, and especially the **voting-screen auto-save redesign** - all need an Expo Go (iOS) re-test. The auto-save interaction model is the highest-risk un-device-tested change.
- **Files touched this session:**
  - `apps/mobile/src/ui/DateTimeField.tsx` (new), `DateTimeField.web.tsx` (new), `DateTimeField.types.ts` (new)
  - `apps/mobile/src/ui/index.ts` (export `DateTimeField`)
  - `apps/mobile/src/screens/CreateEvent.tsx` (gate modes, pickers, boxed option cards, shared `isoFrom`)
  - `apps/mobile/src/screens/EventDetail.tsx` (add-time UI, auto-save reactions, organizer zone, shared `isoFrom`)
  - `apps/mobile/src/lib/format.ts` (new shared `isoFrom`)
  - `apps/mobile/package.json` + `app.json` (picker dep + plugin)
  - `apps/api/src/routers/events.ts` (`addCandidate`)
  - `packages/shared/src/schemas.ts` (`AddCandidateInput`)

## Conventions, commands & workflows
- **Run before any PR:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (all from repo root). Auto-fix formatting with `pnpm format`.
- **Use `pnpm` only**; workspace monorepo with `node-linker=hoisted`.
- **Branching:** work directly on `dev`; PR `dev` -> `main` to ship. Never push to `main`.
- **No em dashes** anywhere (use hyphens). Define data shapes as Zod in `packages/shared`, expose via tRPC; mobile types follow automatically.
- **Install Expo-compatible native deps** with `pnpm --filter @bethere/mobile exec expo install <pkg>` (picks the SDK-54-compatible version).
- **Do NOT upgrade Expo above SDK 54** (Expo Go compatibility).
- **Run the app:** `pnpm dev:api` (port 3000, needs `pnpm db:up`) + `pnpm dev:mobile` (Expo). DB: `pnpm db:up`/`db:down`.

## Known issues / caveats / risks
- **Voting auto-save is the riskiest un-tested piece.** Debounced (500ms) saves can in principle complete out of order; mitigated by the debounce coalescing rapid taps and each save carrying the full set, but rapid alternating taps under bad network could theoretically land stale. Failures are swallowed - a genuinely failing save leaves optimistic state diverged until the next 5s poll (acceptable for demo, not for production).
- **Client-derived "best slot" vs server `pickWinningCandidate`:** we pass `candidateId` so they agree, but the two ranking functions could differ on tiebreak if logic changes later - keep them consistent.
- **DB columns are `timestamp` without tz** - safe under a single consistent server tz; a mixed-tz deployment would need `timestamptz` (migration).
- **No DB-integration test in CI** for `addCandidate` - only the (deleted) manual smoke test covered it.
- **Linear not updated** - DRP_02 issue tracking is stale for this session's work.
- **Picker time wheel dismissal** relies on tapping the backdrop (no Done button); discoverable but worth confirming on device.

## Next steps
1. **Device re-test in Expo Go (iOS):** the voting auto-save + organizer zone, the picker dismiss-commit, the timezone fix (confirm times are no longer an hour off), and label removal.
2. **Commit to `dev`** (user has deferred repeatedly) - suggested message scope: "feat: iteration 2 options + add-time-while-voting + native pickers + voting UX redesign + tz fix".
3. **Update Linear** (DRP_02) once the MCP is authenticated - log iterations 1-2 and reference the commit.
4. **Iteration 3:** re-enable the `fuzzy` ("Whenever suits") whenMode (uncomment in `MODES`, wire/verify the fuzzy create + day-candidate flow).
5. **Consider** a `timestamptz` migration and a lightweight tRPC-procedure test harness if this graduates past demo stage.

## References
- `apps/mobile/src/ui/DateTimeField.tsx` / `.web.tsx` / `.types.ts` - the picker component + web fallback + shared props.
- `apps/mobile/src/screens/CreateEvent.tsx` - "Suggest a meet" (mode gating, boxed option cards).
- `apps/mobile/src/screens/EventDetail.tsx` - voting/collecting + moment + reveal; `CollectingView` holds the redesigned auto-save + organizer zone.
- `apps/mobile/src/lib/format.ts` - shared `isoFrom` (component-based, the tz fix).
- `apps/api/src/routers/events.ts` - `create`/`react`/`lock`/`addCandidate`/`get`/`mine`/`respond`/`resolve`.
- `packages/shared/src/schemas.ts` - `WhenInput`, `ReactInput`, `LockInput`, `AddCandidateInput`, etc.
- `apps/api/src/db/schema.ts` - `events`, `eventCandidates`, `candidateReactions`, `responses`.
- Memory: `~/.claude/.../memory/create-flow-iteration-roadmap.md` - the living roadmap/decision record for this work.
- CLAUDE.md, ARCHITECTURE.md - project conventions and the convergence model.
- Design-panel workflow script: `.../workflows/scripts/voting-screen-ux-redesign-wf_c2e4e688-0a8.js` (run id `wf_c2e4e688-0a8`).
