# `pnpm demo` against live API + add-a-time picker crash fix - 2026-06-16

**Branch:** dev | **PRs:** none opened this session (committed straight to `dev`) | **Scope:** Add a `pnpm demo` script that runs Expo against the live deployed API, then root-cause and fix a hard crash when adding a time to a collecting plan whose window has elapsed; navigate parallel-agent coordination.

## TL;DR
This session did two things on `dev`. First, it added **`pnpm demo`** (`scripts/demo.sh`): a sibling of `pnpm phone` that launches Expo pointed at the **live production App Runner API** instead of a local DB+API. Second, it diagnosed and fixed a **native hard-crash** triggered by tapping "+ add a time" on a `collecting` plan whose entire time-candidate window had already elapsed (stale demo seed data on the live server): the add-time composer computed inverted date-picker bounds (`minimumDate > maximumDate`), and `@react-native-community/datetimepicker` throws an uncatchable native exception on inverted bounds. The fix (commit `0f79dac`) clamps the bounds, flags a closed window, and adds a defensive guard - shipped with unit + render tests (full mobile suite green, 238 tests). A parallel agent was simultaneously rewriting the demo seed to relative dates and making `u_dev` the curated demo protagonist, which **invalidated two of the three originally-agreed follow-up tasks** (do NOT hide dev login; defer the live reseed).

## What was done

### 1. `pnpm demo` script (live-API demo harness)
- **Created `scripts/demo.sh`** and added `"demo": "bash scripts/demo.sh"` to root `package.json`.
- It is `pnpm phone` minus everything that only existed because the API was local: no Docker, no local API, no LAN-IP-for-the-API detection. The live API is a public HTTPS endpoint, so the script just launches Expo with `EXPO_PUBLIC_API_URL` set to the deployed URL. Expo still serves the JS bundle over LAN for the QR (phone must be on the same Wi-Fi, or pass `--tunnel`, which is forwarded to `expo start`).
- Defaults to **production** App Runner `https://96mgvmgcbj.us-east-1.awsapprunner.com`; overridable via `API_URL=... pnpm demo` (the dev stack is `https://wumksaeb3j.us-east-1.awsapprunner.com`).
- Health-checks `GET /trpc/health` first (warn-but-continue), verified live returns `{"result":{"data":{"ok":true}}}`.
- Auth comes from `apps/mobile/.env` (gitignored): the real Clerk publishable key + `EXPO_PUBLIC_DEV_AUTH=1`, exactly mirroring the CD-built APK (`.github/workflows/cd.yml`).
- **NOTE on provenance:** `demo.sh` + the `package.json` edit were authored early in the session but were later swept into a *parallel agent's* commit `0373aeb chore: change final presentation` (not a dedicated commit). They are committed and present on `dev`.

### 2. Root-caused and fixed the add-a-time crash (commit `0f79dac`)
- **Symptom (user report):** "picking a time breaks it and crashes the app", refined to: happens under dev login on the live server when picking a time "outside the window that's allowed", and "it doesn't catch".
- **Investigation (systematic-debugging skill):** Found both obvious mutation call sites already `.catch` (create submit at `CreateWizard.tsx:334`, `events.addCandidate` at `EventDetail.tsx:340`). So a rejected mutation could not be the hard crash. Traced to a **render-time** crash in `PhaseViews.tsx` `AddTime`.
- **Confirmed empirically against the live prod API** (queried `events.get` for seeded plan `e_pub` as `x-user-id: u_dev`): its time candidates are `2026-06-03/04/05` - all in the past (today is 2026-06-16), `decidesBy: null`. Tracing `AddTime`: `horizonMs = addCandidateHorizon(June3, June5) = June7` (past); `addMinDate = max(now, decideMs) = June16`; `addMaxDate = June7`. So `minimumDate (June16) > maximumDate (June7)` was handed to the native date picker, which throws a native exception JS cannot catch.
- **Why it looked auth-related:** `u_dev` is the *seeded* user, so dev login drops you straight into the stale seeded plans; a fresh Clerk user only sees plans they created (future times) and never hits it. The crash is NOT caused by the dev bypass - any user viewing an elapsed-window plan crashes identically.
- **Fix (TDD, red-green for each):**
  - Extracted `addTimeWindow(startsAtIso, decidesByIso, nowMs)` in `PhaseViews.tsx` (exported, like `clampDate` in `DateTimeField.tsx`): clamps `maxMs >= minMs` so bounds can never invert, and returns `closed: true` when the window has fully elapsed (`rawMaxMs <= minMs`).
  - `AddTime` now early-returns a caption ("This meetup's time window has passed - no new times can be added.") instead of rendering the composer when `closed`.
  - Defense in depth: `safeMaxDate(min, max)` in `DateTimeField.tsx` drops an inverted max so the native picker can never receive `min > max`; wired into the date-mode `gatedMax`.
  - Tests: `PhaseViews.addTime.test.ts` (3 cases incl. the exact `e_pub` crash shape), `DateTimeField.clamp.test.ts` (+4 `safeMaxDate` cases), and an `EventDetail.test.tsx` render test asserting the composer is hidden on an elapsed window.

### 3. Parallel-agent coordination (mid-session discovery)
- Partway through, the working tree changed in ways this session didn't cause: `apps/api/src/db/seed-data.ts` (+test) modified (~258 lines), presentation churn, and the early `demo.sh`/`package.json` already committed by someone else. Concluded another agent (or the user) was working the same repo in parallel.
- Read the parallel agent's `seed-data.ts` diff: it rewrites the demo seed to **relative dates** (`fromNow(hours)`, `dayAt(...)`) so demo data is never stale, and introduces `ME_ID = process.env.DEMO_ME_ID ?? "u_dev"` making **`u_dev` the curated demo protagonist** ("You") across all groups/plans, with a documented prod-web/Google path via `DEMO_ME_ID`/`DEMO_ME_NAME`. That work has since landed as commit `0360728 feat(api): curate demo seed to the final-presentation story (DRP-71)` (+ `66de11e` excluding presentation/project-doc from biome lint).

## Key decisions & rationale

- **`pnpm demo` defaults to production, not the dev stack.** "Live deployment" most naturally means prod, and the CD-built phone APK points at prod. User confirmed production via AskUserQuestion.
- **Fix the crash at the source (no inverted bounds) rather than the user's proposed "disable dev login".** Disabling dev login only *masks* the symptom for the demo; any user viewing an elapsed-window plan crashes the same way. The real bug is feeding inverted bounds to a native picker. Verified empirically before proposing the fix (systematic-debugging Iron Law: no fix without root cause).
- **Two complementary layers, both kept.** `addTimeWindow` is the primary fix (never invert + refuse to open a useless picker); `safeMaxDate` is defense-in-depth so no future caller can re-introduce the crash. The crash is a hard native exception, so belt-and-braces is justified.
- **REVERSED the earlier 3-task plan after discovering the parallel seed work.** The user initially chose all three of: (1) fix the crash, (2) reseed live, (3) hide dev login. After reading the parallel agent's seed:
  - **Keep dev login on `pnpm demo`** (do NOT hide it). `u_dev` IS the curated demo protagonist; hiding the dev-bypass button forces a fresh Clerk account that owns none of the demo data, emptying the phone demo. Hiding only makes sense for the prod-web/Google path (where you'd set `DEMO_ME_ID` instead).
  - **Defer the live reseed.** Reseeding hits the *deployed* image's seed code (still old absolute dates) - no freshness gain. The real fix is the parallel agent's relative-date seed, which only helps once merged + deployed. User confirmed "Keep dev login, hold reseed".
- **Path-scoped commit only.** Given parallel agents share one working tree/index, staged exactly the 5 crash-fix files by path (never `git add -A`) so none of the other agent's in-flight `seed-data.ts`/`presentation/` work was bundled in.

## Things learned / discovered

- **`@react-native-community/datetimepicker` hard-crashes on `minimumDate > maximumDate`** - a native exception that JS `try/catch` cannot intercept; it fires when the picker mounts/opens, before any submit-time validation runs. The existing `invalidNote` logic in `AddTime` only validated *after* a pick, so it never got a chance.
- **The live prod DB seed was stale absolute dates** (June 3-5 candidates viewed June 16), and seeded plans belong to `u_dev`. Verified by curling the live API: `GET /trpc/events.get?input=<urlencoded {"id":"e_pub"}>` with header `x-user-id: u_dev`. `events.mine` (dashboard) does NOT carry `timeCandidates`/`decidesBy` for all plans; `events.get` does.
- **`pnpm demo` serves the JS bundle from the local machine** - only *data* comes from the live API. So the local crash fix is active in `pnpm demo` immediately, no deploy needed. (The live web/APK builds would need the mobile fix deployed.)
- **Expo env precedence:** a shell-set `EXPO_PUBLIC_*` var takes precedence over `apps/mobile/.env` (dotenv does not override existing process env). Confirmed in the demo run log: `EXPO_PUBLIC_API_URL` (CLI) was used while `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`/`EXPO_PUBLIC_DEV_AUTH` loaded from `.env`.
- **Pre-existing repo lint failure:** `pnpm lint` is red due to `lint/complexity/noImportantStyles` in `presentation/v0/styles.css` (the frozen deck), unrelated to code. The parallel agent's `66de11e` excludes presentation/project-doc from biome - so this may now be resolved on newer HEAD.
- **`addTimeWindow` placement:** put in `PhaseViews.tsx` (not `lib/lock.ts`) because it is UI-composer policy (uses "now" + a 14-day fallback + closed detection), not a server-mirrored rule. `lib/lock.ts` is strictly a mirror of `packages/shared/src/logic/lock.ts`; its mirror test (`lock-mirror.test.ts`) only checks the 4 named exports exist in both copies (would not have broken on an addition, but separation is cleaner).
- **Parallel-agent failure mode:** the most pernicious issue is not git mechanics but **one agent making a decision another agent's in-flight work invalidates** (here: "hide dev login" vs `u_dev`-is-protagonist). Checking others' uncommitted diffs before executing a shared-concern task is what caught it.

## Current state

- **Crash fix committed:** `0f79dac fix(mobile): stop add-a-time picker crashing on an elapsed window`. Isolated to 5 mobile files. Full mobile suite green: **238 tests / 20 suites**. Mobile typecheck clean. `pnpm quality` clean. My files are biome-clean.
- **`pnpm demo` live** on `dev` (script committed via `0373aeb`; `package.json` has the `demo` script).
- **Parallel agent's seed refactor landed:** `0360728` (relative-date curated seed, `u_dev` protagonist) + `66de11e` (biome exclusions).
- **Verified vs pending:** crash fix verified by automated tests + an empirical live-API data probe; **NOT yet verified on a physical device** (jest cannot drive the native picker). Recommended manual check below.
- **Decisions settled:** keep dev login on `pnpm demo`; do not reseed live yet.

## Conventions, commands & workflows

- **Run the live-API demo:** `pnpm demo` (prod) | `pnpm demo --tunnel` (off-Wi-Fi) | `API_URL=https://wumksaeb3j.us-east-1.awsapprunner.com pnpm demo` (dev stack).
- **Live API URLs:** prod `https://96mgvmgcbj.us-east-1.awsapprunner.com`, dev `https://wumksaeb3j.us-east-1.awsapprunner.com`. Health: `GET /trpc/health` -> `{"result":{"data":{"ok":true}}}`.
- **Probe live data as the dev user:** `curl "$B/trpc/events.get?input=<urlencoded {\"id\":\"e_pub\"}>" -H "x-user-id: u_dev"` (works because the live API runs `DEV_AUTH_BYPASS=1`).
- **Demo protagonist control (parallel agent's design):** set `DEMO_ME_ID` (+ `DEMO_ME_NAME`) on the App Runner service before reseeding for a prod-web/Google demo; defaults to `u_dev`/"You" for phone/dev-web.
- **Parallel-agent hygiene (established this session):** (1) lane separation by directory; (2) path-scoped commits only, never `git add -A`/`-u`; (3) `git status`/diff others' files before acting on a shared concern; (4) only one agent runs the app at a time (ports 3000/8081/5433).
- Standard gate before a PR remains `pnpm check` (lint + typecheck + test + quality).

## Known issues / caveats / risks

- **Crash fix unverified on a real device.** Tests cover the logic but not the native picker. Manual check: `pnpm demo` -> log in as test user -> open `e_pub` -> tap "+ add a time". Before: crash. Now: shows the "time window has passed" caption. (Once the relative-date seed deploys, `e_pub` won't be stale, so reproducing the guard later needs a genuinely elapsed-window plan.)
- **Live API still serves stale seed** until the parallel agent's relative-date seed is deployed (merge `dev` -> `main` -> CD -> App Runner). Reseeding before that re-applies stale dates.
- **`pnpm lint` may still be red** on older HEAD due to `presentation/v0/styles.css` `!important`; `66de11e` aims to exclude presentation from biome - confirm on latest `dev`.
- **Crash fix not deployed to web/APK builds** - only active in locally-served bundles (`pnpm demo`, `pnpm phone`) until a deploy.
- **No Linear issue was created** for the crash fix (offered, not done) to avoid duplicating tracking in a multi-agent context. The seed work is tracked as DRP-71.

## Next steps

1. (Optional) Log the crash fix in Linear (team DRP_02), mark Done, reference commit `0f79dac`.
2. Manually verify the fix on a physical phone via `pnpm demo` (steps above).
3. After the relative-date seed (DRP-71) reaches `main` and deploys, reseed live (`pnpm reseed:live` / token-gated `/admin/reseed`) so the demo data is fresh and `u_dev`-anchored.
4. For a prod-web + Google-login demo (not the phone path): set `DEMO_ME_ID`/`DEMO_ME_NAME` on App Runner, reseed, and only then consider `EXPO_PUBLIC_DEV_AUTH=0` in `demo.sh`.

## References

- `scripts/demo.sh`, `scripts/phone.sh`, `scripts/web.sh` - run harnesses; root `package.json` scripts.
- `apps/mobile/src/screens/event-detail/PhaseViews.tsx` - `addTimeWindow` + `AddTime` closed branch.
- `apps/mobile/src/ui/DateTimeField.tsx` - `safeMaxDate` guard + `clampDate`; `DateTimeField.web.tsx` (web `<input>` fallback).
- `apps/mobile/src/lib/lock.ts` - `addCandidateHorizon` (mobile mirror of `packages/shared/src/logic/lock.ts`).
- `apps/mobile/src/lib/format.ts` - `isoFrom`/`parseLocalTime`/`timeStringFrom` etc.
- Tests: `apps/mobile/src/screens/event-detail/PhaseViews.addTime.test.ts`, `apps/mobile/src/ui/DateTimeField.clamp.test.ts`, `apps/mobile/src/screens/__tests__/EventDetail.test.tsx`.
- Server validation context: `apps/api/src/routers/events.ts` (`addCandidate`, `get`, `mine`); tests `apps/api/src/routers/events-addCandidate.test.ts`.
- Parallel seed work: `apps/api/src/db/seed-data.ts` (commit `0360728`, DRP-71).
- Deploy/runbook: `docs/runbook-deploy.md` (App Runner ARNs, URLs, reseed). Auth/CD: `.github/workflows/cd.yml`.
- Commits this session: `0f79dac` (crash fix), `0373aeb` (swept-in `demo.sh`/`package.json`).
