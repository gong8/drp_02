# UX Overhaul (Refined Neobrutalist): Brainstorm to Shipped - 2026-06-01

**Branch:** `dev` (work done on `feat/drp-25-ux-overhaul`, merged via PR #25) | **PRs:** #25 MERGED (the overhaul), #27 OPEN (Vercel build config, user-driven) | **Linear:** DRP-25 | **Scope:** Brainstormed a new visual identity for the BeThere mobile app, specced + planned it, implemented it end to end via subagents, shipped it to `dev`, then fixed local dev-env papercuts.

## TL;DR
This session took BeThere's mobile UI from the old flat "Sage" look to a **refined neobrutalist** system (peach-to-lavender gradient, white boxy cards with 2px ink borders + hard offset shadows, Archivo/Inter/Space Mono type, pink + green accents) chosen through ~9 rounds of live browser mockups. It was then written up as a spec + a 19-task implementation plan, executed task-by-task with subagents (with reviews), and merged into `dev` as PR #25. Mid-execution we discovered the repo had drifted (a Clerk auth + web feature had landed on `dev`), so the nav plan was reworked into a 3-tab layout (Meetups/Groups/**Account**) and the new auth screens were restyled too. The session ended with dev-environment fixes: a new `pnpm kill` script to clear orphaned ports, and enabling the dev-bypass sign-in button locally.

## What was done

### 1. Brainstorming the visual identity (no code, browser mockups)
- Invoked `superpowers:brainstorming`, which offered a **visual companion**: a local web server (`http://localhost:54748`) that serves HTML mockups written to `.superpowers/brainstorm/8943-1780319357/content/`. The user accepted; all design exploration happened as rendered phone mockups in the browser.
- Read the current frontend (`apps/mobile/src/screens/*`, `theme.ts`) and the M2 hand-drawn mockups (`docs/mockups/m2/`).
- Iterated through roughly nine rounds, each a fresh HTML file of phone mockups:
  1. 4 home-screen directions (Sage current, Editorial Calm, Timeline, Bold Social).
  2. 9 visual identities with real Google web fonts (Editorial, Cobalt Pro, Midnight Lime, Coral Warm, Mono Brutalist, Lavender Soft, Forest Earthy, Sunrise Vibrant, Noir Minimal).
  3. 7 design languages pushed hard (BeReal, Editorial, Minimalist, Claymorphism, Skeuomorphism, Glassmorphism, Neobrutalist).
  4. 5 "Light BeReal x Claude" takes + 5 neobrutalist takes (emojis removed at user request).
  5. 5 BeReal colourways (Cobalt, Forest, Mono, Violet, Teal) after the user rejected the warm "Claude" palette.
  6. User pivoted: "scrap BeReal", be inspired by a supplied reference image (a neobrutalist dashboard with a grainy gradient), fewer colours, boxy cards over glassmorphic gradient backgrounds. Produced 5 variants (Clean Mono, Gradient+White Boxes, Frosted Glass, Colour-Fill, Rounded+Sticker).
  7. User ranked: liked #1 (Clean Mono), #5 (Rounded+Sticker), #4 (Colour-Fill); disliked #2 (too colourful), #3 (frosted glass). Produced 8 refined-neobrutalist iterations.
  8. User said the original Rounded+Sticker was the one; produced 6 gradient/accent variants of it. User chose **#1 Peach -> Lavender**.
  9. Applied the locked style to **all 7 screens** for review.
- The user loved it ("this is fantastic") and asked to document + log it.

### 2. Spec, mockup archive, Linear issue
- Wrote `docs/superpowers/specs/2026-06-01-ux-overhaul-visual-system-design.md` (tokens, type, components, per-screen scope, RN/Expo implementation notes, open questions).
- Saved a permanent, self-contained mockup of all screens to `docs/mockups/m3-ux-overhaul/all-screens.html` (openable without the companion server).
- Added `.superpowers/` to `.gitignore` (brainstorm scratch).
- Created Linear **DRP-25** (team DRP_02, labels HCD + Improvement) with a per-screen checklist. Commits `3868c18` (spec+mockups), and the gitignore.

### 3. Implementation plan
- Invoked `superpowers:writing-plans`. Resolved 4 decisions with the user first:
  - **Navigation:** user wanted to *see* options -> showed bottom-tabs vs top-switch -> chose **bottom tabs**.
  - **Accents:** two (pink brand/urgent + green going).
  - **Home layout:** featured card + filter tabs + checklist (a redesign of the old status-sectioned dashboard).
  - **Going data:** reveal "+N going" only **after the respond-by timer expires**, enforced server-side.
- Wrote `docs/superpowers/plans/2026-06-01-ux-overhaul-neobrutalist.md` (19 tasks, 4 phases, complete copy-paste code). Commit `e78393c`.

### 4. Execution via subagent-driven development
- User said "1 lets go!" -> `superpowers:subagent-driven-development`. Created branch `feat/drp-25-ux-overhaul` (massive feature -> `feat/*` per CLAUDE.md), moved DRP-25 to In Progress, tracked work with TaskCreate.
- Dispatched sonnet subagents, mostly per phase/screen, pointing them at the plan file for exact code:
  - **Phase 0** (`213a673`, `b028aaf`, `8fce6ed`): `expo install expo-linear-gradient expo-font @expo-google-fonts/{archivo,inter,space-mono}`; added `ui`/`font` tokens to `theme.ts`; loaded fonts in `App.tsx`.
  - **Phase 1** (`1723ce5`, `8def98d`): TDD `revealGoing` in `@bethere/shared` (3 vitest cases) + wired `events.mine` to return `goingCount`/`goingPreview` only when revealed.
  - **Phase 2** (`8a91930`, `e1e1bf5`, `65afff3`, `9f24d21`): the `apps/mobile/src/ui/` primitive library (16 components + barrel).
  - **Task 10** (`763a87e`): reworked for the auth-era App.tsx (see drift below) - 3 tabs Meetups/Groups/Account, hidden native headers, restyled tab bar, new `Account` screen, deleted `AccountButton`.
  - **Tasks 11-16** (`550f794`, `f7b2bac`, `392a606`, `41f4099`, `7ba15f5`, `5738984`): the six core screens.
  - **SignIn restyle** (`5fc8bf7`): done directly (single self-contained file).
  - **Phase 4** (`3049103`): removed the legacy Sage tokens, fixed lint, formatted; full gate green.
  - **Final review** + fixes (`64cd8c5`): added the **Declined** filter tab, replaced the hardcoded `"A"` header avatar with a real `AccountAvatar`, made `ScreenBackground` apply only the top safe-area inset, fixed an avatar list key (added `uid` to `goingPreview`), added a perf TODO for the N+1 in `events.mine`.
  - **Docs addendum** (`dd4e87e`): noted the auth-era adaptations in the spec + plan.
- Finished via `superpowers:finishing-a-development-branch`: verified tests, pushed, opened **PR #25** into `dev`, moved DRP-25 to In Review. The user merged it (`1069611`).

### 5. Post-merge dev-environment fixes
- User pulled `dev`, ran `pnpm dev`, hit two errors. Diagnosed and fixed:
  - **`EADDRINUSE :3000`**: six orphaned `tsx watch src/index.ts` API supervisors from earlier runs were squatting/contending on 3000. Killed them; freed 3000 + 8081.
  - **Mobile non-interactive failure**: `pnpm dev` runs `expo start --ios` under `concurrently` (no TTY); the simulator's Expo Go is 56.0.2 while the project is SDK 54, so Expo's "install Expo Go 54.0.7?" prompt cannot be answered and it bails. Advised running `pnpm dev:api` + `pnpm dev:mobile` in separate terminals and accepting the Expo Go 54 install once.
- Added **`pnpm kill`** (`scripts/kill-ports.sh`, commit `e0e002a`): kills the API `tsx watch` supervisor + `expo start`, then sweeps ports 3000/8081 (+ fallbacks). Postgres (5433) is intentionally excluded (use `pnpm db:down`).
- Answered "why is there no Continue-with-test-account button": it is gated by `devAuthEnabled = process.env.EXPO_PUBLIC_DEV_AUTH === "1"` (`apps/mobile/src/lib/clerk.ts`), which only `pnpm web` sets. Added `EXPO_PUBLIC_DEV_AUTH=1` to the local (gitignored) `apps/mobile/.env`; noted Metro must be restarted (`--clear`) because `EXPO_PUBLIC_*` is inlined at bundle time.

## Key decisions & rationale
- **Design system = refined neobrutalism, "Peach -> Lavender":** chosen by the user after a wide exploration. Distinct, high-contrast, accessible, cheap to build in RN, and matches the user-supplied reference. Vivid gradients and frosted glass were explicitly rejected (too colourful / GPU-costly / contrast risk).
- **Build a `ui/` primitive library first, then compose screens:** keeps the styling DRY and makes each screen a short composition, which both improves quality and let the plan show near-complete code per screen.
- **`HardShadow` primitive:** RN shadows blur and Android `elevation` cannot offset, so the crisp `4px 4px 0` neobrutalist shadow is faked with a solid ink View offset behind each card. This is the one genuinely non-obvious RN technique in the system.
- **Reveal "going" only after the timer, enforced server-side:** the user wanted the crowd hidden until the respond-by deadline (like the RSVP countdown). Implemented as a pure, unit-tested `revealGoing` in shared so `events.mine` returns `goingCount`/`goingPreview` only once resolved - not just hidden in the UI. Keeps the privacy intent truthful.
- **3-tab nav with an Account tab:** forced by the drift (see below). The user chose a third bottom tab for sign-out over a header control or a tap-the-avatar sheet, because hiding the native headers (for in-screen back bars) removed the old `headerRight` AccountButton.
- **Two accents (pink + green) over single pink:** clearer status semantics (urgent vs going) at the cost of one extra colour; the user accepted.
- **Feature branch + PR into `dev` (not local merge, never `main`):** per CLAUDE.md a massive feature uses `feat/* -> PR into dev`; a PR gives the team a review gate for a large visual change. Worktrees were avoided because subagents share one working directory.
- **Subagents pointed at the plan file rather than re-pasted code:** for long screen code, reading the exact committed plan section is more reliable than re-transcribing it into each prompt (a deliberate deviation from the skill's "paste full text" guidance), scoped with "implement only Task N".
- **`pnpm kill` kills the supervisor, not just the port:** a plain port-kill leaves `tsx watch` alive and it respawns a child on 3000, so the script kills the watcher by name first.

## Things learned / discovered
- **Repo drifted mid-session.** While brainstorming, a large **Clerk auth (Google OAuth) + Vercel web + API rate-limiting** feature merged into `dev` (PRs #21-#24; commits `0665921`..`61c0ac4`). The plan/spec had been written against the pre-auth `App.tsx` and screen set. On discovering it (the branch base was `61c0ac4`, not my doc commit, and `App.tsx` imported Clerk/SignIn/AccountButton), execution paused, re-read the current code, and re-planned Task 10. Lesson: **re-ground against the live tree before executing a plan**, especially after time has passed.
- **CLAUDE.md was updated mid-session** to pin **Expo SDK 54** (was 56) with a strong "do not upgrade above 54" note: the team tests on the App Store Expo Go, which lags new SDKs; pinning higher makes Expo Go reject the project. Use `expo install` to keep native dep versions SDK-aligned.
- **`pnpm test` hangs when piped** (`pnpm test | tail`): mobile `jest-expo` prints results then "did not exit" due to open handles, holding the pipe open forever. Verify `@bethere/shared` (vitest) and `@bethere/api` (node:test) separately, or expect the hang. Test counts: shared 12, api 6, mobile 5.
- **`expo start --ios` under `concurrently` is non-interactive** and dies on any prompt (here, the Expo Go version mismatch). The simulator had Expo Go **56.0.2** vs project **SDK 54** - the reverse of the usual problem. Fix: run mobile in its own TTY (`pnpm dev:mobile`) and accept the Expo Go 54 install once, or use a physical device's App Store Expo Go.
- **`EXPO_PUBLIC_*` env vars are inlined by Metro at bundle time** - changing `.env` requires restarting Metro (`expo start --clear`).
- **The dev-bypass "Continue as test user" button** is gated by `EXPO_PUBLIC_DEV_AUTH=1` (`apps/mobile/src/lib/clerk.ts`), only set by `pnpm web` and the CD APK build, never the hosted web deploy.
- **biome lint quirk:** `noArrayIndexKey` rejects React keys built from array indices; the fix added a stable `uid` to the `events.mine.goingPreview` shape rather than suppressing the rule.
- **Auth is still a dev stub server-side** (`ctx.userId` from `x-user-id`, default `u_dev`); the Clerk work is the client/token side. The open API + CORS are deliberate (see `docs/tech-debt.md`).

## Current state
- **Merged to `dev`** via PR #25 (commit `1069611`). The mobile app is fully restyled; tokens centralised in `theme.ts`; legacy Sage tokens removed. All quality gates were green at completion: `pnpm lint` (clean), `pnpm typecheck` (3 packages), `pnpm test` (23 tests).
- **DRP-25 is still "In Review"** in Linear even though PR #25 merged - it should be moved to **Done** (not yet done this session).
- **PR #27 is OPEN** (`build(web): Vercel builds only main, skips previews`) and **#26 "feat: UX overhaul" merged** - both are user-driven web-deploy tweaks; their exact provenance was not part of this assistant's work and is not fully verified here.
- **No on-device/simulator visual QA has been done** (the assistant is headless). Everything is typecheck/lint/test-green only.
- Local `apps/mobile/.env` now has `EXPO_PUBLIC_DEV_AUTH=1` (uncommitted, gitignored).

## Conventions, commands & workflows
- **pnpm only** (never npm/yarn). **No em dashes** anywhere (use hyphens). ESM in `apps/api`/`packages/shared` (relative imports end `.js`). Mobile imports `@bethere/api` type-only.
- **Branching:** routine work straight to `dev`; massive features `feat/* -> PR into dev`; only `dev -> main` PRs may merge to `main`; never push `main`. CI runs on PRs into `main`; CD (backend deploy + Android build) on push to `main`.
- **Do NOT upgrade Expo SDK above 54** until the team's Expo Go advances; prefer a dev build (`expo-dev-client`) as the real fix.
- **Commands:** `pnpm kill` (free dev ports), `pnpm dev:api` + `pnpm dev:mobile` (run separately, not the combined `pnpm dev`, to dodge the Expo Go prompt), `pnpm lint`/`typecheck`/`test`, `pnpm db:up`/`db:down`.
- **Commit trailer used this session:** `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Track work in Linear (team DRP_02) religiously: In Progress on start, comment decisions, Done with the PR on finish.

## Known issues / caveats / risks
- **Visual QA pending on a real device/sim** - the restyle compiles and typechecks but has not been seen rendered. Compare against `docs/mockups/m3-ux-overhaul/all-screens.html`.
- **Simulator Expo Go mismatch** (56 vs SDK 54) blocks `pnpm dev`'s `--ios` auto-launch; install Expo Go 54.0.7 in the sim once.
- **`events.mine` has an N+1** (one user query per going-preview member, up to 4 per event); fine at demo scale, TODO comment added.
- **CreateEvent dropped the Description field** to match the mockup (intentional, reversible; the API still accepts `description`).
- **`ScreenBackground` only pads the top inset** (the bottom tab bar owns the bottom) - deliberate, but watch for any screen that bottom-anchors content outside a tab.
- **DRP-25 not yet marked Done**; the open web-deploy PR #27 is unrelated to the overhaul.

## Next steps
1. **Run the app and do visual QA** on a device/sim: `pnpm kill`, then `pnpm dev:api` + `pnpm dev:mobile` (accept Expo Go 54 install; the test-user button now appears after a Metro `--clear` restart). Click the full loop and compare to the mockup HTML.
2. **Mark DRP-25 Done** in Linear now that PR #25 merged.
3. When ready to ship to production, open a `dev -> main` PR (CD then deploys backend + builds the Android APK). Coordinate with the open Vercel-build PR #27.
4. Optional polish from the final review (all low-stakes): consider batching the `events.mine` avatar lookups; revisit whether the decorative header avatar is wanted now that Account is a tab.

## References
- **Spec:** `docs/superpowers/specs/2026-06-01-ux-overhaul-visual-system-design.md` (section 9 = auth-era addendum)
- **Plan:** `docs/superpowers/plans/2026-06-01-ux-overhaul-neobrutalist.md` (19 tasks + execution addendum)
- **Mockup (open in browser):** `docs/mockups/m3-ux-overhaul/all-screens.html`
- **Design tokens:** `apps/mobile/src/theme.ts` (`ui`, `font`)
- **Primitives:** `apps/mobile/src/ui/` (HardShadow, ScreenBackground, Card, Button, Chip, Field, Tabs, Toggle, DateChip, StickerTag, StatusCheck, SelectCheck, Avatar, Heading, BackBar, BottomSheet + `index.ts`)
- **Reveal rule:** `packages/shared/src/logic/reveal.ts` (+ `reveal.test.ts`), consumed in `apps/api/src/routers/events.ts` (`mine`)
- **Nav + screens:** `apps/mobile/App.tsx`; `apps/mobile/src/screens/{Dashboard,EventDetail,CreateEvent,GroupsList,GroupDetail,CreateGroup,SignIn,Account}.tsx`; `apps/mobile/src/components/AccountAvatar.tsx`
- **Dev tooling:** `scripts/kill-ports.sh` (`pnpm kill`); auth flag in `apps/mobile/src/lib/clerk.ts` + local `apps/mobile/.env`
- **PR #25:** https://github.com/gong8/drp_02/pull/25 | **Linear DRP-25:** https://linear.app/drp-02/issue/DRP-25
- **Design palette:** bg gradient `#FCEFE8`->`#ECEAFF`, surface `#FFFFFF`, ink `#111111`, muted `#7D7A86`, pink `#FF5CA8`, green `#34A853`; fonts Archivo / Inter / Space Mono.
