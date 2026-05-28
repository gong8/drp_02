# Concrete-event RSVP pivot + M2 mockups - 2026-05-28

**Branch:** dev | **PRs:** none opened this session (all work committed directly to `dev`; nothing pushed to origin yet) | **Scope:** Read all DRP M2 context, set up mockup tooling, then pivot BeThere from the loose-availability model to a concrete-event RSVP app driven by hand-drawn mockups.

## TL;DR
This session began as "prepare a folder + prompt for M2 mockup images" and escalated, after the user supplied a 30-page mockup PDF (`docs/mockups/m2/ALL_MOCKUPS.pdf`), into a full product pivot. Per group consensus, the privacy-first loose-availability model (availability -> auto-match -> blind timed moment) was **archived** to `archive/loose-availability/` and the app was **rebuilt as a concrete-event RSVP app**: a creator sets a fixed title/date/time/place, members RSVP "I will make it / won't / will make it if [people]", and a status dashboard groups events by Awaiting/Going/Declined. All work landed on `dev` across four commits (merge -> plan -> pivot -> security hardening). Backend is verified against a local Postgres (boots, migrates, seeds, correct per-user statuses, IDOR guard returns 403 for non-members); the Expo UI was **not** run in a simulator this session.

## What was done (chronological)

1. **Read all DRP context.** M2 rubric (`DRP_context/.../(4) DRP - Assesment Template (2026) IMPORTANT.pdf`), the BeThere product-design spec, all four interviews, and the survey CSV. The M2 ("Concept Development", review 29 May 2026) rubric has five rows: visual mock-ups with interlinked core interaction; real-people interaction; concept validation; dev process (Git->CI->public deploy->functioning CD); and a walking skeleton that prototypes a *context-relevant* interaction (not a generic hello-world/todo/map/login).

2. **Created the M2 mockup folder + restyle prompt** at `docs/mockups/m2/` (folder choice and "match the RN app" goal chosen by the user via AskUserQuestion): `README.md` (image->screen map), `PROMPT.md` (a reusable prompt to restyle Expo screens to match dropped images), and `screens/`. Both prompt docs were later anchored to the exact M2 rubric language.

3. **First-pass alignment of the existing (loose-model) screens** to 10 dropped PNG mockups (committed earlier as `9b4e247` on `feat/bethere-full-loop`): Home group avatars + "Your Groups" + "Suggest a Meet", moment relabel to "I will make it / won't / if", Reveal as a "Who's going" list, Suggest copy. Tracked as Linear **DRP-17** (now Done).

4. **Removed all em dashes repo-wide** (`4b90f8a`): the user wants no em dashes anywhere. Replaced the em-dash codepoint with hyphens via `perl -CSD -i -pe 's/ \x{2014} / - /g; s/\x{2014}/-/g'` over `grep -rIl` output. A pre-existing `.gitignore` tweak (`.DS_Store` -> `**/.DS_Store`) got swept into that commit. Saved as a durable preference in memory.

5. **User supplied `ALL_MOCKUPS.pdf` (30 pages)** and asked to "heavily base it off this file, ask lots of questions on conflicts." Reading it revealed a *different product* than the spec: concrete events (title/description/photo/date/time/location create form), an event detail with "I will make it if…" (with explorations of change-time, free-text, and AND/OR conditions, refined down to people + at-least-one/all), a status dashboard, full Groups management (create/add/remove/edit), a Meetups|Groups bottom tab bar, and a lock-screen "Results are in!" push.

6. **Resolved the conflicts via two rounds of AskUserQuestion.** Decisions (see below), then wrote the pivot plan `docs/superpowers/plans/2026-05-28-concrete-events-pivot.md`, deleted the obsolete `match-app-to-m2-mockups.md` plan, and recorded the pivot + the em-dash rule to memory.

7. **Merged `feat/bethere-full-loop` into `dev`** (`37d5bf9`, clean, no conflicts). The working tree had been switched to `dev` by parallel activity; this brought the mockups/alignment/em-dash work onto `dev`.

8. **Executed the pivot** (`0f015d0`): archived loose code, rewrote shared schemas, DB schema + a fresh migration, events + groups routers, seed, and the entire mobile layer (react-navigation tabs + 6 screens). Verified green and booted the API against local Postgres.

9. **Addressed an automated security review** (`ac101f4`): added `requireMember` authorization guards to all group/event procedures (the flagged IDORs), verified member->data / non-member->403.

## Key decisions & rationale

| Decision | Choice | Why |
|---|---|---|
| Loose model vs concrete events | **Pivot to concrete events; archive loose** | Group consensus; the mockups (now the authoritative M2 design) describe a concrete-event RSVP app with no availability stage. Loose returns next iteration. |
| Who's going visibility | **Show only those going** | User: "not for privacy, it doesn't take a genius to figure out who's not going." So no "no public no" framing; just omit non-going. |
| Conditional richness | **People-only (pick people + at-least-one/all)** | Matches the refined mockup pages; change-time/free-text/AND-OR deferred. Lets us reuse the existing `resolveIn` fixpoint unchanged. |
| Groups scope | **Full CRUD + bottom tabs** | Mockups show create/add/remove/edit and a Meetups|Groups tab bar. |
| Archiving method | **Move to in-repo `archive/loose-availability/`** | User chose this over git-tag-and-delete or a separate branch; visible and easy to restore. Excluded from build via root location + biome ignore. |
| Event resolution | **Resolve conditionals at deadline; event always happens (no quorum/cancel)** | Simpler than the loose model's clear/fizzle; the "Pending Xh Ym" countdown still resolves "I'll go if". |
| Create form fidelity | **Text only (title, description, date, time, free-text location)** | No photo upload or map yet (avoids image infra + maps lib/keys); avatars generated from initials+colour. |
| Dashboard grouping | **By status, then date** | Refined PDF pages 27-28: sections Awaiting Your Response / Going / Declined with date sub-headers. |
| Nav library | **@react-navigation (native + native-stack + bottom-tabs)** | Standard for two tabs each with pushes; user approved adding the dependency. |
| Migration strategy | **Reset the baseline and regenerate one clean migration** | `drizzle-kit generate` is interactive and prompts on enum/table rename ambiguity (hangs in a non-TTY). With an empty baseline there is nothing to rename, so it generates cleanly with no prompts. Trade-off: the live RDS now needs a one-time drop/recreate (see caveats). |
| Security review (IDOR) | **Add `requireMember` guards** rather than dismiss | Cheap, correct (procedures should be scoped to the caller's groups), breaks no happy path (app only acts on the user's own groups). Acknowledged the deeper gap: `ctx.userId` is a spoofable dev stub, already logged as tech debt. |

## Things learned / discovered

- **`drizzle-kit generate` is interactive.** It prompts (arrow-key select) when it can't tell a create from a rename - e.g. dropping `activity`/`suggestion_status`/`moment_status` enums while adding `event_status`. In a non-TTY it effectively hangs / cancels. Workaround used: delete `apps/api/src/db/migrations/0000_*.sql` + `meta/0000_snapshot.json`, reset `meta/_journal.json` to `{"version":"7","dialect":"postgresql","entries":[]}`, then regenerate -> clean `0000_greedy_killmonger.sql`, no prompts.
- **The DB client requires `DATABASE_URL`.** `apps/api/src/db/client.ts` reads `process.env.DATABASE_URL`; `apps/api/.env` (gitignored, present) supplies `postgres://drp:drp@localhost:5433/drp`. Docker compose maps host **5433** -> container 5432 (to avoid clashing with a local 5432). Postgres container name: `drp_02-postgres-1`.
- **`expo install` picks Expo-SDK-56-compatible versions.** It installed `react-native-screens@4.25.2` and `react-native-safe-area-context@~5.7.0` (native) plus `@react-navigation/native@^7`, `native-stack@^7`, `bottom-tabs@^7` (JS) via pnpm.
- **biome `check` is also a formatter gate.** `pnpm lint` (= `biome check`) fails on formatting drift; `pnpm format` (= `biome check --write`) normalizes. Run format before lint. Added `"!**/archive/**"` to `biome.json` `files.includes` so archived code is ignored.
- **The em-dash sweep** touched 37 files. En dashes were left alone (only em dashes were in scope).
- **Parallel git activity happened during the session** (branch was switched to `dev`, extra commits `d4d1b2b`/`929945a`/`8271e51` appeared on `feat/bethere-full-loop`, and `ALL_MOCKUPS.pdf` was committed as `8271e51` "chore: add mockups drawing"). Treat the repo as possibly concurrently edited.
- **`events.mine` is N+1** (per-event group lookup + per-event responses + per-user lookups); first call after boot measured ~5 s for 6 events. Fine for the demo, worth batching later.
- **Verified the IDOR guard live:** `groups.get` for `g_boys` returns data for `u_dev` (member) and `{"error":{... "FORBIDDEN" ... httpStatus:403}}` for `u_zara` (non-member).

## Current state

- **Branch `dev`** holds everything. Commits this session: `37d5bf9` (merge), `8bb75d6` (plan), `0f015d0` (pivot), `ac101f4` (IDOR hardening). **Not pushed to origin** - the user was asked whether to push; no answer yet.
- `feat/bethere-full-loop` was merged in and is **not to be touched anymore** (user instruction).
- **Verified:** `pnpm lint`, `pnpm typecheck`, `pnpm test` all green. API boots, applies the migration, seeds, and `events.mine` returns correct per-user statuses (Bowling=awaiting, Knitting/Climbing/Dinner=going, Football/Baking=declined) against local Postgres. Membership guard returns 403 for non-members.
- **Not verified:** the Expo/React Native UI was not run in a simulator this session.
- **Local docker DB volume was reset** (`docker compose down -v`) to validate the fresh migration - throwaway demo data only. The container is left running with fresh seed.
- **Untracked:** `docs/summary/2026-05-28-1705-live-backend-deploy-and-standalone-apk.md` (from other/parallel activity; left alone).
- **Linear:** DRP-17 (first-pass alignment) = Done; **DRP-20** ("Pivot BeThere to a concrete-event RSVP app (M2)") = In Progress with a detailed progress comment.

### Code map (post-pivot)
- `packages/shared/src/schemas.ts`: `ResponseKind`, `Conditional`, `RespondInput`/`ResolveInput` (now keyed by `eventId`), `CreateEventInput`, `CreateGroupInput`.
- `packages/shared/src/logic/resolve.ts`: unchanged; `resolveIn`/`clears`/`findLinchpins` (`clears`/`findLinchpins` now only exercised by tests).
- `apps/api/src/db/schema.ts`: `users`, `groups`, `groupMembers`, `events`, `responses` (FK `eventId`). Enums: `event_status`, `response_kind`.
- `apps/api/src/db/migrations/0000_greedy_killmonger.sql`: the single fresh migration.
- `apps/api/src/routers/events.ts`: `create`, `mine`, `get`, `respond`, `resolve` (+ `requireMember`, `statusFor`).
- `apps/api/src/routers/groups.ts`: `mine`, `get`, `addableUsers`, `create`, `rename`, `addMember`, `removeMember` (+ `requireMember`).
- `apps/api/src/db/seed.ts`: concrete-event demo (users incl. You/Adi/Lily/Joe/Nathan/Bethan/Noah + High School Reunion members; groups The Boys/Climbing Group/Glitter Natters/Church Group/High School Reunion; events Bowling/Knitting/Climbing/Dinner/Football/Baking with baked-in peer responses).
- `apps/mobile/App.tsx`: `SafeAreaProvider` + `NavigationContainer` + bottom tabs (Meetups|Groups), each a native stack. Exports `MeetupsStackParams`/`GroupsStackParams`.
- `apps/mobile/src/screens/`: `Dashboard.tsx`, `EventDetail.tsx`, `CreateEvent.tsx`, `GroupsList.tsx`, `GroupDetail.tsx`, `CreateGroup.tsx`.
- `apps/mobile/src/lib/format.ts`: `formatDate`/`formatTime`/`dateKey`/`countdown`/`colorFor`/`initials`.
- `apps/mobile/src/theme.ts`: added `status` tokens (going/pending/declined + soft variants).
- `archive/loose-availability/`: archived loose code (shared logic `matching`/`quorum`/`time` + tests; api routers `availability`/`suggestions`/`moments` + service `bethere`; mobile screens `Home`/`Suggest`/`Availability`/`Floating`/`TheMoment`/`Reveal`).

## Conventions, commands & workflows

- **pnpm only.** Gates: `pnpm lint` (biome check), `pnpm typecheck` (tsc per package), `pnpm test`. `pnpm format` to auto-fix style. `pnpm check` runs lint+typecheck+test+quality.
- **No em dashes anywhere** (code, docs, prose) - use hyphens. (Saved to memory.)
- **Branching:** `main` protected; default work on `dev`; ship via PR `dev`->`main`. This session: work directly on `dev`, do not touch `feat/bethere-full-loop`.
- **Track work in Linear** (DRP_02 team) religiously: create/find issue, In Progress, comment progress, Done with commit refs.
- **DB:** `pnpm db:up` / `pnpm db:down` (docker compose, host port 5433). API on boot: `migrate` then seed per `SEED_ON_BOOT` ("reset" local default wipes+reseeds; "if-empty" live; "off"). To reset local DB schema after a migration-baseline change: `docker compose down -v && docker compose up -d`.
- **Mockups** live in `docs/mockups/m2/`; `ALL_MOCKUPS.pdf` is the authoritative M2 design.
- **Type chain:** define Zod schemas in `@bethere/shared`, expose via tRPC routers; mobile infers types via `Awaited<ReturnType<typeof trpc.x.y.query>>`. `apps/api` is ESM - relative imports need `.js`. Mobile imports `@bethere/api` type-only.

## Known issues / caveats / risks

- **Live RDS (DRP-16) will break on redeploy** until reset: the migration baseline was reset, so the committed `0000` differs from what the live DB's `__drizzle_migrations` recorded; `migrate`-on-boot will conflict with existing tables. Needs a one-time drop/recreate (or wipe `__drizzle_migrations` + tables) before the next deploy.
- **Expo UI unverified** this session - must `pnpm dev:mobile` and click the full loop (tabs, dashboard sections, respond + conditional sheet, who's-going, create event, group CRUD).
- **Auth is a stub:** `ctx.userId` comes from an optional `x-user-id` header (default `u_dev`) and is spoofable; `requireMember` is scoping, not real security. Open/unauthenticated API + open CORS are deliberate tech debt (`docs/tech-debt.md`, commit `cc88eaf`).
- **`events.mine` N+1** queries (slow but fine for demo).
- **Single-user demo:** seed bakes peer responses so a solo tester sees populated "who's going"; there is no real multi-user/auth.
- **Deferred:** push notifications (`expo-notifications`, the "Results are in!" mock), photo upload + map location picker, the "change time" / free-text / AND-OR conditional variants, and re-adding the loose-availability model.
- **`dev` not pushed** to origin; parallel activity may have advanced `origin/dev`, so a push may need a fetch/reconcile first.

## Next steps

1. **Decide whether to push `dev`** to origin (fetch first; reconcile with any parallel `origin/dev` commits).
2. **Run the Expo app** (`pnpm dev:mobile`) and click through the full loop; fix any runtime/layout issues (the UI is unverified).
3. **Reset the live RDS** before the next backend deploy, or add a guard so `migrate`-on-boot tolerates the reset baseline.
4. **User testing for M2** (rubric rows 2-3): put the running app in front of real people, capture interactive feedback excerpts.
5. Optional polish: batch `events.mine` to remove N+1; consider muted status colours already in `theme.status`; add the deferred conditional variants if desired.
6. Close out **DRP-20** once the UI is verified.

## References

- Plan: `docs/superpowers/plans/2026-05-28-concrete-events-pivot.md`
- Mockups: `docs/mockups/m2/ALL_MOCKUPS.pdf`, `docs/mockups/m2/README.md`, `docs/mockups/m2/PROMPT.md`, `docs/mockups/m2/screens/`
- Superseded (loose) spec: `docs/superpowers/specs/2026-05-28-bethere-product-design.md` (+ reference implementation doc) - paused, not the current target
- Tech debt: `docs/tech-debt.md`
- Archived loose model: `archive/loose-availability/`
- Linear: DRP-20 (pivot epic, In Progress), DRP-17 (first-pass alignment, Done), team DRP_02
- Key commits: `0f015d0` (pivot), `ac101f4` (IDOR hardening), `37d5bf9` (merge), `4b90f8a` (em-dash sweep)
