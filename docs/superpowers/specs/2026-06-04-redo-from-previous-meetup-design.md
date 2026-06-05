# Redo: start a meetup from a previous one

Status: design, ready for team review
Date: 2026-06-04
Scope: mobile `CreateWizard` + one new read-only API procedure. No schema change.

## Problem

Interviews surfaced one dominant pain: **re-creation friction.** Groups that meet
regularly (the canonical case is "weekly DnD") have to rebuild the same plan from
scratch every time - same activity, same place, same lock settings - changing only
the time. That friction is exactly what stops a good one-off ("that hike was great")
from happening again.

The app already stores every meetup that happened: `events.mine` returns every
non-fizzled plan in a user's groups with no time cutoff (`Dashboard.tsx` even notes
"All doubles as your history"). So the data to copy from already exists. What is
missing is a way to start a new plan *from* a past one.

## Non-goals

- **Automated recurring meetups** (a "series" that spawns next week's DnD on its own).
  Considered and explicitly deferred. The codebase has no scheduler by design
  (everything settles lazily on read), and redo already makes the weekly case a
  few taps. Auto-recurring is a separate, larger project (it reopens the
  "do we re-ask everyone each week" honesty question) and is out of scope here.
- **Roster / RSVP carry-over.** A redo is a fresh, honest coordination round. We do
  NOT pre-mark last time's attendees as "in." Life happens between meetups; each
  round must ask honestly, which is the whole point of the blind moment. Redo clones
  the plan's *shell* only and carries no RSVP data.
- **Per-group history surface or dashboard "redo" buttons.** Redo lives only inside
  the create wizard. The dashboard and group screen are untouched.

## Design

### Entry point: a conditional step in the wizard

`CreateWizard` steps today: `group -> activities -> times -> options -> confirm`
(`CreateWizard.tsx:25`). Group selection is already the first step.

Insert a **"source"** step immediately after **group**:

- It offers two choices: **Start fresh** or **Use a previous meetup** (a pickable
  list of the group's past meetups).
- It is shown **only when the chosen group has at least one past meetup.** If the
  group has none, the step is skipped and the wizard behaves exactly as it does
  today.
- Both choices then advance into the normal **activities** step and flow through the
  remaining steps unchanged. The only difference is whether the wizard state arrives
  **pre-filled.** Flowing through the normal steps (rather than jumping straight to
  the time step) lets the creator review and tweak every carried-over field on the
  way through.

Because the source step depends on the selected group, re-selecting a different group
re-evaluates whether the step appears and refreshes its list.

### What a clone carries

From the chosen past meetup, pre-fill:

- **activities** - the full activity candidate list
- **lock settings** - `lockTimes` and `lockThings`
- **location**
- **notes** (description)

Explicitly **not** carried:

- **time** - always stale; left blank. The creator sets it fresh on the times step.
- **title** - stays blank, as it does today. The server resolves the winning activity
  into the title at lock; cloning the activity list reproduces this automatically.

`lockTimes` rides along as the creator's prior intent. Since the cloned plan has no
times yet, the wizard's existing "add a time first" gating (`canLockTimes`,
`lockTimesEff = lockTimes && canLockTimes`) simply re-enables the lock once a time is
added. No special handling needed.

There is **no new create path.** The clone is assembled in the client from the
pre-filled wizard state and sent through the existing `events.create` mutation.

### What counts as a "previous meetup"

- **Cleared plans only** - ones that actually happened (`phase === "cleared"`).
  In-flight plans (`collecting` / `moment`) and **fizzled** plans are excluded.
  Excluding fizzles preserves their existing "no trace" guarantee.
- **Group-wide**, not "only meetups I created." Plans are anonymous and group-owned,
  so "things this group has done" is the correct scope, and any member can redo any
  of them.
- Ordered **most-recent-first.** Each row shows **title, location, and when it last
  happened.** A reasonable cap (e.g. the 20 most recent) keeps the list bounded;
  de-duplicating repeated redos of the same activity is a possible future refinement,
  not part of this scope.

### Backend: one new read-only procedure

Add a single member-scoped query to the events router, e.g.:

```
events.pastForGroup({ groupId }) -> Array<{
  id: string
  title: string
  location: string
  description: string | null
  activityCandidates: string[]   // labels of the plan's activity candidates
  lockTimes: boolean
  lockThings: boolean
  lastStartsAt: string           // ISO; for the "when it last happened" line + ordering
}>
```

- Guarded by the existing `requireMember(groupId, userId)` check.
- Filters to `phase === "cleared"` in the caller's selected group.
- Returns no RSVP data, no creator identity (anonymity preserved) - only the clonable
  shell plus display metadata.

This is the **only** server change. The Zod shape goes in `@bethere/shared`, the
procedure in `apps/api/src/routers/events.ts`, and the mobile client picks up the type
automatically through the tRPC type chain.

## Data flow

```
New meetup
  -> pick group
  -> [source step, only if events.pastForGroup(group) is non-empty]
       - "Start fresh"          -> activities (empty), as today
       - "Use a previous meetup"-> pick one -> wizard state pre-filled from its shell
  -> activities (pre-filled or empty)
  -> times (always blank; creator sets the new time)
  -> options (pre-filled locks / location / notes, or defaults)
  -> confirm
  -> events.create(...)   // unchanged mutation
```

## Privacy / honesty

- Cloning reads only **cleared** plans, whose IN crowd is already revealed - so no
  blind-moment data is exposed by the new query.
- The clone carries **no RSVP/response data**, so redoing a plan reveals nothing about
  who did or did not attend last time.
- Creator anonymity is preserved: the query returns no creator identity, and a redo is
  created anonymously like any other plan.

## Testing

- **Shared:** the new Zod schema validates the expected shape.
- **API:** `events.pastForGroup` returns only `cleared` plans for the group; excludes
  `collecting` / `moment` / `fizzled`; rejects non-members (`FORBIDDEN`); returns the
  activity labels and lock flags needed to clone; orders most-recent-first.
- **Mobile:** the source step appears only when the group has past meetups and is
  skipped otherwise; choosing a previous meetup pre-fills activities, locks, location,
  and notes while leaving the time blank; "Start fresh" leaves state empty; the
  resulting `events.create` payload matches the cloned shell plus the freshly chosen
  time.

## Risks / notes

- **Empty-state correctness.** The source step must reliably not appear for groups with
  no history, so existing behavior is unchanged for new groups.
- **Group re-selection.** Changing the group mid-wizard must re-fetch the list and
  re-decide whether the source step shows; pre-filled state from a now-irrelevant group
  should be cleared on group change.
- **List growth.** Long-lived active groups accumulate cleared plans; the recency cap
  keeps the picker usable. De-dup is a future refinement.
- **Lock-with-no-time.** Carrying `lockTimes` onto a time-less clone is handled by the
  wizard's existing gating; no new edge logic, but worth a test.

## Sequencing

1. `@bethere/shared`: add the `PastForGroup` output schema.
2. `apps/api`: add `events.pastForGroup`, with tests.
3. `apps/mobile`: add the conditional source step and the pre-fill wiring in
   `CreateWizard`, with tests.

All three land together (the tRPC type chain couples them), as a normal change on
`dev`.
