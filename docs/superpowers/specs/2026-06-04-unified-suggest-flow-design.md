# Unified "suggest a hangout" flow - design spec

Status: draft for review (2026-06-04)
Owner: design brainstorm (Leixin + Claude)
Supersedes the create-flow parts of the convergence model (M3 / DRP-29) and the standalone float feature (DRP-30).

## TL;DR

Replace the three-way create dial (float / rough / set) and the separate float board with **one create flow** and **one votable plan**. A plan carries two collaborative candidate lists - **time** candidates and **what/where** candidates - and members **+1** them with **public counts and no names**. The creator gets **two checkboxes, both off by default** (the group can shape it): *Lock the times* and *Lock the plan*. The old modes become positions of those two toggles. The float frontend is deleted; the evolved voting board is the only board. Anonymity stays on and is clearly communicated in the UI.

## 1. Problem

The create flow's front door asks "How pinned down is this?" (`NewDial.tsx:51`) and sorts three cards on a time-**precision** gradient (float -> rough -> set). No interviewee thinks in precision. They think in **intent**, and they **start loose then harden** as one continuous act.

The smoking gun (Luca): for *"an afternoon meetup where I just want to see who's free and who's down to do what,"* he could not tell which of the three to pick. His intent decomposes into a rough **when**, a desire to see **who** is free, and an undecided **what** - and the dial asks the one question he cannot answer yet, because not-knowing-yet is the whole reason he opened the app. The closest fit (float) hides that behind the label "just an idea," forced anonymity, and the jargon word "auto-tips."

Two deeper faults the precision axis creates:
- It silently bundles three unrelated decisions into one card: anonymity (only float was anonymous), ownership (only float was ownerless / could not set its own time), and openness of the **what** (only float let the activity change). None are surfaced at the choice point.
- It is the wrong axis. Intent and precision are orthogonal: someone who knows exactly what (bowling) but not when is "rough" on precision yet socially certain.

## 2. Research basis

From all 7 interviews + a competitive scan (full synthesis in session history). The distinct intents a create flow must serve:

1. **Float a loose idea cheaply / lower the suggester's exposure.** The most-corroborated job. Felicity: *"nobody's really willing to push things."* Luke: *"move effort away from the initiator."* This is *why* anonymity matters.
2. **See who's free and who's down before committing** (Luca's case verbatim).
3. **Know the activity, not the time - offer a few times and let it converge** (the old "rough").
4. **Announce a fully-decided event and collect who's in** (Tom: "more common to have one singular date and time").
5. **Propose a loose time window, not an exact clock time** (Felicity, Luke: "afternoon / evening").
6. **Start loose, then harden it yourself** - one sequenced act, not a fork (Luca: "when do you guys want to do something... and then if people are hella keen, just declare a time and place").
7. **Let it firm up automatically; chase non-responders for me.**
8. **Suggest the where / what collaboratively, not just the when** (Felicity: "suggest locations... otherwise you end up at the same person's house every time").

Tom independently re-invented our answer: *"one option with an add-a-time below it... by default only one but you can remove it all the way down to any."* Partiful / Howbout ship exactly this (a quiet "poll your guests" under a single date field).

## 3. The model

### 3.1 One plan, two candidate lists

A plan has:
- an optional **title / what** (the headline; may be left open),
- a list of **time candidates**,
- a list of **what/where candidates** (activities and/or places),
- two **collaboration locks** (below),
- a **decides-by** time,
- creator **anonymity** (always on this iteration).

Members **+1** any candidate. **Counts are public to the whole group; names are never shown** (neither who +1'd, nor who added a candidate).

### 3.2 The two locks (the only new control)

Two creator checkboxes, **both off by default** = the group can shape it. Off means open; ticking keeps control.

- **Lock the times** - others cannot add time candidates (they can still +1 the ones present).
- **Lock the plan** - others cannot add what/where candidates.

The old three modes become positions of these two flags plus how many time candidates exist:

| Old mode | In the unified model |
|---|---|
| float (fuzzy) | both unlocked, loose/zero fixed time, what open |
| flexible (options) | a few time candidates, vote it out |
| concrete (exact) | both locked + one time -> straight to "who's in?" |

No picker. One flow. The locks and the number of times you add place the plan anywhere on the spectrum.

### 3.3 Privacy principle: public for momentum, blind for honesty

- **Collecting / voting (public counts, no names):** vote counts on times and places are visible to everyone. This is the social proof that makes the first +1 free (Felicity: "once a few people do, everyone does"; the float's "visible counts are the momentum engine").
- **The who's-in moment (blind):** the later commitment step stays blind until it resolves, so nobody's nervous yes/no cascades (Luke's no-public-maybe point).

This is the clean rule the whole design hangs on: public where we want momentum, blind where we want honesty.

## 4. Anonymity (this iteration) - and how the frontend makes it clear

Anonymity of the **creator** is always on this iteration (no toggle), consistent with the earlier product decision. The two locks are about collaboration permission, not identity - they are orthogonal.

This iteration must keep anonymity **clearly communicated on the frontend** (an explicit requirement). It is signalled, not buried in a disclaimer, on every surface where identity would otherwise be implied:

- **Create confirmation screen:** the plain-language mirror states it as a property of the group, e.g. *"No names - it's the group's."*
- **Voting board:** a persistent quiet line in the footer, e.g. *"No names - just the group,"* plus the structural fact that no candidate or vote ever shows an author.
- **Adding a candidate:** because candidate authorship is never surfaced, suggesting a time or place is as low-exposure as the float was. Microcopy at the add affordance reinforces it where useful (e.g. *"added anonymously"*).
- **Language everywhere is agentless / group-owned** ("the group decides," "who's about," "catching on") - never "X suggested" or a host/organizer label.

Accepted limitation (existing tech-debt, now slightly wider): in a 3-5 person group a visible count of 1 can hint at who. We keep this accepted, mitigated by the honest "no names shown" copy (not the over-promising word "anonymous") and by keeping candidate authorship hidden. We do **not** hide counts (they are the momentum engine).

## 5. The create flow (wizard)

Still a **wizard - one thing per screen** (not a big form). Keeps Model 1's brain: no mode picker, examples as the interface, and a final plain-language confirmation mirror. Shape is **adaptive**: the path stays relevant to what was entered.

Indicative steps:

1. **What do you fancy?** (optional - "leave it open, let the group decide"). Example chips (the pub, food, bowling, just a catch-up). Group is preselected (chooser only if the user is in several). A second what/where chip can be added here or on the board later.
2. **When?** Defaults to a single loose option ("this afternoon", part-of-day or a window) with "+ add a time" beneath and "pick an exact time instead" under that. Add 0 = loose; 1 exact = concrete-leaning; 2+ = a vote.
3. **Before you send (the two locks + decides-by):** the two checkboxes (default off), and an editable **"Decides by [Fri evening]"** line with a sensible visible default and a "Change" affordance. The "Lock the plan" checkbox only appears when an activity is present (nothing to lock otherwise).
4. **Confirmation - "Here's what'll happen" (the screen we keep):** the plain-English mirror that reflects the outcome and states the anonymity property, then **Send to the group**.

### 5.1 The confirmation mirror copy (per outcome)

The mirror rewrites itself from the entered data. No mode names. Examples:
- Loose time, what open: *"You're floating this to Uni mates. No names - it's the group's. They'll say what they fancy and who's about, and it comes together. Decides by 5pm today."*
- 2-3 times: *"The group picks the time that works; best one wins. No names. Decides by Thu."*
- One exact time, both locked: *"It's on. Asking who's in for Fri 8pm."* (no decides-by needed)

The decides-by chip in the mirror is editable (this is the "let a float set its own resolve time" ask; the `tipAt` plumbing already exists and was simply never sent by the wizard).

## 6. The voting board (unified)

Evolved from the flexible/options "collecting" view; it is now the single board for all plans. Sections:

- **Header:** group name, a state word ("catching on"), and the decides-by countdown ("decides in 4h").
- **Title / what** headline (or an open-idea framing if the what is open).
- **When works?** time candidates, each a row with label, a relative-support bar, a **public count**, and a +1 control (your own vote highlighted). If times are unlocked: a **"+ suggest a time"** affordance.
- **What / where?** what/where candidates, same row pattern and counts. If the plan is unlocked: **"+ suggest a place / thing."** This section appears only when the what is open or candidates exist.
- **Footer:** the anonymity line ("no names - just the group") and the decides-by.

When the plan is concrete (both locked, one time): no voting and no "+ suggest" - the same screen collapses to the fixed time + place and a blind **who's in?**.

## 7. Lifecycle

`collecting (voting) -> [decides-by resolves] -> moment (blind who's in) -> cleared` (or silent `fizzled` if no traction by decides-by).

- **Resolve at decides-by:** picks the winning **time** (required to schedule the moment) and the top-voted **place** if any place candidates exist; otherwise the place is shown as "leaning: Bowling" / TBD. (Decision ①)
- **The blind who's-in moment still runs** once the time locks. Voting answered "which time / what" (low-commitment interest); the moment answers "am I actually coming" (commitment). They are different questions; copy must keep them distinct so it does not read as voting twice. (Decision ②) The moment's internal redesign is out of scope here.
- A concrete plan skips collecting and opens straight into the moment.

## 8. Vocabulary cleanup

Drop jargon with no real-world referent; unify the two-word (tip vs lock) split into one.

| Current | Replacement |
|---|---|
| auto-tips / tips / tipped / "auto-tips {countdown}" | **Decides by {time}** (countdown), **Locks in / It's on** (resolved) |
| Brewing | **Catching on** / Gathering interest |
| spark / "What's the spark?" | **What do you fancy?** / What's the idea? |
| the moment / "Start the moment" | **Who's in?** |
| minHeat / heat (hidden fizzle threshold) | not exposed; if a plan dies: *"Not enough people were keen, so it didn't happen."* |
| band / part-of-day (hardcoded "evening") | a real, user-visible **time of day** pick (morning / afternoon / evening / late) |
| whenMode / exact / options / fuzzy | internal/derived only; never user-facing; UI names map 1:1 to internals |

Also: one name + one verb per path end to end (no "Rough plan" entry with a "Suggest it" submit).

## 9. Decisions resolved

- ① decides-by locks the winning **time** plus top **place** if any, else place stays leaning/TBD.
- ② the blind **who's-in moment** still runs once the time locks.
- ③ the **what/where** section and its lock appear only when the activity is open or has candidates.
- Anonymity: **always on** this iteration, clearly communicated on the frontend (section 4).
- Checkbox copy: ship the lock framing ("don't let others suggest other times / things to do"), default off. A positive phrasing ("Let the group add their own times / ideas," default on) is an acceptable equivalent; final wording to be picked during build.

## 10. Out of scope / fast-follow

- Internal redesign of the who's-in **moment** (binary vs three-tier RSVP, timer).
- **Availability-first** auto-assembly (Luke's model) - layer later as an option inside the loose path.
- **Web / no-install RSVP link** (Felicity's adoption barrier).
- **System nudging** of non-responders.
- **Reschedule-on-deadlock** ("try another day") as a first-class outcome.
- Whether collaborative where/what ships in this build or a fast-follow is the one scope call to confirm with the team.

## 11. Implementation surface (change inventory)

Derived from a read-only blast-radius analysis (verified against current source). This scopes the refactor; exact edits belong to the implementation plan.

### 11.1 Data model / DB reshape

One new forward migration. Do not edit applied migrations; `drizzle-kit generate` hangs on rename-vs-create in a non-TTY, so hand-author, and reset the local DB (`docker compose down -v && pnpm db:up`) if rebaselining. Copy-then-drop, never drop-only (live data via `SEED_ON_BOOT=if-empty`).

- `events`: add `lock_times` bool default false, `lock_things` bool default false; rename `lock_at` -> `decides_by`; `is_anonymous` always true (keep as effectively constant or hard-code in code); drop `min_heat` (unless a support gate survives, then fold into `quorum`); `when_mode` dropped or kept derived-internal (never on the wire).
- `event_candidates` becomes the single table for both lists: add `kind` enum ('time'|'activity') default 'time' (reuse the renamed `float_axis` enum); make `starts_at` nullable; use/add a text/label column for activity/place text; optional `created_by_user_id` for accountability (never surfaced).
- `candidate_reactions` is the unification target for `float_votes`: semantics become public per-candidate counts; the router serialization must strip userIds so only counts cross the wire (shared tally still uses userIds internally).
- `plan_phase` enum: drop 'floating' (back-migrate floating -> collecting first; rebuild the enum type, since Postgres cannot drop a value).
- Data copy (mandatory before drops): `float_suggestions` -> `event_candidates` (axis idea -> kind activity, text -> label; axis time -> kind time), `float_votes` -> `candidate_reactions` (suggestion_id -> candidate_id); source former-float titles from the top-voted activity; then drop `float_votes`, `float_suggestions`, `min_heat`.

### 11.2 Deletions (float-only)

- mobile: `FloatBoard.tsx`, `NewDial.tsx` (3-branch dial; or thin to an intro), Dashboard `FloatCard`, CreateWizard 'window' step + timescale state, `FloatChip` (repurposed to `VoteChip`).
- api: `routers/floats.ts` (after merge), `settleFloating` + `FLOAT_STALE_MS`, float imports.
- shared: `CreateFloatInput`, `FloatWindow`, `AddIdeaInput`, `AddTimeInput`, `ToggleVoteInput`, the `WhenInput` union; `reconcile.ts` (delete if we adopt `settleCollecting`'s most-voted-wins; else generalize and salvage `pickByBackerCount`).
- schema: `floatSuggestions`, `floatVotes` tables (after copy).

### 11.3 Merges (float logic into events)

- `floats.create` -> `events.create` (one input: title?, timeCandidates[], thingCandidates[], lockTimes, lockThings, decidesBy?).
- `floats.addIdea` + `floats.addTime` -> `events.addCandidate(kind)`, gated by the lock flags.
- `floats.toggleVote` -> one public per-candidate vote toggle over either kind.
- `floats.mine` / `floats.get` -> `events.mine` / `events.get` (remove the `phase==='floating'` early-returns; return both candidate lists with public counts).
- CreateWizard's three-branch submit -> a single `events.create` call.

### 11.4 Generalizations

- `EventDetail` CollectingView becomes the single voting board: also renders the what/where list with public +1; the time list flips from the private SelectCheck to public counts; gate '+ add a time' on lockTimes and a new '+ add a place/activity' on lockThings.
- `settleCollecting` stays as the auto-lock-at-`decidesBy` engine; it must now also resolve the winning activity into `events.title` at lock time (responsibility moved out of the deleted float engine).
- `addCandidateHorizon` drops the isFuzzy branch (mirror in both shared `lock.ts` and the hand-maintained mobile `lib/lock.ts`).
- Living docs `README.md`, `CLAUDE.md`, `ARCHITECTURE.md` rewritten to the one-flow/two-locks model (CLAUDE.md highest leverage). Do NOT find/replace across `docs/summary`, `docs/superpowers`, `docs/drp-context` - immutable history; write a new summary when it ships.

### 11.5 Renames (vocabulary unification)

`lock_at`/`tipAt` -> `decidesBy`; `floatAxis`/`FloatAxis` -> candidate `kind`/`CandidateKind`; `FloatChip` -> `VoteChip`; 'idea' -> 'activity'; `defaultLockAtForOptions` -> `defaultDecidesByForCandidates`; `settleFloating`/`reconcileFloat` -> `resolvePlanAtDeadline`/`reconcilePlan` (if kept); CreateWizard per-branch `STEPS`/`TITLES`/`SUBMIT_LABELS` + `branch` route param -> a single sequence.

### 11.6 Risks (load-bearing)

- **Type-chain coupling:** frontend float removal + backend router merge + shared schema change must land in ONE PR (trpc types auto-derive; a half-landing breaks typecheck).
- **`isAnonymous` double duty:** it means both "ownerless" and "hide creator name." Split them (keep name-hiding always on, drop ownerlessness) or the lock authorization breaks (the float-owner-can't-lock guard, and `isCreator = !isAnonymous && createdByUserId===caller`). A still-anonymous creator needs a creator-self check that never leaks `createdByUserId`.
- **Private -> public count flip:** counts were deliberately hidden before the blind moment (anti-bandwagon). Making them public for both lists is an intended behavior reversal per our "public for momentum" principle; confirm the auto-lock winner-pick still holds with public counts.
- **Vote-table semantic mismatch:** `candidateReactions` uses replace-my-set; `floatVotes` uses per-candidate toggle. Merging forces one model; reconcile the opt-out interplay.
- **Navigation:** removing the FloatBoard route and the `branch` param breaks several call sites that must be removed together.
- **Live data migration** must copy before dropping; the plan_phase enum shrink and the drizzle rename hang both need hand-authored SQL.
- **Title sourcing:** former floats render blank until the winning-activity -> title move lands.
- **Dashboard double-count:** a collecting plan could appear in both 'Brewing' and 'Action required' bands unless filters reconcile.
- **Mobile `lib/lock.ts`** is a hand-maintained mirror of shared `lock.ts`; apply signature changes in both.

### 11.7 Foundation-first sequencing (build green at each step)

1. Linear issue; `feat/*` branch (large), PR into `dev`.
2. Shared schemas additive-first: new unified create input + `CandidateKind` alongside the old shapes (nothing consumes them yet).
3. Additive DB migration: new columns, candidate kind, copy float data; no drops yet; reset local DB, verify boot+seed.
4. Backend accepts the unified input, flips counts public, sets isAnonymous always, moves winning-activity -> title into `settleCollecting`, removes the float-owner-can't-lock guard + adds the creator-self check (old paths still compile).
5. Delete float backend (router/settleFloating/reconcile) + frontend (FloatBoard/NewDial/branch) in the SAME PR (where `trpc.floats.*` leaves the type chain).
6. Resolve the rough-window cluster per the product decision (11.8).
7. Remove unused shared Float*/WhenInput/whenMode; vocabulary sweep.
8. Destructive migration: drop float tables, `min_heat`; rebuild `plan_phase` once nothing references them.
9. Seed + tests rewrite (run per-package; pkill jest after - the aggregate `pnpm test` hangs on a leaked mobile jest handle).
10. Docs rewrite + new summary entry; lint/typecheck/test before any `dev` -> `main` PR.

### 11.8 Implementation decisions (recommended resolutions)

Our converged design already answers most of the analysis's open items:

- **Vote semantics:** public per-candidate toggle for BOTH lists (replaces the private SelectCheck on the time list). Counts public, names hidden - this is the "pull the counts in" requirement.
- **whenMode:** drop as a stored column; derive behavior from (lockTimes, lockThings, #time candidates) at runtime.
- **Rough window:** keep a loose time as a candidate granularity (part-of-day, e.g. "Sat afternoon"), so the band/window cluster is generalized, not deleted (it serves the loose-window intent). This is the one area needing care during build.
- **Creator affordances under always-on anonymity:** the creator may edit decides-by and lock early; authorize via `createdByUserId` server-side, never surfaced. `isCreator` becomes a private self-check, not a group-visible flag.
- **Reconcile:** prefer `settleCollecting`'s most-voted-wins for all plans; delete the float reconcile engine (salvage `pickByBackerCount` if useful).
- **Support gate:** drop `min_heat` as a hard gate; a plan with no votes by decides-by fizzles. Small-group de-anonymization remains accepted (unchanged).
- **location / title:** investigate folding `location` into what/where candidates vs a top-level field; title is optional for all plans.

## 12. Open questions deferred to the team

- Does collaborative where/what ship now or as a fast-follow?
- Final checkbox wording (lock framing vs positive framing).
- Moment RSVP shape (binary vs soft state) - conflicting interview signals.
- Granularity of the loose time (part-of-day vs clock).
- Bundle the `event`/`eventId` -> `plan`/`planId` vocabulary rename into this PR, or keep separate? (Recommend separate, to bound scope.)
- Confirm whether the live DB holds any `phase='floating'` / `float_*` rows before finalizing the copy migration.
