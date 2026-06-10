# Ad-hoc & cross-group meetups - design

**Date:** 2026-06-10 | **Horizon:** demoable Friday (M4 progress, ~2 days) | **Branch:** `feat/adhoc-cross-group-meetups` -> PR into `dev` (massive feature) | **Linear:** [DRP-62](https://linear.app/drp-02/issue/DRP-62) (In Progress)

## Problem

Today a meetup is welded to exactly one group: `events.groupId` is a single non-null FK, and *everything that needs "who's in this meetup"* (the member list, quorum, the "I'll go if [people]" picker, the reveal, the dashboard query) is derived from **that one group's membership**. The M4 Luca interview surfaced two validated, recurring needs this forbids:

1. **Friends-of-friends.** Invite a specific person to *this meetup only* without making them a permanent group member ("a plus one... you don't really want to invite them all the time").
2. **Multiple groups.** Run one meetup across two of your friend groups without minting a permanent merged group.

Plus a complementary idea from the same conversation: **form a group from a meetup that already happened** ("that crew was fun - keep them"). It is the mirror of the existing "redo a past meetup" flow.

## Model (owner-approved)

A meetup's audience is **freely composed** (model B): there is no required "home" group; a group is just a bulk-add convenience. Individuals come in **by link only** (no people directory - honors the rejected "dropdown of everyone"). The roster is the **live union**, recomputed on every read:

> **roster(event) = live members(origin group) ∪ live members(every attached group) ∪ ad-hoc participants**

"Live" is a hard requirement: **if someone joins a group that is part of a meetup, they must appear in that meetup's roster automatically.** That is exactly why groups are attached *by reference* (not snapshotted) and the roster is computed at read time.

### Locked decisions
- Individuals are added **only via the meetup link** (DRP-56 rails); they sign in with Google and become ephemeral, plan-scoped participants who are **never** in any group and never show in "My Groups".
- Attached **groups stay live** (new joiners flow in); individuals are per-meetup.
- **Anonymity is unchanged**: +1 counts stay nameless during `collecting`. The conditional picker and the final reveal show roster names **across** the attached groups + guests - i.e. a person from group X can see a person from group Y by name. This is the one privacy-relevant consequence of merging groups and is accepted ("names shown").
- A meetup can be **crystallized into a permanent group** afterward, seeded from its roster.

## Data model (additive - no backfill migration)

Keep `events.groupId` as the **origin** group (what you started from; still powers redo/`pastForGroup` and the label). Add two join tables; existing single-group meetups leave both empty and behave **byte-for-byte as today**.

```ts
// Additional whole groups attached to a meetup beyond its origin group. Roster is the LIVE union of
// all attached groups' members (origin + these) plus ad-hoc participants, recomputed on read.
export const eventGroups = pgTable("event_groups", {
  eventId: text("event_id").notNull().references(() => events.id),
  groupId: text("group_id").notNull().references(() => groups.id),
}, (t) => ({ pk: primaryKey({ columns: [t.eventId, t.groupId] }) }));

// Individuals invited to a single meetup (friends-of-friends) who joined via the meetup link.
// Ephemeral and plan-scoped: NOT members of any group; never appear in "My Groups".
export const eventParticipants = pgTable("event_participants", {
  eventId: text("event_id").notNull().references(() => events.id),
  userId: text("user_id").notNull().references(() => users.id),
}, (t) => ({ pk: primaryKey({ columns: [t.eventId, t.userId] }) }));
```

Migration is hand-authored (numbered SQL under `apps/api/src/db/migrations/` + a `meta/_journal.json` entry). It is **create-table only** - no data backfill, no changes to existing rows.

## The single new abstraction: the roster helper

One unit, one purpose, used by every read path:

```ts
// Deduped live roster for a meetup: members of the origin group + every attached group, plus
// ad-hoc participants. Replaces the bare memberIdsOf(groupId) call.
async function rosterUserIds(eventId: string, originGroupId: string): Promise<string[]>
async function isInRoster(eventId: string, originGroupId: string, userId: string): Promise<boolean>
```

### Read paths that switch to it (the entire surface)
1. `events.get` member list - replace `memberIdsOf(e.groupId)` (events.ts:929) with `rosterUserIds(e.id, e.groupId)`.
2. The membership gate - replace `requireMember(e.groupId, ctx.userId)` (events.ts:924) and the `loadEvent` mutation gate (events.ts:~358-364) with `isInRoster(...)`.
3. `events.mine` (events.ts:827-834) - a plan is "mine" if I am in its roster: `events.groupId IN (my groups)` **OR** the event has an `event_groups` row for one of my groups **OR** I have an `event_participants` row for it. Union of three selects.
4. Quorum / fizzle tally and `resolveIn` conditionals - already `(eventId,userId)`-keyed; they just need to read the union roster where they currently read group members.
5. The "I'll go if [people]" picker and the reveal - fed by `events.get`'s `members` / `going`, so covered by (1).

**Untouched:** `candidateReactions`, `responses`, `eventOptOuts` - already keyed on `(eventId, userId)`, group-agnostic. The vote engine does not move.

## New flows

### Compose (on an existing plan)
- **Add a group:** `events.addGroup(eventId, groupId)` -> insert an `event_groups` row. Auth: caller must be in the roster (or creator) **and** a member of the group being added (you can only attach groups you belong to). Idempotent.
- **Add an individual:** no new API - reuse the existing `events.shareLink` + share sheet. The only change is `joinByToken`.

### `joinByToken` (the DRP-56 link) - the key behavioral flip
Today it inserts a `group_members` row (force-joins the whole group). Change it to insert an `event_participants` row instead, unless the caller is already in the roster (origin group, an attached group, or already a participant) -> no-op. The link now lands an outsider in **just this meetup**.

### Form a group from a meetup
`groups.createFromEvent(eventId, name)` -> create a `groups` row + seed `group_members` with the meetup's current roster. Offered on a meetup (primarily once `cleared`). Mirror of redo/`pastForGroup`. The visible payoff of the demo.

## Demo-thin slice (must-ship Friday) vs deferred

**Must-ship (the demo story end-to-end):**
- `event_groups` + `event_participants` tables + migration.
- `rosterUserIds` / `isInRoster` helper and the 5 read-path swaps (incl. live membership - it falls out for free).
- `joinByToken` -> participant (not group member).
- `events.addGroup` + a "Add a group" affordance on the plan; share-link-for-individual via the existing sheet.
- `groups.createFromEvent` + a "Make a group from this" affordance.

**Deferred (note in demo Q&A / docs, not built Friday):**
- A **fully groupless** meetup (needs `events.groupId` nullable + a migration); for now every meetup still starts from an origin group.
- The "people you've met" picker (option b) and contacts import.
- Per-group name-hiding / finer privacy controls.
- `events.removeGroup` / un-inviting an individual.

## Testing

API (DB-backed, needs `pnpm db:up`):
- `events.get` returns the **union** roster (origin members + attached-group members + participants), deduped.
- **Live membership:** add a member to an attached group -> they appear in `events.get.members` without re-attaching.
- `events.mine` includes a plan where I am only a participant, and one where I am only via an attached (non-origin) group.
- `joinByToken` inserts an `event_participants` row, **not** a `group_members` row; idempotent; no-op if already in roster.
- `events.addGroup` auth (must belong to the group; must be in roster) + idempotency.
- `groups.createFromEvent` seeds the new group with the full roster.
- Anonymity boundary still holds: `events.get` never returns voter ids for counts (existing `events-share`/`toggleReaction` assertions extended to a composed roster).

Mobile: smoke-test the compose affordances render and call the procedures (mirror existing `JoinMeetup`/`GroupDetail` test style).

## Success criteria (the Friday demo path)
Create a meetup from group A -> **add group B** -> **Share** the link to an individual who opens it, signs in, and joins as a **participant (not a group member)** -> all of A ∪ B ∪ the guest vote and RSVP -> the reveal shows everyone by name -> tap **"Make a group from this"** to persist the crew as a new group. Plus: while collecting, a new joiner to group B shows up in the roster live.

## Code touchpoints
- Schema/migration: `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/` (+ `meta/_journal.json`).
- Roster + reads + new procedures: `apps/api/src/routers/events.ts` (`memberIdsOf`/`requireMember` -> roster helper; `get`, `mine`, `joinByToken`, new `addGroup`), `apps/api/src/routers/groups.ts` (`createFromEvent`), shared Zod inputs in `packages/shared/src/schemas.ts`.
- Mobile: `apps/mobile/src/screens/EventDetail.tsx` (compose affordances + "make a group from this"), reuse the `PlanShareSheet` for individuals.
- Tests: `apps/api/src/routers/events-*.test.ts`, `groups.test.ts`.
```
