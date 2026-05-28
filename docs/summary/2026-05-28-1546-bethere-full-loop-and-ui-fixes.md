# BeThere Full-Loop Walking Skeleton (parallel-agent build) + simulator UI fixes - 2026-05-28

**Branch:** `feat/bethere-full-loop` | **PRs:** #11 (MERGED → `dev`, brought the 4 full-loop commits) | **Scope:** Extend the moment-only slice into the full BeThere loop (suggest → availability → matching → moment → plan), DB-backed and partially functional, then fix two UI issues found in the simulator (back button everywhere; emoji rendering as `[?]`).

## TL;DR

This session took the BeThere mobile app from a **single-stage "moment" slice** (already on `dev` from PR #9) to the **full product loop**, built across all three packages (`@bethere/shared`, `@bethere/api`, `@bethere/mobile`) by dispatching **three parallel implementation agents** against a frozen cross-package contract, then integrating and verifying end-to-end. The whole loop was exercised against **live Postgres** via curl (clear / silent-fizzle / conditional / non-participant-privacy all pass), `pnpm check` is green, and the work merged into `dev` as **PR #11**. Afterwards the user ran the app in an iOS simulator and reported two issues - no back navigation, and activity emoji rendering as missing-glyph `[?]` boxes - both of which were fixed (a global Back header in `App.tsx`; removal of the tofu-prone emoji in favour of the activity text). The two follow-up commits (`8f56c50` mobile fixes + `3ebd76c` API-deployability, the latter authored by the user in parallel) are on the branch but **not yet in `dev`** (PR #11 had already merged) and need a fresh PR.

## What was done

Chronologically:

1. **Read the inputs.** The two design docs (`docs/superpowers/specs/2026-05-28-bethere-product-design.md` and `…-reference-implementation.md`) and the prior session summary (`docs/summary/2026-05-28-1436-…`). Established current state: PR #9 had already merged a **moment-only** slice into `dev` - a single seeded `moments` row + `responses`, the `moments` router (`mine`/`respond`/`resolve`), one self-contained `TheMoment` screen, no navigation, fonts deferred, the "I'm in if…" picker a disabled stub. The upstream stages (suggest → availability → matching) and all other screens did not exist.

2. **Scoped the full loop** and locked design decisions (see Key decisions). Created **Linear DRP-15** (team DRP_02), set In Progress; branched `feat/bethere-full-loop` off `dev`.

3. **Dispatched 3 parallel agents** (general-purpose), each owning a disjoint package with the exact cross-package contract written into its prompt:
   - **shared** - added `PartOfDay`/`Slot`/`CreateSuggestionInput`/`DropAvailabilityInput`; new pure logic `logic/quorum.ts` (`AUTO_QUORUM`,`quorumFor`), `logic/time.ts` (`slotToDate`,`defaultPlace`,`headlineFor`), `logic/matching.ts` (`findClearingSlot`), `findLinchpins` added to `logic/resolve.ts`; exported all from `index.ts`; added `matching.test.ts` + `findLinchpins` tests. Self-verified `pnpm --filter @bethere/shared test` (10 tests) + typecheck green.
   - **api** - reshaped `moments` and added `users`/`groups`/`group_members`/`suggestions`/`availability`/`plans` (+ `suggestion_status` enum) in `db/schema.ts`; new `services/bethere.ts` (`tryFireMoment`, `resolveMoment`); new `routers/{groups,suggestions,availability}.ts` + extended `routers/moments.ts` (`mine`/`respond`/`resolve`/`plan`); mounted in `router.ts`; rewrote `db/seed.ts` (`reseedDemo` + exported demo-only `seedDemoPeerYeses`); added `format.ts` (`formatWhen`). Did not run db/install commands (left to integration).
   - **mobile** - `useState` route switcher in `App.tsx` + six screens: `Home`, `Suggest`, `Availability`, `Floating`, `TheMoment` (real "I'm in if…" all/any picker + live countdown), `Reveal`. No new deps; fonts stayed deferred (system `fontWeight`).

4. **Integrated** (orchestrator did this, agents did not):
   - Declared `zod` explicitly in `apps/api/package.json` (it had resolved only transitively via hoisting); `pnpm install`.
   - `pnpm format` (biome `--write`) normalised import order + wrapping; applied 3 `useOptionalChain` fixes via `biome check --write --unsafe` on the flagged files; reverted then re-applied a biome glob normalisation (see Things learned).
   - **Regenerated a clean baseline migration**: deleted `0000_smooth_molecule_man.sql` + `meta/*`, recreated an empty `meta/_journal.json`, ran `db:generate` → `0000_damp_fantastic_four.sql` (4 enums, 8 tables, all FKs). Recreated the Docker volume (`docker compose down -v && up`), waited for an authenticated PG check, `db:migrate`.
   - `pnpm check` green (biome lint, typecheck ×3, vitest 10/10, jest 1/1, quality scan).

5. **Verified the full loop against live Postgres** via curl (server run with `pnpm dev:api`, killed/restarted between cases to reseed):
   - **Clear:** `groups.mine` → Flatmates+Maya's food suggestion; `suggestions.get` → 7 days; `availability.drop` today/evening → moment fires (3 free = food quorum 3); `moments.mine` → display fields + `members:[Maya,Sam]`, no participant ids/tally; `respond yes` → `resolve` `cleared inCount 3`; `moments.plan` → You+Maya+Sam with colours.
   - **Fizzle:** `respond no` → `resolve` `fizzled`; `plan` and `mine` → `null`.
   - **Conditional:** `respond {conditional, any:[u_maya]}` → `resolve cleared` (latches via fixpoint; `cond` jsonb round-trips).
   - **Privacy:** a non-participant (`x-user-id: u_outsider`) gets `null` from `moments.mine` and `moments.plan`.

6. **Updated `ARCHITECTURE.md`** (components, sequence, packages, privacy boundary, demo-seeding notes).

7. **Committed in 4 logical commits**, pushed, opened **PR #11 → `dev`**, marked **DRP-15 Done** with a verification comment + PR link. The user **merged PR #11** (origin/dev tip `c882543`, 15:28 BST).

8. **Simulator UI fixes** (after the user ran the app and sent a screenshot of the Floating screen showing a `[?]` box and asking for back buttons):
   - Diagnosed the `[?]`: scanned source code points with Python - the emoji bytes are **valid** (`🍜` = U+1F35C etc.), so it is the iOS Simulator not loading the colour-emoji font (`.notdef` boxes). Regular punctuation (`- · → … ✓`) renders fine.
   - **Removed all activity emoji** across the 6 screens (deleted the `EMOJI` maps + the unused `type Activity` aliases that only fed them; `Suggest` keeps its `Activity` type, still used). The activity **text** already shown alongside now carries the meaning.
   - **Added a global Back header** in `App.tsx`: a top-left `Back` (→ Home) shown for every non-`home` route, wrapping screens in a `body` view. This covers loading/error/empty/main states uniformly. Removed Floating's now-redundant footer Back + its orphaned styles; reduced non-home screens' `screen.paddingTop` from 64 → 12 (the header now owns the safe-area top, `paddingTop:60`).
   - `pnpm` typecheck/lint/quality green; committed `8f56c50` (mobile only - staged `apps/mobile/` precisely), pushed. Added a follow-up comment to DRP-15.

9. **Parallel user work (not authored by Claude this session):** commit `3ebd76c feat(api): make API deployable` (Dockerfile, `.dockerignore`, migrate/seed-on-boot, TLS, configurable URLs; touched `apps/api/{Dockerfile,.env.example,package.json,src/db/client.ts,src/db/seed.ts,src/index.ts}` and `apps/mobile/src/lib/trpc.ts`). The user committed this to the local branch between the full-loop commits and the mobile-fix commit; the orchestrator's push of `8f56c50` carried it to the remote. There is also an **uncommitted `.gitignore`** change adding `infra/.deploy-state.local` (user's deploy work).

## Key decisions & rationale

- **Three parallel agents on disjoint packages, with a frozen contract; orchestrator integrates.** The user explicitly asked for "as many parallel agents as physically possible" + "one shot". The genuinely independent work is the three packages. Each agent got the exact symbol names, procedure shapes, and (for shared/api) near-verbatim reference code, so cross-package drift was near-zero; the integrated typecheck after all three finished found **no** drift. Alternative (sequential shared-first) was safer but slower; the frozen contract bought the safety without serialising.
- **No new runtime dependencies anywhere.** Biggest one-shot de-risk. Fonts (Lora/Inter) stayed deferred (system `fontWeight`), no nav library (a `useState` switcher), no react-query (vanilla tRPC client + `useEffect`). Meant `pnpm install` was only needed once (for the `zod` manifest entry) and the build couldn't break on a bad font/native dep we couldn't runtime-verify.
- **Privacy-safe conditional picker via *group* members, not moment participants.** The blind rule says `moments.mine` must not reveal who's in the moment, yet the "I'm in if… [pick people]" picker needs names. Resolved by returning the **suggestion's group members** (minus self) from `moments.mine` - group membership is not secret, and it never discloses who is actually in the moment. This is the crux privacy decision.
- **No `Date` crosses the tRPC wire.** No transformer (e.g. superjson) is configured, so `Date` would serialise to a string while typing as `Date` - a footgun. Procedures return `msLeft`/`finalTimeMs` as numbers and preformatted strings (`formatWhen` → "Thu · 7:00pm", `daysBetween` → ISO date strings). Clean and unambiguous.
- **Demo affordance `seedDemoPeerYeses`, isolated in `seed.ts`.** A single tester has no real peers, so a moment could never clear. When a moment fires, the matched peers (minus the triggering user) are auto-marked "yes" so the tester reaches a real clear/fizzle decisively. Kept **out** of the pure `services/bethere.ts` (which stays faithful to the spec) and called from the `availability.drop` router with a loud DEMO-ONLY comment.
- **`moments` table reshaped** (dropped `title`/`place`/`detail`; added `suggestionId`/`proposedTime`/`proposedPlace`/`windowEndsAt`). A moment is now **generated by matching** from a suggestion + clearing slot, so there is no human-authored title; display strings are computed in `moments.mine` (`headlineFor(activity)` + `formatWhen(proposedTime)`).
- **Clean baseline migration, not an ALTER.** `moments` changed shape and 6 tables were added. A pre-prod skeleton with reset-on-boot demo data doesn't need migration history; regenerating a single `0000` baseline avoids drizzle-kit's interactive column-rename prompts and is cleaner for review. Cost: anyone with the old DB must recreate it (`docker compose down -v`).
- **`useState` route switcher over expo-router.** Robust, fully typecheckable, no entry-point/babel reshuffle, no dep - important because the mobile UI cannot be runtime-verified by the orchestrator (no emulator). The reference doc explicitly allowed this for a prototype.
- **Back button: one global header in `App.tsx`, not per-screen.** DRY and uniform - it appears in *every* state (loading/error/empty/main) of *every* non-home screen with a single edit point. Per-screen back buttons would have meant many insertions and inconsistency. "Back" always returns to Home (the hub) since the app is shallow hub-and-spoke and the switcher has no history stack.
- **Emoji removed rather than replaced with icons (for now).** The activity word is always shown next to the emoji, so removal loses no information and guarantees zero tofu; it also suits the "calm, minimal, not vibe-coded" design ethos. Plain ASCII "Back" was chosen over a chevron because the Floating screenshot proved plain text renders while colour glyphs don't. Offered `@expo/vector-icons` (ships with Expo, vector font, reliable on sim+device) as the path back if the user wants per-activity icons.
- **`zod` declared explicitly in `apps/api`.** Two routers use `z.object(...)` for ad-hoc inputs; it had resolved only via hoisting through `@bethere/shared`. Declaring it (`^3.24.1`) is correct and protects against future hoisting changes.
- **4 logical commits** (shared / api+migration+zod / mobile / docs+biome) for reviewability of a large PR.

## Things learned / discovered

- **iOS Simulator colour-emoji failure.** Emoji render as `.notdef` (`[?]`) boxes on the user's simulator even though the source bytes are valid UTF-8 (confirmed by a Python code-point scan: `🍜`=U+1F35C, `🏋️`=U+1F3CB+U+FE0F, etc.). Non-emoji punctuation (`-`,`·`,`→`,`…`,`✓`) uses the system font and renders fine - only `AppleColorEmoji`-backed glyphs fail. No code fix can force the sim's font; removal (or a vector-icon font) is the reliable answer.
- **drizzle-kit baseline regeneration.** `drizzle-kit generate` reads `src/db/migrations/meta/_journal.json`; deleting it causes `ENOENT`. To regenerate a clean baseline, recreate an **empty** journal `{"version":"7","dialect":"postgresql","entries":[]}` (version/dialect taken from the old journal), then `db:generate` emits a fresh `0000_*` with all `CREATE TABLE`s and no rename prompts.
- **Biome 2.4.16 glob deprecation.** `"includes": ["**","!**/migrations/**"]` emits a warning; the accepted form is `"!**/migrations"`. `biome check --write` auto-normalises it (it silently rewrote `biome.json`); reverting brings the warning back, so keep the normalised form. `--write` also organises imports; `--write --unsafe` applies `useOptionalChain` rewrites (`if (!x || x.a !== y)` → `if (x?.a !== y)`).
- **tRPC over HTTP without batching** (for curl): query = `GET /trpc/<proc>?input=<url-encoded JSON>` (use `curl -G --data-urlencode 'input={"id":"s_seed"}'`); no-input query = bare `GET /trpc/<proc>`; mutation = `POST /trpc/<proc>` with the JSON body directly; identity via `-H "x-user-id: u_dev"`. Responses are `{"result":{"data":…}}`.
- **Backgrounded `pnpm dev:api`.** It is `tsx watch src/index.ts`; kill reliably with `pkill -f "tsx watch src/index.ts"` + `lsof -ti tcp:3000 | xargs kill -9`. `reseedDemo()` runs on every boot, so a restart gives a fresh, replayable suggestion.
- **Parallel-agent integration was clean** - the frozen contract (exact export names + procedure shapes, no `Date` on the wire, explicit empty-array typing, `.js` ESM specifiers) meant the only integration fixes were the `zod` manifest entry and cosmetic biome normalisation. No type drift.
- **The user edits the same working tree concurrently.** Mid-session, `apps/api/package.json` (a `start` script + `engines.node>=20`) and `apps/mobile/src/lib/trpc.ts` changed (deployment work, later commit `3ebd76c`), and `.gitignore` gained `infra/.deploy-state.local`. Lesson: **stage precisely** (`git add apps/mobile/` only) so unrelated concurrent work isn't swept into your commit.
- **Local `origin/*` refs go stale.** After the user merged PR #11 on GitHub, local `origin/dev` still showed the pre-merge tip until `git fetch`. Always fetch before reasoning about remote merge state.

## Current state

- **`origin/dev`** tip = `c882543` (merge of PR #11). It **contains the full loop** (commits `4e23b0f`, `fabc88f`, `dbdabeb`, `39b7a49`) - verified with `git merge-base --is-ancestor`.
- **`feat/bethere-full-loop`** has **two commits not yet in `dev`**: `3ebd76c` (API deployability - user) and `8f56c50` (mobile UI fixes - Claude). **No open PR exists** for them; a new PR `feat/bethere-full-loop → dev` is required to land them.
- **Working tree:** one uncommitted change - `.gitignore` (+`infra/.deploy-state.local`), part of the user's deploy work. (`apps/api/package.json` shows clean now - its earlier in-flight edit was committed in `3ebd76c`.)
- **Verified:** the API loop end-to-end against live Postgres (clear/fizzle/conditional/privacy); `pnpm check` green after the full-loop build; mobile typecheck/lint/quality green after the UI fixes.
- **Not verified by Claude:** the mobile UI at runtime (no emulator on the orchestrator side). The **user** ran it in an iOS simulator and reported the two issues now fixed, but the **fixes themselves have not been re-confirmed in-sim**. The deployment work in `3ebd76c` is also unverified here.
- **Database:** Docker Postgres on host **5433**, volume recreated, migrated to the new baseline `0000_damp_fantastic_four.sql`, left running. `apps/api/.env` present (`DATABASE_URL=postgres://drp:drp@localhost:5433/drp`, gitignored).
- **Linear DRP-15** (team DRP_02): **Done**, with a completion comment + PR #11 link and a follow-up comment about the UI fixes.

## Conventions, commands & workflows

- **pnpm only.** `pnpm check` = `biome check` (lint) + `tsc --noEmit ×3` + tests + `scripts/quality-check.mjs` (bans `as any`/`@ts-ignore`/`@ts-expect-error`/`biome-ignore`/etc.). Biome: 2-space, double quotes, width 100; `migrations/` excluded via `"!**/migrations"`.
- **ESM:** `@bethere/shared` and `@bethere/api` are `"type":"module"` - relative imports end in `.js`. **No `Date` may cross a tRPC procedure boundary** - return numbers/strings.
- **Type chain:** Zod in `@bethere/shared` → tRPC in `@bethere/api` → `AppRouter` → typed client in `@bethere/mobile` (`import type` only). Don't hand-write API types.
- **Branching:** work on `dev` for routine changes; branch `feat/*` → PR into `dev` only for large features; only `dev` → `main`. CI runs on PRs into `main` (none on PRs into `dev`).
- **Issue tracking:** all work in **Linear team DRP_02** - find/create issue, In Progress, comment progress, mark Done with PR/commit refs.
- **DB / run:** `pnpm db:up` (Postgres 5433) · `pnpm --filter @bethere/api db:generate|db:migrate` · `pnpm dev:api` (http://localhost:3000, reseeds on boot) · `pnpm dev:mobile` (Expo). To re-baseline a migration: delete the old `*.sql` + `meta/*`, write an empty `meta/_journal.json`, `db:generate`, then `docker compose down -v && up && db:migrate`.

## Known issues / caveats / risks

- **`8f56c50` (mobile fixes) + `3ebd76c` (deployment) are NOT in `dev`** and have no open PR - they will be lost from `dev` until a new PR merges them.
- **Mobile UI fixes are statically verified only** (typecheck/lint + code review); not re-confirmed in the simulator. Walk through: Back appears on Home→Suggest/Availability/Floating/Moment/Reveal; no `[?]` boxes anywhere.
- **`seedDemoPeerYeses` is a demo hack** (auto-yes for matched peers) - must be removed for real multi-user.
- **No real auth** - `userId` from an `x-user-id` header, default `u_dev`.
- **Emoji removal deviates from the design spec** (which specified emoji activity chips). Reinstate via `@expo/vector-icons` if per-activity icons are wanted.
- **Clean-baseline migration** means any existing dev DB must be recreated (`docker compose down -v`).
- **Deployment work (`3ebd76c`) was authored by the user**; this archive lacks its design rationale (TLS setup, configurable URL scheme, Dockerfile choices) - read the commit + `apps/api/Dockerfile`/`.env.example` for details.
- **`DRP_context/` (~50 MB of PDFs)** remains in history from a prior session.

## Next steps

1. **Open a new PR `feat/bethere-full-loop → dev`** to land `3ebd76c` (deployment) and `8f56c50` (mobile UI fixes). Confirm no open PR currently exists.
2. **Re-verify the mobile UI in the simulator** - Back on every screen; activity labels render cleanly (no `[?]`); full loop Home → Availability (pick **today + Evening**) → Moment → It clicked / fizzle.
3. **Decide the activity-icon approach** - keep text, or wire `@expo/vector-icons`.
4. **Commit or discard** the uncommitted `.gitignore` change (user's call).
5. **Validate the deployment work** (`3ebd76c`) - build the Docker image, confirm migrate/seed-on-boot + TLS + configurable URLs.
6. **Continue deferred features** behind the existing interfaces: push notifications, the linchpin-nudge **delivery** (`findLinchpins` already exists), AI seeding of suggestions, calendar integration, real auth, Lora/Inter fonts.

## References

- Product spec: `docs/superpowers/specs/2026-05-28-bethere-product-design.md`
- Reference implementation: `docs/superpowers/specs/2026-05-28-bethere-reference-implementation.md`
- Architecture: `ARCHITECTURE.md` (updated this session)
- Prior summary: `docs/summary/2026-05-28-1436-bethere-walking-skeleton-postgres-and-rename.md`
- Key code:
  - shared: `packages/shared/src/{schemas.ts,index.ts}`, `packages/shared/src/logic/{quorum,time,matching,resolve}.ts` (+ `matching.test.ts`, `resolve.test.ts`)
  - api: `apps/api/src/db/{schema.ts,seed.ts}`, `apps/api/src/services/bethere.ts`, `apps/api/src/format.ts`, `apps/api/src/routers/{groups,suggestions,availability,moments}.ts`, `apps/api/src/router.ts`, `apps/api/src/db/migrations/0000_damp_fantastic_four.sql`
  - mobile: `apps/mobile/App.tsx`, `apps/mobile/src/screens/{Home,Suggest,Availability,Floating,TheMoment,Reveal}.tsx`
  - deployment (user): `apps/api/Dockerfile`, `.dockerignore`, `apps/api/src/db/client.ts`, `apps/mobile/src/lib/trpc.ts` (see commit `3ebd76c`)
- PR: https://github.com/gong8/drp_02/pull/11 (MERGED)
- Linear: team DRP_02 - DRP-15 (Done)
