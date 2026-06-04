# Unify "title / activity / thing / name" into one concept: the activity

Status: design, ready for team review
Date: 2026-06-04
Scope: schema (+ migration), shared types, API, mobile. Lands on the
`feat/redo-from-previous-meetup` branch, folded together with the redo feature (one PR).

## Problem

A plan's identity is described by four different words across the codebase, for what is
essentially one concept ("what is this meetup?"):

- **title** - `events.title` (scalar), the create "Title" field, `resolveTitle` /
  `displayTitle` / `FALLBACK_TITLE`, every heading.
- **activity** - candidate `kind: "activity"`, "Add an activity", `activityCandidates`.
- **thing** - `lockThings`, "the group has done things before".
- **name** - "an activity needs a name", "Untitled", and dangerously also people's
  names and the anonymity copy ("No names - it's the group's").

The redundancy became real when M-DRP-43 added an explicit `title` field at create. Now
a plan can be named one thing and "do" another, and `events.update` carries an "empty
title reverts to auto-derive" hack to paper over the two mechanisms. The model is
incoherent.

## Decision

**The plan's name IS its activity. One concept, one word: `activity`. Everywhere.**

- A plan owns a votable **activity** candidate list (`kind:"activity"`) during
  `collecting`. The winning candidate becomes the plan's name at lock - exactly the
  existing `resolveTitle` mechanic, just renamed.
- There is **no separate title**. "Naming it now" = adding an activity (one locked
  activity = a fixed name; several / open = the group votes and the winner names it).
- `name` is retired for this concept (it collides with anonymity and with group/user
  names). `thing` is retired. `title` is retired.

This was chosen over (B) renaming only / keeping two fields, and (C) collapse with an
optional override name. The one case full collapse loses - a named occasion with
separately votable activities ("Friday plans" + vote bowling/cinema) - is rare and
survives as just an activity label ("Friday: bowling or cinema").

## Display identity (frontend)

Now that the activity is the name, the heading must never be weak or ambiguous.

- **Heading** = the plan's `activity` (the won activity, or while collecting the leading
  candidate). When there is **no activity yet**, the **group name** becomes the heading -
  no "An activity" placeholder.
- **Supporting line:**
  - activity present -> `groupName · location` (as today).
  - activity absent (group is the heading) -> `location` / time only, never the group
    twice.
- On **per-group surfaces** (the redo source step, and any future per-group plan list)
  the group is redundant context, so it never appears in the heading there. (Past meetups
  in the redo picker are always `cleared`, so they always have a real activity name.)
- Mechanically: the API returns `activity` as the resolved leading/won activity, or `""`
  when there is none (the old "An activity" placeholder is dropped). The group fallback
  (`activity || groupName`) lives in the mobile render, where the group name is available.

## Naming map (old -> new), applied everywhere

| Old | New |
|---|---|
| `events.title` (column) | `events.activity` |
| `events.lock_things` (column) | `events.lock_activity` |
| `lockThings` (API field / Zod / mobile state) | `lockActivity` |
| `CreateEventInput.title` | removed |
| `UpdateEventInput.title` | `UpdateEventInput.activity` |
| `resolveTitle` | `resolveActivity` |
| `displayTitle` | `displayActivity` |
| `FALLBACK_TITLE = "An activity"` | removed (group-name fallback on the client) |
| UI "Title" field (create) | removed |
| "the group has done **things** before" | "...done it before" |
| "**No names** - it's the group's" | reworded - it is about anonymity, not the name |
| `candidate_kind` enum value `"activity"` | unchanged (the win of this word) |

## Schema + migration

- Rename `events.title` -> `events.activity` (cached chosen-activity label; `""` until
  lock, written at lock - same mechanic as today, just the column name).
- Rename `events.lock_things` -> `events.lock_activity`.
- `candidate_kind` keeps `"activity"` - no enum migration.
- Migration is two `ALTER TABLE events RENAME COLUMN` statements, **hand-written** (Drizzle
  Kit's `generate` is interactive and hangs on rename-vs-create ambiguity per CLAUDE.md).
  No data transform. Local resets on boot (`SEED_ON_BOOT=reset`); live is demo data
  (`if-empty`), so the rename is low-risk.

## Shared types (`packages/shared`)

- `CreateEventInput`: drop `title`; rename `lockThings` -> `lockActivity`.
  `activityCandidates` is unchanged and remains the only naming input.
- `UpdateEventInput`: rename the `title` field -> `activity`.
- `CandidateKind` unchanged.

## API (`apps/api`)

- `create-plan.ts`: `resolveTitle` -> `resolveActivity`, `displayTitle` ->
  `displayActivity`, drop `FALLBACK_TITLE`. `displayActivity` returns the leading activity
  or `""` (no placeholder). `planOpensMoment` keeps its `lockThings` parameter renamed to
  `lockActivity`.
- `events.create`: drop the `title` param; `lockThings` -> `lockActivity`; write the
  resolved activity into `events.activity` for the concrete shortcut as today.
- `lock` / `settleCollecting`: write the won activity into `events.activity` (guarded on
  it still being `""`, as today).
- `events.update`: edit `activity`, and **only once the plan has a fixed name**
  (post-lock). Pre-lock the name is the live leading candidate, so the update no longer
  accepts a name edit while `collecting` - this removes the "empty title = auto-derive"
  hack entirely. Location/notes edits are unchanged in both phases.
- `events.get` / `mine` / `pastForGroup`: return `activity` instead of `title` /
  `titleRaw` (the raw value where the edit sheet needs it).

## Mobile (`apps/mobile`)

- **CreateWizard:** remove the "Title" field from the options step; the activities step
  is the sole naming surface. Rename `lockThings` state + copy to `lockActivity`. Reword
  "No names - it's the group's" so it clearly refers to anonymity.
- **Dashboard / EventDetail:** `e.title` -> `e.activity`; apply the display-identity rule
  (`activity || groupName` heading, group/location supporting line, group dropped from the
  supporting line when it is the heading). The edit sheet's name editor becomes
  activity-aware and post-lock only.
- **Redo fold-in:** `Prefill.title` -> `activity`, `prefillFromMeetup`, `EMPTY_PREFILL`,
  and `SourceCard` use `activity`. The title-carry added by the redo work becomes
  activity-carry - same behavior, coherent name. (Source cards are always cleared plans, so
  they always have a real activity; no group fallback needed there.)
- `notifications.ts` and the seed (`seed-data.ts`) + its integrity test: `title` ->
  `activity`.

## Non-goals

- No change to the **time** axis, voting, the blind moment, RSVP, or resolution.
- No occasion-name escape hatch (explicitly rejected - full collapse).
- No new per-group plan-history surface (separate from this).

## Execution

One branch (`feat/redo-from-previous-meetup`), one PR - the tRPC type chain couples
schema/shared/API/mobile, so it must land together. Stage the work
**foundation-first, renames-last**:

1. Schema rename + hand-written migration + `@bethere/shared` (`CreateEventInput`,
   `UpdateEventInput`).
2. API: helper renames, `create` / `lock` / `settleCollecting` / `update`, and the
   read procedures (`get` / `mine` / `pastForGroup`).
3. Mobile: CreateWizard, Dashboard, EventDetail, redo helpers, notifications.
4. Seeds + tests.

`pnpm typecheck` is the spine that proves the rename is complete across the type chain;
run lint + typecheck + tests green at each stage.

## Testing

- `create-plan.test.ts`: renamed helpers (`resolveActivity` / `displayActivity`), and
  `displayActivity` returns `""` (not a placeholder) when there is no activity.
- `past-meetups.test.ts`: `title` -> `activity` field assertions.
- `redo.test.ts`: `title` -> `activity` in the prefill shape.
- `seed-data.test.ts`: still green after the `title` -> `activity` rename in the fixture.
- Manual: create a plan by naming one activity (concrete) and by offering several (vote);
  confirm dashboard/detail headings, the no-activity group fallback, editing the name
  post-lock, and a redo carrying the activity.

## Risks / notes

- **Column rename + Drizzle Kit.** Hand-write the migration; do not run interactive
  `generate` for the rename. If the baseline is regenerated, reset the local DB
  (`docker compose down -v && pnpm db:up`).
- **Completeness.** A half-applied rename compiles in places and breaks the type chain in
  others; rely on `pnpm typecheck` across all three packages as the done-check.
- **Combined PR size.** Folding this into the redo branch makes a larger PR; the staged
  commits keep it reviewable.
