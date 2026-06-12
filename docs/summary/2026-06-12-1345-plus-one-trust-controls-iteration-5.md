# Iteration 5: +1 trust controls - joins lock, brought-by attribution, Who's-invited roster (DRP-63) - 2026-06-12

**Branch:** `dev` (worked directly, no feature branch) | **PRs:** none opened this session; PR #48 (`dev` -> `main`) was merged 2026-06-12 11:11 by the team, carrying this work to prod | **Linear:** DRP-63 (Done) | **Scope:** Read the Nathan M4 interview, design iteration 5 from it, and ship it end-to-end: control over who can join a meetup by link, visibility of who each +1 is and who brought them, and awareness when the roster changes after you respond.

## TL;DR

The session started from the Nathan M4 interview (`docs/drp-context/interviews/m4 interviews/nathan interview.md`) and the user's hypothesis ("the creator can lock out +1s; we should see who a +1 belongs to"). Brainstorming against the interview reshaped that into three slices - a **+1 door** (`joinsOpen` + `lockJoins` on events), **brought-by attribution** (`?via=` on share links -> `event_participants.invited_by`), and a **Who's invited roster sheet** with NEW badges - with the met-before signal explicitly deferred. The whole feature shipped in 7 commits (`2ce8a01`..`5452e4e`) on `dev` with `pnpm check` green throughout (135 shared / 454 API / 230 mobile tests + quality). A 12-agent adversarial review workflow then produced 4 "confirmed" findings, of which one was fixed (FK `ON DELETE SET NULL`), two were documented as deliberate, and one was **refuted empirically** - a reminder that verifier agents can share a wrong framework prior. Pushed to the dev stack; DRP-63 marked Done; a screenshot shot-list for the iteration-evidence writeup was produced at the end.

## What was done

### 1. Interview analysis (brainstorming phase)

Nathan's +1 thread decomposed into three distinct asks, which differ from the user's initial framing:

1. **Control, but his bar is "controlled", not "creator-gated".** Trigger: he discovered a +1 can re-share the link ("I can still share it... I can imagine a group really expanding"). His real-life protocol is awareness ("hey guys, this guy wants to go, is that fine?... just to let people know"), not approval votes.
2. **Awareness with a timing edge.** "I vote right after the event is made, and between when I vote and when the votes are tallied, someone else gets invited." The failure mode he hates is showing up and a stranger is there.
3. **Recognition (deferred).** "This person has been to an event with you" linking to the past event - the idea he got excited about, but the biggest build of the bundle.

Side findings, no action: he was skeptical of multi-group meetups (DRP-62) but his fallback ("I'd just create a new group with everyone") is literally `groups.createFromEvent` - good validation; he concluded the hidden-members-before-join design is "fine how it is".

### 2. Design decisions settled via AskUserQuestion (one at a time)

- Scope: brought-by attribution + roster awareness + creator lock (met-before deferred).
- Lock shape (user's custom answer): the creator picks open/closed at suggestion AND whether that choice is locked; **locked = frozen for everyone forever** (consistent with `lockTimes`/`lockActivity`), unlocked = any group member can toggle later.
- Roster UI: the **full "Who's in" sheet** (over a +1s-only section or strip+sheet).
- Attribution mechanism: **Approach 1, `?via=<userId>` query param** (over a per-sharer token table).

After two design sections were presented, the user said "just use best judgement and implement in full", waiving the remaining review gates.

### 3. Implementation (7 commits, each `pnpm check`-green)

| Commit | Slice |
|---|---|
| `2ce8a01` | Spec: `docs/superpowers/specs/2026-06-11-plus-one-trust-controls-design.md` |
| `000ef95` | Shared Zod: `joinsOpen` (default true) / `lockJoins` (default false) on `CreateEventInput`; `JoinByTokenInput` (`via` optional); `SetJoinsOpenInput`; tests |
| `27cd5dd` | DB: migration `0012_plus_one_trust_controls.sql` + journal idx 12 (`events.joins_open/lock_joins`, `event_participants.invited_by/joined_at`); zero backfill, defaults = today's behavior byte-for-byte |
| `07aa44a` | API: door + attribution + roster + toggle (details below); 22 new DB-backed tests |
| `9766c44` | Mobile funnel: via through link/stash/OAuth-reload; closed-door states; `lib/rosterSeen.ts` |
| `b63c941` | Mobile UI: WhoIsInSheet, Who's-invited row, wizard door pair, share-sheet closed hint; UI tests |
| `5452e4e` | Review fixes: FK `ON DELETE SET NULL` (migration amended pre-ship), door-race + og:url documentation |

(`21f68b7` "chore: add nathan interview" appeared on `dev` mid-session from outside this session - the file was untracked at session start and was committed separately, presumably by the user.)

**API surface** (`apps/api/src/routers/events.ts`):
- `joinByToken`: roster no-op check FIRST, then the door - so a closed door blocks NEW people only and existing members/participants always reopen their link. `via` is trusted only if that user is in the roster right now and is not the joiner; bogus/stale/self via degrades to null attribution, never an error.
- `shareLink`: mints `?via=<caller>` (URL-encoded) and returns `via` bare for the client's own-origin fallback URL.
- `previewByToken`: + `joinsOpen` (a bare boolean, leaks no identity) so the logged-out landing shows "closed" before OAuth.
- NEW `events.roster` (roster-gated via `loadEvent`): origin group then attached groups (member cards via the `getUserCards` batch), then participants `{card, invitedBy card|null, joinedAt}` sorted by join time; a participant who later joined a constituent group "graduates" out of the +1 list; `canToggle` = group member AND `!lockJoins`.
- NEW `events.setJoinsOpen`: rejected when `lockJoins` (frozen); restricted to **group members (origin or attached), never ad-hoc participants** - a +1 must not reopen a door the group closed. Last-write-wins boolean (no CAS).
- New helpers in `apps/api/src/db/groups.ts`: `eventGroupIds` (origin + attached, reused by `rosterUserIds`) and `isGroupLevelMember`.

**Mobile funnel** (`apps/mobile`):
- `lib/meetup.ts`: `extractMeetupVia` (regex `[?&]via=([^&#]*)`, decode, anchored on `/m/`), `meetupUrl(token, via?)`, stash now JSON `{t, v}` with back-compat parsing of a pre-DRP-63 bare-token stash.
- `lib/usePendingMeetup.ts`: `useMeetupLaunchToken` -> `useMeetupLaunch(): {token, via}|null`; signed-out stash captures via; resume passes via to `joinByToken`.
- `JoinMeetup.tsx`: `route.params.via` rides the `/m/:token?via=` deep link into the join; closed door renders a notice + an "I'm already in - open it" outline CTA (no-op success routes members to the plan); FORBIDDEN maps to a "closed" error state. `MeetupWelcome` gains a `via` prop (the Gate passes it) so its pre-sign-in stash doesn't clobber attribution, plus a closed-door notice with a downgraded "Sign in" CTA.
- `lib/rosterSeen.ts`: device-local last-seen markers (localStorage on web, in-memory Map on native). `seedRosterSeen` baselines silently on the FIRST roster read (no all-new noise); `markRosterSeen` advances to `max(latest joinedAt, Date.now())` (clock-skew tolerant) when the sheet **closes** - not on open, so NEW badges are visible inside the sheet.

**Mobile UI**:
- `screens/event-detail/WhoIsInSheet.tsx` (+ exported `rosterHeadcount`, a distinct-id union since groups can overlap): door CheckOption on top (visible to all, enabled per `canToggle`, frozen note when `lockJoins`), group sections of PersonRows, then "+1s" with "via Leo" captions and NEW StatusPills.
- `EventDetail.tsx`: "Who's invited" Row (headcount + "N new" pill) under the plan header in all phases; `events.roster` polled alongside `events.get`; `whoSheet` added to the share-bar-hiding union; PlanShareSheet uses `meetupUrl(s.token, s.via)` for the fallback and swaps its hint to `SHARE_MEETUP_CLOSED_HINT` when the door is closed.
- `CreateWizard.tsx`: "Open to +1s" + "Lock this choice" CheckOptions on the **group step** (the audience step), payload sends both flags, confirm summary gets a "+1s" row.
- Copy in `lib/copy.ts`; UI title is **"Who's invited"**, deliberately NOT "Who's in" (see Decisions).

### 4. Adversarial review + triage

A background Workflow (`drp63-adversarial-review`, 12 agents): 5 lenses (authz/gate-ordering, anonymity, client funnel, repo conventions, edge cases) over `git diff 2ce8a01..HEAD`, then a per-finding adversarial refuter. 7 raw -> 4 "confirmed":

1. ~~"Deep-link `?via=` lost for authed users - React Navigation string patterns don't parse query params"~~ - **refuted empirically.** A 5-line throwaway jest test calling the real `getStateFromPath('/m/e_abc123?via=u_99', config)` returned `params: {token: 'e_abc123', via: 'u_99'}`. RN merges query params into the leaf route's params by default. No change.
2. "og:url drops `?via=`" - **intentional**, now documented in `api/m.ts`: og:url is the unfurl's canonical identity (via-free dedupes card caches across sharers); the hyperlink the recipient taps keeps via.
3. "`invited_by` FK defaults to RESTRICT, blocking future user deletion" - **fixed** in `5452e4e`: `ON DELETE SET NULL` (a deleted inviter degrades the +1 to unattributed, same rendering as a bogus via). Migration 0012 amended **pre-ship** (it had not run on dev/prod yet); local DB rebuilt (`docker compose down -v && pnpm db:up && db:migrate`) and the constraint verified via `pg_constraint`.
4. "joinByToken read-then-insert race vs a concurrent door close" - **accepted last-write-wins**, made explicit in the code comment ("a social door, not an auth boundary"); no SELECT FOR UPDATE.

### 5. Wrap-up

Pushed `db3a8d4..5452e4e` to `origin/dev` (deploys the dev stack). Linear DRP-63: decision log + review log comments, marked Done. Memory file `review-triage-empirical-probe.md` written. Finally, produced an 8-shot screenshot list for the iteration-evidence writeup (wizard door pair, confirm summary, `?via=` link, "N new" pill, the sheet with attribution + NEW badge, door toggled closed, logged-out closed landing, authed closed screen - with the staging order needed to make the badge appear).

## Key decisions & rationale

- **`?via=` query param over a per-sharer token table.** Both have IDENTICAL forwarding semantics (a forwarded link attributes to its minter either way - which is correct: "joined via Leo's link"), so the table only buys spoof-resistance. Attribution is a trust signal, not a security boundary; the door is the enforced control. Bearer-link reality: "only members can re-share" is unenforceable (a URL is text), so the only real gate is `joinByToken`.
- **Lock depth: frozen for everyone** (user's call, after an explicit fork question): consistent with `lockTimes`/`lockActivity`, and avoids introducing the app's first creator-privileged runtime action (creator anonymity stays a clean invariant).
- **Toggle constituency: group members only, never +1s.** Letting a +1 reopen a closed door would recreate exactly the expansion Nathan flagged.
- **Door-before-roster ordering inverted: roster no-op FIRST.** A closed door blocks NEW people only; existing people always resolve their link to the plan.
- **"New" badge is a device-local seen marker, not server state.** `candidate_reactions`/`responses` carry no timestamps, so "since you responded" needs schema churn for a weaker semantic than "since you last looked" (you look when you respond). Limitation accepted: native markers are in-memory (reset per launch); web (the demo hero) persists.
- **Badge clears on sheet CLOSE, not open** - otherwise the NEW pills would vanish before being seen.
- **Naming: `joins*` in code, never `plusOne*`** - "+1" already means a candidate vote in this codebase. And UI copy **"Who's invited"** (audience) vs the cleared reveal's existing **"Who's in"** (going crowd) - a real string collision found by a failing test, then kept as a deliberate vocabulary distinction.
- **Wizard placement: the group step** - the door is an audience setting, and the axis locks already live in their own axis steps.
- **`events.setJoinsOpen` is last-write-wins, no CAS** - a boolean toggle has no meaningful edit conflict (unlike `events.update`'s text fields).
- **FK `ON DELETE SET NULL`** - soft attribution should degrade, not block deletes; matches the existing `fallbackUserCard` philosophy.
- **Review findings are triaged, not blindly applied** - one of four "confirmed" findings was a false positive; settled by running code, not by arguing priors.

## Things learned / discovered

- **React Navigation DOES merge URL query params into route params** with a plain string pattern (`m/:token` + `?via=x` -> `params {token, via}`). Proven with `getStateFromPath` from `@react-navigation/core` inside the jest env (plain `node -e` can't require it - it pulls `react-native`'s Flow-typed index).
- **Adversarial verifier agents can confirm false framework claims** when reviewer and verifier share the same wrong prior. Cheap antidote: a throwaway probe test in the project's real test env (drop into `src/lib/__tests__/zz-*.test.js`, run, delete). Saved as memory `review-triage-empirical-probe.md`.
- **RNTL stale-element gotcha:** `findByText` can resolve an element from the pre-transition tree that an in-flight state update then unmounts; the subsequent `toBeOnTheScreen()` fails with "element could not be found in the element tree". Fix: wait on text unique to the POST-transition state, then assert the shared text.
- **Hooks-order violation masked as `window.dispatchEvent is not a function`** under jest-expo (again): `useCallback`s added after `EventDetail`'s `if (loading) return ...` early returns produced "React has detected a change in the order of Hooks". All hooks must sit above the early returns.
- **The mobile trpc manual mock lazy-proxies every procedure path, but an unmocked leaf resolves `undefined`** - so a screen calling a NEW procedure (`events.roster`) makes `.query(...).then` throw synchronously in every existing test of that screen. Fix: a default `mockQuery(trpc.events.roster, emptyRoster())` in the suite's `beforeEach`.
- **The strict-keys anonymity test** (`previewByToken` asserting exact `Object.keys`) is a great tripwire - it forced a conscious decision when adding `joinsOpen` to a public payload.
- **Vercel rewrites preserve query strings** (`/m/abc?via=x` -> `/api/m?id=abc&via=x`), so the OG function sees via and simply ignores it; chat unfurl caches key on the full URL, so per-sharer links fragment unfurl caches slightly (accepted).
- Local compose Postgres: container `drp_02-postgres-1`, creds `drp`/`drp`, db `drp`, host port 5433. `pg_get_constraintdef` over `pg_constraint` is the quick FK-clause check.
- Migration journal pattern continues: next idx 12, `when` increments by 1000 (`1780500007000`).
- An amended-but-unshipped migration is safe to edit, but the **local** DB must be rebuilt (`docker compose down -v && pnpm db:up && pnpm --filter @bethere/api db:migrate`); the API test harness applies migrations fresh so the suite validates the new SQL.

## Current state

- All DRP-63 work is on `dev`, pushed (`db3a8d4..5452e4e`). The dev stack (App Runner `bethere-api-dev` + `bethere-dev.vercel.app`) auto-deployed from that push; migration 0012 (with SET NULL) runs on API boot.
- **PR #48 (`dev` -> `main`) merged 2026-06-12 11:11** - the team shipped to prod after this session's push (not done from this session; contents not independently verified here, but DRP-63 was the head of `dev`).
- `pnpm check` green at the final commit: shared 135, API 454, mobile 230 tests; lint; typecheck; quality.
- Linear DRP-63 is Done with the full decision + review log. Spec committed. Working tree clean.
- **Not yet done:** a manual end-to-end dry-run of the funnel on the deployed dev stack (share -> second account joins -> "via X" + NEW badge -> close door -> link shows closed). The user was about to screenshot these flows for iteration evidence, which doubles as the dry-run.

## Conventions, commands & workflows

- Brainstorm -> spec (`docs/superpowers/specs/`) -> Linear issue In Progress -> modular commits (each green) -> adversarial review workflow -> triage with empirical probes -> push dev -> Linear Done. The user can waive spec/plan review gates ("use best judgement and implement in full").
- House rules honored and re-verified by the review's conventions lens: no em dashes anywhere; `apps/api` ESM `.js` relative imports; `apps/mobile` imports `@bethere/shared` type-only; hand-authored migrations + journal; no escape hatches (`pnpm quality`).
- Run mobile tests with `npx jest --forceExit` from `apps/mobile`; API DB tests need `pnpm db:up` (the harness makes its own test DB).
- `pnpm format` before committing (biome resorts imports; expect it to touch files).

## Known issues / caveats / risks

- **Native NEW badges reset per app launch** (in-memory seen markers; no AsyncStorage dependency). Web persists. Acceptable for the demo; revisit if native becomes primary.
- **Attribution is spoofable by URL editing** (by design - documented in spec and code). The door is the security control, not via.
- **Door race:** a join racing a concurrent close can slip through (documented accepted last-write-wins; no test covers true concurrency).
- **The funnel was not manually browser-tested post-deploy this session**; unit/DB coverage is strong but the live OG/redirect/OAuth chain has bitten before (DRP-56).
- Legacy `/m/<id>` links (no via) and pre-DRP-63 stashes keep working (null attribution); the unrecognized-JSON stash shape returns null rather than a bogus token.
- Per-sharer URLs fragment chat unfurl caches (same card, more cache entries) - cosmetic.
- The roster query is polled at `POLL_MS` alongside `events.get` on EventDetail - one extra light query per tick; fine at current scale.

## Next steps

- Manual dry-run + screenshots on `bethere-dev.vercel.app` (shot-list in the conversation: wizard door pair, confirm "+1s" row, `?via=` link, "N new" pill BEFORE opening the sheet, sheet with "via <name>" + NEW badge, door toggled closed, logged-out closed landing, authed closed screen). Badge staging: member views plan FIRST (seeds the marker), then the +1 joins, then revisit.
- Next iteration candidate (deferred from this one, Nathan's favorite): the **met-before signal** ("has been to [bowling, May] with you", linking to the past event, or mutual groups).
- If native persistence starts to matter, move rosterSeen to a real storage dep (or server-side once responses get timestamps).

## References

- Spec: `docs/superpowers/specs/2026-06-11-plus-one-trust-controls-design.md`
- Interview: `docs/drp-context/interviews/m4 interviews/nathan interview.md`
- API: `apps/api/src/routers/events.ts` (joinByToken/shareLink/previewByToken/roster/setJoinsOpen), `apps/api/src/db/groups.ts` (eventGroupIds/isGroupLevelMember), `apps/api/src/db/migrations/0012_plus_one_trust_controls.sql`
- API tests: `apps/api/src/routers/events-share.test.ts`, `apps/api/src/routers/events-roster.test.ts`
- Mobile: `apps/mobile/src/lib/{meetup,usePendingMeetup,rosterSeen,copy}.ts`, `apps/mobile/src/screens/JoinMeetup.tsx`, `apps/mobile/src/screens/EventDetail.tsx`, `apps/mobile/src/screens/event-detail/WhoIsInSheet.tsx`, `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/App.tsx`
- OG note: `api/m.ts` (via-free canonical og:url rationale)
- Prior context: `docs/summary/2026-06-10-1705-adhoc-cross-group-meetups.md` (DRP-62 roster model this builds on), `docs/summary/2026-06-10-1332-meetup-link-conversion-funnel-and-og-cards.md` (DRP-56 link funnel)
- Linear: DRP-63 (https://linear.app/drp-02/issue/DRP-63)
