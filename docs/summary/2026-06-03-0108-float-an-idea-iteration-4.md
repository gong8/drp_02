# Iteration 4: "Float an idea" - anonymous, collaborative, open-ended floating - 2026-06-03

**Branch:** merged to `dev` (PR #32, branch `feat/float-an-idea` now deleted) | **PRs:** #32 (MERGED) | **Linear:** DRP-30 (Done) | **Scope:** add an anonymous, ownerless, collaboratively-shaped "float an idea" front end to the convergence model, plus a create-flow overhaul (the "how pinned down?" dial + multi-step wizard).

## TL;DR

This session designed and built **iteration 4** of BeThere end to end, starting from three user interviews (`docs/drp-context/interviews/m3 interviews (iteration)/`: felicity, tom, luca). The interviews all converged on one root problem: *starting* a plan carries social risk ("no one wants to say yes first"), which kills meetups before they exist. We added a **Float**: any group member floats a loose idea **always unsigned and ownerless**; the group piles on with one-tap anonymous +1s across two axes (IDEA = fused what+where, TIME = loose bands); it **auto-tips at a deadline** into the existing blind moment (or a collecting round, or a silent fizzle) via a pure `reconcileFloat` function. We also replaced the single fat create form with a **"how pinned down?" dial** (Float / Rough / Set) and a focused multi-step wizard. Everything is implemented, typechecks/lints/tests green, verified end-to-end against a live DB and over HTTP, and **merged to `dev`**. The only unverified piece is the mobile UI rendering itself (needs a run in Expo Go).

## What was done

The work was a long brainstorming conversation (using the `superpowers:brainstorming` flow) that produced an approved plan, followed by implementation in **6 modular commits** on `feat/float-an-idea`.

### Design conversation (the shape of the feature)
- Read all three interviews directly and synthesized the root problem (initiation risk + single-person ownership). Tom named **anonymity** unprompted; Felicity invented **collaborative planning** and **floating with no fixed time**; Luca/Nathan are the passive baseline ("one guy always offers a time; majority wins; postpone if you need everyone").
- Reframed "maximally collaborative" away from a multi-axis Doodle (which the interviews are an indictment of - polls are where plans die) toward an **accreting anonymous idea-pile that auto-tips**. Anonymity is the social lubricant that makes the first +1 free; visible counts are the momentum engine.
- User collapsed place+activity into one **idea** axis (people float fused ideas like "bowling", "the pub"). Decided floats **converge to a concrete event** (not a forever-loose band). Decided the create flow should be a **focused multi-step wizard** with an explicit "how much detail?" dial, turning the previously **hidden** `whenMode` into the visible spine of the flow.
- Resolved the hard parts: **two privacy registers** (floating = loud, counts visible / names hidden; moment = blind), **+1 = interest not commitment**, **anonymity lifecycle** (originator hidden forever; the tipped plan is a normal named plan), and the **reconciliation** algorithm (idea-first sequenced). Ran an adversarial gap-check (3 parallel Plan agents) that surfaced real issues (small-group count de-anonymization, the bait-and-switch hand-off, the lazy-settle staleness risk, the `createdByUserId NOT NULL` constraint, a latent seed-wipe bug). Final user calls: **always anonymous** (no toggle), **deadline-only** convergence v1, **exact counts** (with honest "no names shown" copy), **hybrid tip**, **everything in one branch**.

### Implementation (6 commits)
1. `9da6f17` **schema + migration + seed** - `planPhase += floating`, `events.isAnonymous` + `minHeat`, `float_suggestions` + `float_votes` tables, a floating demo fixture, fixed `reseedDemo` wipe order (added the previously-missing `event_opt_outs`). Migration `0004_parched_rage.sql` is fully additive.
2. `6472924` **`reconcileFloat`** pure function (`packages/shared/src/logic/reconcile.ts`) + 11-case vitest table.
3. `965e784` **`floats` router** + `settleFloating` + privacy/ownership guards in `events.ts` + shared Zod inputs.
4. `3f972a0` **FloatBoard screen + dashboard Brewing zone** (`apps/mobile`).
5. `7936f10` **dial + multi-step wizard** (`NewDial`, `CreateWizard`), retiring `CreateEvent` + `quickpicks`.
6. `3e7e613` **brewing-float reminder** in the notifications seam.

## Key decisions & rationale

| Decision | Why this won | Alternatives weighed |
|---|---|---|
| **Reuse the `events` table** (new `floating` phase + `isAnonymous` flag) rather than parallel `floats`/`float_chips` tables | Cleanest **anonymity hand-off**: the same row keeps `isAnonymous=true` forever and simply never surfaces `createdByUserId`. No row-copying at tip, no synthetic "group bot" owner. | A separate `floats` table (adversarial reviewer's preference) - rejected because the tip would need to INSERT a new `events` row whose `NOT NULL createdByUserId` either re-attaches the originator (deanonymizes) or invents a bot user. The phase-pollution risk is bounded: existing branches check `=== "collecting"`/`=== "moment"`, so a `floating` row never trips them. |
| **`createdByUserId` stays `NOT NULL`** (stored, never surfaced) | "Ownerless/anonymous" is a *presentation + permission* property, not a null column. Keeping it avoids defensive null-handling everywhere and keeps the originator on record for abuse/accountability. Privacy enforced at the read boundary. | Making it nullable - rejected (ripples into every `isCreator` check; one missed gate = a real leak). |
| **Idea axis = fused what+where** (one axis, not two) | People float fused ideas ("bowling" = place+activity). Collapsing where+what drops the float from 3 polls to 2 axes - simpler and truer. | Separate where/what polls. |
| **Hybrid tip** (moment when a time band has 2+ backers of the winning idea; else a short collecting round; else fizzle) | Preserves the dopamine "it caught on - you in?" climax for strong floats, but never fires a blind commitment clock on a time only one person wanted (the adversarial bait-and-switch concern). Still always ends in a concrete event. | Always→moment (simplest, but the trap). Always→collecting (safest, but re-adds the poll grind the float was meant to skip). |
| **Loud floating register: exact counts visible, identities hidden** | Visible momentum ("4 into bowling") is the mechanism that beats polls and makes the 5th person comfortable to join. User explicitly chose exact counts and is relaxed on anonymity ("doesn't matter who floated it"). | Banded heat (hide exact numbers below ~3) - safer privacy, weaker momentum. Mitigated instead with honest **"no names shown"** copy (not "anonymous") + `minHeat >= 2`. |
| **+1 = interest, NOT commitment** -> fresh blind moment on tip | Consistent with how `react -> lock -> moment` already works (collecting reactions never auto-committed). Keeps floating loose (pile on freely) and the moment meaningful (real, blind RSVP). | Carrying float interest into the moment as a pre-yes - rejected (breaks blindness, conflates loose interest with commitment). |
| **Deadline-only convergence (v1)** with a **staleness clamp** | Simplest robust anti-poll-death mechanism; no scheduler exists (settle is lazy-on-read). The clamp fizzles a float left >7d past its deadline rather than resurrecting a stale plan in a dormant group. | Heat-based early tipping - deferred as a fast-follow. |
| **`reconcileFloat` is a pure function** | A future **AWS Bedrock** reconciler (semantic chip merge, compromise-finding) and sparse-float seeding can drop into the same signature without touching the caller. `ARCHITECTURE.md` already lists "AI seeding of suggestions" as deferred. | Inlining the logic in the router. |
| **"How pinned down?" dial as the single front door** | Turns the previously **hidden** `whenMode` ("the user never picks this label directly") into a friendly, visible choice and unifies the float with exact/options/fuzzy. Float is simply the open end. | Two separate buttons (Float vs Plan). The dial reconciles "a screen for detail level" with "float feels very different" (the downstream IS very different; the entry is one choice). |
| **Everything in one branch** (float + wizard rewrite) | User's explicit call. De-risked by modular commit sequencing + keeping `CreateEvent` until the wizard reached parity, then deleting it. | Decoupling (adversarial reviewer's recommendation: ship float first, wizard later). |
| **Assume push notifications exist (faked locally)** | User: the only blocker is the GBP99 Apple licence. Built the brewing-float reminder on the existing device-local `notifications.ts` scaffold, behind the same seam a real APNs/expo-push backend would slot into. | Building nothing (the existing moment reminders already cover a tipped float). |

## Things learned / discovered

- **Test runners differ by package.** `apps/api` uses the **node test runner** (`node --import tsx --test src/**/*.test.ts`, `node:test` + `node:assert`). `packages/shared` uses **vitest** (`vitest run`, `describe/expect/it`). Match the package you're in.
- **`drizzle-kit generate` was NOT interactive here** because the change was purely additive (new enum value appended, new columns, new tables - no renames). The CLAUDE.md hang warning only bites on ambiguous rename-vs-create. `ALTER TYPE ... ADD VALUE 'floating'` applied cleanly inside drizzle's migration transaction on the local Postgres (modern PG); we never *use* the new value in the same migration, so the in-transaction-usage restriction is moot.
- **The DB client (`apps/api/src/db/client.ts`) reads `DATABASE_URL` with NO fallback.** `drizzle.config.ts` has its own default (`postgres://drp:drp@localhost:5433/drp`), but one-off scripts and `pnpm dev:api` need `DATABASE_URL` set explicitly or libpq defaults to the wrong host/db (`InitPostgres` error at `postinit.c`).
- **Latent bug found & fixed:** `reseedDemo()` never deleted `event_opt_outs` (it predates this work). The new float FKs would have broken local boot without fixing the wipe order. Fixed: delete order is now `float_votes -> float_suggestions -> responses -> candidate_reactions -> event_opt_outs -> event_candidates -> events -> group_members -> groups -> users`.
- **`React.ReactNode` is not in scope** in the mobile screens (new JSX transform, no `import React`). Use `import { type ReactNode } from "react"` and `ReactNode`, matching the codebase.
- **Biome `noArrayIndexKey`** fires even on positional, non-reordering lists (the wizard's progress dots). Suppressed with an inline `// biome-ignore lint/suspicious/noArrayIndexKey: ...` comment.
- **`pnpm lint` is `biome check` (read-only); `pnpm format` is `biome check --write`** (auto-fixes). Run `pnpm format` before committing to clear formatting-only lint failures.
- **tRPC over HTTP for manual checks:** queries are `GET /trpc/<proc>?input=<urlencoded-json>` (non-batch, no transformer configured); mutations are `POST /trpc/<proc>` with the raw input JSON body. Dev auth via the `x-user-id` header (`DEV_AUTH_BYPASS=1`). Example: `curl -s 'http://localhost:3000/trpc/floats.get?input=%7B%22id%22%3A%22e_float_climb%22%7D' -H 'x-user-id: u_dev'`.
- **`appRouter.createCaller({ userId, log })`** is the cleanest way to integration-test procedures without HTTP (the context is just `{ userId, log }`; a no-op `log` stub works). Used for a throwaway `floatcheck.ts` that verified the full lifecycle, then deleted.
- **A stale API instance can hold `:3000`.** `lsof -ti:3000 | xargs kill -9` frees it. A `dev:api` boot still ran migrate + seed before failing on `EADDRINUSE`, which usefully confirmed the boot path.

## Current state

- **Merged to `dev`** via PR #32 (merge commit `84c89a9`). The 6 modular feature commits are preserved in history. `feat/float-an-idea` branch deleted (local + remote).
- **DRP-30 = Done** in Linear (team DRP_02), with a comment recording the breakdown and a final state comment.
- **Verified:**
  - `pnpm lint` clean, `pnpm typecheck` all 3 packages, **39 shared + 14 api tests** pass.
  - Migration `0004` applies cleanly on a real `dev:api` boot; the floating fixture seeds.
  - End-to-end over HTTP + via `createCaller`: `floats.mine`/`get`, `toggleVote` (count moved 2->3), `addIdea` case-insensitive dedup (stayed 2 ideas, idempotent vote), a **forced tip crystallizing to a named moment titled "bowling"**, `isCreator=false` for everyone incl. the original floater, and **no `userId`/`createdByUserId` in any floating read**.
- **NOT verified:** the mobile UI rendering (dial -> wizard -> board -> tip hand-off). Needs a run in Expo Go on a device/simulator. The screens typecheck against the live `AppRouter` and call the exact verified contract.

### Where the code lives
- Backend: `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0004_parched_rage.sql`, `apps/api/src/db/seed.ts` + `seed-data.ts`, `apps/api/src/routers/floats.ts` (new), `apps/api/src/routers/events.ts` (settleFloating + guards), `apps/api/src/router.ts`.
- Shared: `packages/shared/src/logic/reconcile.ts` (+ `.test.ts`), `packages/shared/src/schemas.ts` (float inputs + `PlanPhase += floating`), `packages/shared/src/index.ts`.
- Mobile: `apps/mobile/src/screens/FloatBoard.tsx`, `NewDial.tsx`, `CreateWizard.tsx` (all new), `apps/mobile/src/ui/FloatChip.tsx` (new), `apps/mobile/src/screens/Dashboard.tsx` (Brewing zone), `apps/mobile/src/lib/notifications.ts` (brewing reminder), `apps/mobile/App.tsx` (routes). Deleted: `CreateEvent.tsx`, `lib/quickpicks.ts`, `__tests__/quickpicks.test.ts`.
- Plan doc: `/Users/gong/.claude/plans/docs-drp-context-interviews-m3-intervie-delegated-newt.md`.

## Conventions, commands & workflows

- **Gates before any PR:** `pnpm lint`, `pnpm typecheck`, `pnpm test` (all must pass). Run `pnpm format` to auto-fix biome.
- **Branching:** routine work straight to `dev`; only a massive feature gets a `feat/*` branch -> PR into `dev`. Never push to `main` or PR a feature branch into `main`. CI runs only on PRs into `main`; CD on push to `main`. (PRs into `dev` have no CI gate.)
- **Issue tracking:** every unit of work is a Linear issue in team DRP_02 (find/create -> In Progress -> Done referencing the PR).
- **Modular commits:** commit each self-contained working step; keep history bisectable.
- **No em dashes** anywhere (code/docs/comments) - use hyphens. `apps/api` is ESM (relative imports need `.js`); mobile imports `@bethere/api` **type-only** (put float pure logic + Zod in `@bethere/shared`, which mobile can value-import).
- **Local run:** `pnpm db:up`; `pnpm --filter @bethere/api db:migrate`; `DATABASE_URL=postgres://drp:drp@localhost:5433/drp DEV_AUTH_BYPASS=1 SEED_ON_BOOT=reset pnpm dev:api`; `pnpm dev:mobile`.

## Known issues / caveats / risks

- **Mobile UI is unverified at runtime** - the dial/wizard/board flow has only been typechecked. Run it in Expo Go before relying on it. Watch specifically: the `navigation.reset(...)` hand-offs (wizard -> FloatBoard; FloatBoard tip -> `navigation.replace("EventDetail")`), the optimistic +1 vs the 5s poll (the board skips applying poll data while a toggle is in flight - if a mutation hangs, the board goes stale), and the band picker's day/tz handling.
- **Small-group de-anonymization is accepted, not solved.** In a 3-5 person group, a visible count of 1 (or count = roster-1) leaks who. Mitigated by honest "no names shown" copy and `minHeat >= 2` (a one-person float can't tip and self-reveal). Documented as an MVP acceptance.
- **Collecting fallback discards the float's time +1s** - when a hot idea has no agreed time, it opens a fresh collecting round; people re-react to the same times. Acceptable for the rare fallback path; could seed reactions later.
- **No scheduler:** a float in a fully dormant group never tips until someone opens the app (lazy-on-read). The staleness clamp makes a very-late open fizzle rather than resurrect. The (faked) push reminder mitigates engagement.
- **Anonymous spam** is possible (ownerless + anonymous + free text); only the IP rate-limit guards it. `createdByUserId` is kept server-side for accountability. Accepted for the friend-group MVP.
- **`floatcheck.ts` was a throwaway** integration script (deleted) - not in the repo. To re-run that style of check, recreate it with `appRouter.createCaller`.

## Next steps

1. **Run it in Expo Go** end to end: `+ New` -> dial -> Float (group, spark, window) -> FloatBoard; add idea/time chips and +1 from a second spoofed user; force the seeded `e_float_climb` to tip (advance its `lockAt`) and confirm the moment hand-off + the brewing reminder; regression-check the Rough/Set branches still create normal plans; confirm weekday labels and that quick-picks are gone.
2. When ready to ship to production, PR `dev` -> `main` (the only path that triggers CI + CD).
3. Fast-follows (deferred this iteration): **heat-based early tipping**; **AWS Bedrock** as the `reconcileFloat` body + sparse-float seeding (the seam is ready); **light chat integration** (Felicity's "why leave WhatsApp?" retention concern); semantic chip de-dup.

## References

- Interviews: `docs/drp-context/interviews/m3 interviews (iteration)/{felicity,tom,luca} interview.txt`
- Plan: `/Users/gong/.claude/plans/docs-drp-context-interviews-m3-intervie-delegated-newt.md`
- Architecture: `ARCHITECTURE.md` (convergence model, privacy boundary, deferred list incl. "AI seeding of suggestions")
- PR: https://github.com/gong8/drp_02/pull/32 ; Linear: https://linear.app/drp-02/issue/DRP-30
- Pure logic to reuse: `packages/shared/src/logic/{reconcile,candidates,window,lock}.ts`
- Privacy/settle patterns to mirror: `apps/api/src/routers/events.ts` (`settleCollecting`, `settleFloating`, the `floating` read branches, `isCreator` guard)
