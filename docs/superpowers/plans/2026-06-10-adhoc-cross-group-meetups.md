# Ad-hoc & cross-group meetups - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple a meetup's roster from a single group so a meetup can span multiple groups and include ad-hoc link-invited individuals, and let a meetup be crystallized into a permanent group.

**Architecture:** Additive data model - keep `events.groupId` as the *origin* group, add two join tables (`event_groups`, `event_participants`). A single `rosterUserIds(eventId, originGroupId)` helper computes the **live union** (origin-group members ∪ attached-group members ∪ ad-hoc participants) and replaces `memberIdsOf`/`requireMember` in the 5 event read paths. The vote engine (`candidateReactions`/`responses`/`eventOptOuts`, already `(eventId,userId)`-keyed) is untouched. `joinByToken` flips from inserting a group member to inserting a participant.

**Tech Stack:** Fastify + tRPC v11, Drizzle ORM + Postgres, Zod (`@bethere/shared`), Expo/React Native (imperative tRPC proxy client). Tests: `node:test` DB-backed tRPC harness (`apps/api/src/test/harness.ts`, needs `pnpm db:up`).

**Spec:** `docs/superpowers/specs/2026-06-10-adhoc-cross-group-meetups-design.md` | **Linear:** DRP-62 | **Branch:** `feat/adhoc-cross-group-meetups`

---

## File Structure

**Created:**
- `apps/api/src/db/migrations/0011_adhoc_cross_group_meetups.sql` - the two additive tables.
- `apps/api/src/routers/events-roster.test.ts` - integration tests for the union roster, `mine`, `joinByToken`, `addGroup`.
- `apps/api/src/routers/groups-createFromEvent.test.ts` - integration test for crystallizing a group.
- `apps/mobile/src/screens/event-detail/AddGroupSheet.tsx` - "Add a group" compose sheet.
- `apps/mobile/src/screens/event-detail/MakeGroupSheet.tsx` - "Make a group from this" sheet.

**Modified:**
- `apps/api/src/db/schema.ts` - add `eventGroups`, `eventParticipants` tables.
- `apps/api/src/db/migrations/meta/_journal.json` - register migration 0011.
- `apps/api/src/db/groups.ts` - add `rosterUserIds` + `isInRoster` next to `memberIdsOf`.
- `apps/api/src/routers/events.ts` - roster gate in `loadEvent`/`get`, union `mine`, `joinByToken` -> participant, new `addGroup`.
- `apps/api/src/routers/groups.ts` - new `createFromEvent`.
- `packages/shared/src/schemas.ts` - `AddGroupInput`, `CreateGroupFromEventInput`.
- `apps/mobile/src/screens/EventDetail.tsx` - render the two new sheets + their trigger buttons.

---

## Task 1: The two additive tables + migration

**Files:**
- Modify: `apps/api/src/db/schema.ts` (after the `responses` table, ~line 170)
- Create: `apps/api/src/db/migrations/0011_adhoc_cross_group_meetups.sql`
- Modify: `apps/api/src/db/migrations/meta/_journal.json`

- [ ] **Step 1: Add the tables to the Drizzle schema**

Append to `apps/api/src/db/schema.ts` (the imports `pgTable`, `text`, `primaryKey` already exist):

```ts
// Additional whole groups attached to a meetup beyond its origin group (events.groupId). A meetup's
// roster is the LIVE union of all attached groups' members (origin + these) plus ad-hoc
// participants, recomputed on read - so a new member of any attached group flows in automatically.
export const eventGroups = pgTable(
  "event_groups",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eventId, t.groupId] }) }),
);

// Individuals invited to a single meetup (friends-of-friends) who joined via the meetup link.
// Ephemeral and plan-scoped: they are NOT members of any group and never appear in "My Groups".
export const eventParticipants = pgTable(
  "event_participants",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eventId, t.userId] }) }),
);
```

- [ ] **Step 2: Write the migration SQL**

Create `apps/api/src/db/migrations/0011_adhoc_cross_group_meetups.sql`:

```sql
-- DRP-62 ad-hoc & cross-group meetups: a meetup's roster decouples from a single group. Two additive
-- join tables. Existing meetups have NO rows in either, so their roster stays exactly their origin
-- group's members (events.groupId) - no backfill, byte-for-byte today's behavior.
CREATE TABLE "event_groups" (
  "event_id" text NOT NULL REFERENCES "events"("id"),
  "group_id" text NOT NULL REFERENCES "groups"("id"),
  CONSTRAINT "event_groups_event_id_group_id_pk" PRIMARY KEY ("event_id", "group_id")
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
  "event_id" text NOT NULL REFERENCES "events"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "event_participants_event_id_user_id_pk" PRIMARY KEY ("event_id", "user_id")
);
```

- [ ] **Step 3: Register the migration in the journal**

In `apps/api/src/db/migrations/meta/_journal.json`, add this object to the end of the `entries` array (after the `0010_group_invite_code` entry):

```json
    {
      "idx": 11,
      "version": "7",
      "when": 1780500006000,
      "tag": "0011_adhoc_cross_group_meetups",
      "breakpoints": true
    }
```

(Add a comma after the previous entry's closing `}`.)

- [ ] **Step 4: Apply the migration locally**

Run:
```bash
pnpm db:up
pnpm --filter @bethere/api db:migrate
```
Expected: migrate completes; output lists `0011_adhoc_cross_group_meetups` applied with no error.

- [ ] **Step 5: Typecheck the schema change**

Run: `pnpm --filter @bethere/api typecheck`
Expected: PASS (no type errors).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/0011_adhoc_cross_group_meetups.sql apps/api/src/db/migrations/meta/_journal.json
git commit -m "feat(api): event_groups + event_participants tables for ad-hoc/cross-group meetups (DRP-62)"
```

---

## Task 2: Roster helper + wire into `events.get` and the membership gate

**Files:**
- Modify: `apps/api/src/db/groups.ts` (after `memberIdsOf`, ~line 80)
- Modify: `apps/api/src/routers/events.ts` (`loadEvent` ~367-372; `get` ~924, ~929)
- Test: `apps/api/src/routers/events-roster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routers/events-roster.test.ts`:

```ts
// Integration tests for the freely-composed meetup roster (DRP-62): events.get returns the live
// union of origin-group members, attached-group members (event_groups), and ad-hoc participants
// (event_participants); the membership gate admits anyone in that union.
//
// Run with:
//   cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { eventGroups, eventParticipants } from "../db/schema.js";
import {
  caller,
  db,
  dropTestDb,
  groupMembers,
  insertEvent,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

test("events.get members is the union of origin group, attached group, and participants", async () => {
  const creator = await makeUser();
  const groupB = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const other = await makeGroup([groupB], "Climbers");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  await db.insert(eventGroups).values({ eventId, groupId: other });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view);
  const memberIds = view.members.map((m) => m.id).sort();
  // members excludes the caller (creator); union = {groupB, guest}
  assert.deepEqual(memberIds, [groupB, guest].sort());
});

test("a member of an attached group, added AFTER attach, appears in the roster (live)", async () => {
  const creator = await makeUser();
  const other = await makeGroup([], "Climbers");
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });
  await db.insert(eventGroups).values({ eventId, groupId: other });

  const lateJoiner = await makeUser();
  await db.insert(groupMembers).values({ groupId: other, userId: lateJoiner });

  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view);
  assert.ok(view.members.some((m) => m.id === lateJoiner));
});

test("an ad-hoc participant (not in any group) can read the plan - the gate admits the roster", async () => {
  const creator = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const view = await caller(guest).events.get({ id: eventId });
  assert.ok(view, "guest should be able to read a plan they participate in");
});

test("a stranger (not in the roster) is FORBIDDEN from reading the plan", async () => {
  const creator = await makeUser();
  const stranger = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  await assert.rejects(() => caller(stranger).events.get({ id: eventId }));
  // sanity: the row exists and the gate is what rejects
  const [row] = await db.select().from(eventGroups).where(eq(eventGroups.eventId, eventId));
  assert.equal(row, undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: FAIL - `events.get` still uses `memberIdsOf(e.groupId)`, so the attached-group/participant members are missing and the guest read is FORBIDDEN.

- [ ] **Step 3: Add the roster helper**

Append to `apps/api/src/db/groups.ts`. First extend its schema import to include the new tables:

```ts
import { eventGroups, eventParticipants, groupMembers, groups } from "./schema.js";
```

Then add after `memberIdsOf`:

```ts
// The deduped, LIVE roster of a meetup: members of its origin group, members of every additional
// attached group (event_groups), and ad-hoc individuals who joined by link (event_participants).
// The single source for "who is in this meetup" - replaces memberIdsOf(groupId) on the event paths.
// First-occurrence order, origin members first.
export async function rosterUserIds(eventId: string, originGroupId: string): Promise<string[]> {
  const attached = await db
    .select({ groupId: eventGroups.groupId })
    .from(eventGroups)
    .where(eq(eventGroups.eventId, eventId));
  const groupIds = [originGroupId, ...attached.map((r) => r.groupId)];
  const memberRows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(inArray(groupMembers.groupId, groupIds));
  const participantRows = await db
    .select({ userId: eventParticipants.userId })
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { userId } of [...memberRows, ...participantRows]) {
    if (!seen.has(userId)) {
      seen.add(userId);
      out.push(userId);
    }
  }
  return out;
}

// Whether a user is in a meetup's roster (origin group, any attached group, or an ad-hoc participant).
export async function isInRoster(
  eventId: string,
  originGroupId: string,
  userId: string,
): Promise<boolean> {
  const ids = await rosterUserIds(eventId, originGroupId);
  return ids.includes(userId);
}
```

- [ ] **Step 4: Wire the roster into `events.ts`**

In `apps/api/src/routers/events.ts`, extend the `../db/groups.js` import to include the helpers:

```ts
import {
  FALLBACK_GROUP_NAME,
  getGroupNames,
  isInRoster,
  meetupUrlFor,
  memberIdsOf,
  rosterUserIds,
} from "../db/groups.js";
```

Add a roster gate helper next to `requireMember` (after `requireMember`, ~line 362). NOTE: do NOT change `requireMember` itself - the groups router still uses it for true group membership.

```ts
// Caller must be in the meetup's ROSTER (origin group, an attached group, or an ad-hoc participant).
// The event-scoped analogue of requireMember; used by loadEvent and events.get.
export async function requireInRoster(
  eventId: string,
  originGroupId: string,
  userId: string,
): Promise<void> {
  if (!(await isInRoster(eventId, originGroupId, userId))) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
}
```

In `loadEvent` (~370), replace `await requireMember(e.groupId, userId);` with:

```ts
  await requireInRoster(e.id, e.groupId, userId);
```

In `get` (~924), replace `await requireMember(e.groupId, ctx.userId);` with:

```ts
    await requireInRoster(e.id, e.groupId, ctx.userId);
```

In `get` (~929), replace `const memberIds = await memberIdsOf(e.groupId);` with:

```ts
    const memberIds = await rosterUserIds(e.id, e.groupId);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the full API suite to check for regressions**

Run: `pnpm --filter @bethere/api test`
Expected: PASS - existing single-group meetups are unaffected (empty join tables => roster == origin group members).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/groups.ts apps/api/src/routers/events.ts apps/api/src/routers/events-roster.test.ts
git commit -m "feat(api): rosterUserIds union behind events.get + the membership gate (DRP-62)"
```

---

## Task 3: `events.mine` union (guests + cross-group plans show on the dashboard)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`mine` ~826-834)
- Test: `apps/api/src/routers/events-roster.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routers/events-roster.test.ts`:

```ts
test("events.mine includes plans where I am only an ad-hoc participant", async () => {
  const creator = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const mine = await caller(guest).events.mine();
  assert.ok(mine.some((p) => p.id === eventId), "guest should see the plan on their dashboard");
});

test("events.mine includes plans where I am only via a non-origin attached group", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([climber], "Climbers");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });
  await db.insert(eventGroups).values({ eventId, groupId: climbers });

  const mine = await caller(climber).events.mine();
  assert.ok(mine.some((p) => p.id === eventId), "attached-group member should see the plan");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: FAIL - `mine` only queries `events.groupId IN (my groups)`.

- [ ] **Step 3: Rewrite the `mine` candidate-set query**

In `apps/api/src/routers/events.ts`, replace the head of `mine` (the `memberships`/`groupIds`/`rows` block, ~826-834) with:

```ts
  mine: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .where(eq(groupMembers.userId, ctx.userId));
    const groupIds = memberships.map((m) => m.groupId);

    // A plan is "mine" if I am in its roster: its origin group is one of mine, OR it has an attached
    // group of mine, OR I am an ad-hoc participant. Collect the ids in JS to avoid empty-inArray edges.
    const originRows = groupIds.length
      ? await db.select({ id: events.id }).from(events).where(inArray(events.groupId, groupIds))
      : [];
    const attachedRows = groupIds.length
      ? await db
          .select({ eventId: eventGroups.eventId })
          .from(eventGroups)
          .where(inArray(eventGroups.groupId, groupIds))
      : [];
    const participantRows = await db
      .select({ eventId: eventParticipants.eventId })
      .from(eventParticipants)
      .where(eq(eventParticipants.userId, ctx.userId));
    const ids = [
      ...new Set([
        ...originRows.map((r) => r.id),
        ...attachedRows.map((r) => r.eventId),
        ...participantRows.map((r) => r.eventId),
      ]),
    ];
    if (ids.length === 0) return [];

    const rows = await db.select().from(events).where(inArray(events.id, ids));
```

Leave the rest of `mine` (the `settleLifecycle` loop, `live` filter, `loadEventBundle`, projection) exactly as-is. Add `eventGroups, eventParticipants` to the `../db/schema.js` import at the top of `events.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routers/events.ts apps/api/src/routers/events-roster.test.ts
git commit -m "feat(api): events.mine returns plans where I am a participant or via any attached group (DRP-62)"
```

---

## Task 4: `joinByToken` lands an outsider as a participant, not a group member

**Files:**
- Modify: `apps/api/src/routers/events.ts` (`joinByToken` ~1029-1047)
- Test: `apps/api/src/routers/events-roster.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `apps/api/src/routers/events-roster.test.ts`:

```ts
test("joinByToken inserts an event_participants row, NOT a group_members row", async () => {
  const creator = await makeUser();
  const outsider = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  const res = await caller(outsider).events.joinByToken({ eventId });
  assert.equal(res.alreadyMember, false);

  const parts = await db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  assert.ok(parts.some((p) => p.userId === outsider), "outsider is a participant");

  const gm = await db
    .select()
    .from(groupMembers)
    .where(eq(groupMembers.groupId, origin));
  assert.equal(gm.some((m) => m.userId === outsider), false, "outsider must NOT join the group");
});

test("joinByToken is idempotent and a no-op for someone already in the roster", async () => {
  const creator = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  const res = await caller(creator).events.joinByToken({ eventId });
  assert.equal(res.alreadyMember, true);
  const parts = await db
    .select()
    .from(eventParticipants)
    .where(eq(eventParticipants.eventId, eventId));
  assert.equal(parts.length, 0, "an existing member is not duplicated as a participant");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: FAIL - `joinByToken` currently inserts into `groupMembers`.

- [ ] **Step 3: Rewrite `joinByToken`**

Replace the body of `joinByToken` in `apps/api/src/routers/events.ts` with:

```ts
  joinByToken: protectedProcedure.input(ByEvent).mutation(async ({ ctx, input }) => {
    const [e] = await db.select().from(events).where(eq(events.id, input.eventId));
    if (!e)
      throw new TRPCError({ code: "NOT_FOUND", message: "That link does not match a meetup" });
    // The link adds you to THIS meetup only (an ad-hoc participant), never to the group. Idempotent:
    // already in the roster (origin/attached group or an existing participant) is a no-op.
    const already = await isInRoster(e.id, e.groupId, ctx.userId);
    if (!already) {
      await db
        .insert(eventParticipants)
        .values({ eventId: e.id, userId: ctx.userId })
        .onConflictDoNothing();
    }
    return { eventId: e.id, groupId: e.groupId, alreadyMember: already };
  }),
```

(The `alreadyMember` field name is retained so the existing client - `usePendingMeetup.ts`, `JoinMeetup.tsx` - keeps working; it now means "already in the roster".)

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the existing share tests (no regression)**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-share.test.ts`
Expected: the `joinByToken makes a non-member a NORMAL member` test now FAILS because the behavior changed by design. UPDATE that test in `events-share.test.ts` to assert participant semantics instead: replace its `membershipRowCount(groupId, joiner)` assertion with a check that `eventParticipants` has the joiner and `groupMembers` does not (mirror Task 4 Step 1). Re-run; expected PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/events.ts apps/api/src/routers/events-roster.test.ts apps/api/src/routers/events-share.test.ts
git commit -m "feat(api): meetup link adds an ad-hoc participant, not a group member (DRP-62)"
```

---

## Task 5: `events.addGroup` (attach another whole group to a meetup)

**Files:**
- Modify: `packages/shared/src/schemas.ts` (after `ByEvent`, ~line 85)
- Modify: `apps/api/src/routers/events.ts` (add procedure near `shareLink`)
- Test: `apps/api/src/routers/events-roster.test.ts` (append)

- [ ] **Step 1: Add the input schema**

In `packages/shared/src/schemas.ts`, after the `ByEvent` definition:

```ts
// Attach another whole group to a meetup (DRP-62 cross-group). The caller must belong to the group.
export const AddGroupInput = ByEvent.extend({ groupId: z.string() });
export type AddGroupInput = z.infer<typeof AddGroupInput>;
```

- [ ] **Step 2: Write the failing test**

Append to `apps/api/src/routers/events-roster.test.ts`:

```ts
test("events.addGroup attaches a group the caller belongs to and grows the roster", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([creator, climber], "Climbers");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  await caller(creator).events.addGroup({ eventId, groupId: climbers });

  const rows = await db.select().from(eventGroups).where(eq(eventGroups.eventId, eventId));
  assert.ok(rows.some((r) => r.groupId === climbers));
  const view = await caller(creator).events.get({ id: eventId });
  assert.ok(view?.members.some((m) => m.id === climber));
});

test("events.addGroup rejects a group the caller does NOT belong to", async () => {
  const creator = await makeUser();
  const other = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([other], "Climbers"); // creator not in it
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  await assert.rejects(() => caller(creator).events.addGroup({ eventId, groupId: climbers }));
});

test("events.addGroup is idempotent and a no-op for the origin group", async () => {
  const creator = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([creator], "Climbers");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  await caller(creator).events.addGroup({ eventId, groupId: origin }); // origin -> no row
  await caller(creator).events.addGroup({ eventId, groupId: climbers });
  await caller(creator).events.addGroup({ eventId, groupId: climbers }); // dup -> no error
  const rows = await db.select().from(eventGroups).where(eq(eventGroups.eventId, eventId));
  assert.equal(rows.length, 1);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: FAIL - `events.addGroup` does not exist.

- [ ] **Step 4: Implement the procedure**

Add `AddGroupInput` to the `@bethere/shared` import in `apps/api/src/routers/events.ts`, then add this procedure to the `eventsRouter` (place it right after `shareLink`):

```ts
  // Attach another whole group to a meetup (cross-group). Caller must be in the meetup's roster
  // (loadEvent) AND a member of the group being added - you can only bring in groups you belong to.
  // Idempotent; attaching the origin group is a no-op (its members are already the base roster).
  addGroup: protectedProcedure.input(AddGroupInput).mutation(async ({ ctx, input }) => {
    const e = await loadEvent(input.eventId, ctx.userId);
    await requireMember(input.groupId, ctx.userId);
    if (input.groupId !== e.groupId) {
      await db
        .insert(eventGroups)
        .values({ eventId: e.id, groupId: input.groupId })
        .onConflictDoNothing();
    }
    return { ok: true as const };
  }),
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/events-roster.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/routers/events.ts apps/api/src/routers/events-roster.test.ts
git commit -m "feat(api,shared): events.addGroup attaches another group to a meetup (DRP-62)"
```

---

## Task 6: `groups.createFromEvent` (crystallize a meetup into a group)

**Files:**
- Modify: `packages/shared/src/schemas.ts` (after `CreateGroupInput`, ~line 157)
- Modify: `apps/api/src/routers/groups.ts` (add procedure; extend imports)
- Test: `apps/api/src/routers/groups-createFromEvent.test.ts`

- [ ] **Step 1: Add the input schema**

In `packages/shared/src/schemas.ts`, after `CreateGroupInput`:

```ts
// Crystallize a meetup's roster into a new permanent group (DRP-62 "make a group from this").
export const CreateGroupFromEventInput = z.object({ eventId: z.string(), name: GroupName });
export type CreateGroupFromEventInput = z.infer<typeof CreateGroupFromEventInput>;
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/routers/groups-createFromEvent.test.ts`:

```ts
// Integration test for groups.createFromEvent (DRP-62): a meetup's roster (origin members + attached
// groups + ad-hoc participants) is crystallized into a new permanent group.
//
// Run with:
//   cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/groups-createFromEvent.test.ts

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { eventGroups, eventParticipants } from "../db/schema.js";
import {
  caller,
  db,
  dropTestDb,
  groupMembers,
  insertEvent,
  makeGroup,
  makeUser,
  resetTables,
  setupTestDb,
} from "../test/harness.js";

before(setupTestDb);
beforeEach(resetTables);
after(dropTestDb);

test("createFromEvent seeds a new group with the meetup's full roster", async () => {
  const creator = await makeUser();
  const climber = await makeUser();
  const guest = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const climbers = await makeGroup([climber], "Climbers");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });
  await db.insert(eventGroups).values({ eventId, groupId: climbers });
  await db.insert(eventParticipants).values({ eventId, userId: guest });

  const { id } = await caller(creator).groups.createFromEvent({ eventId, name: "Bowling Crew" });

  const members = await db.select().from(groupMembers).where(eq(groupMembers.groupId, id));
  const ids = members.map((m) => m.userId).sort();
  assert.deepEqual(ids, [creator, climber, guest].sort());
});

test("createFromEvent rejects a caller not in the roster", async () => {
  const creator = await makeUser();
  const stranger = await makeUser();
  const origin = await makeGroup([creator], "The Boys");
  const eventId = await insertEvent({ groupId: origin, createdByUserId: creator, activity: "Bowling" });

  await assert.rejects(() =>
    caller(stranger).groups.createFromEvent({ eventId, name: "Nope" }),
  );
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/groups-createFromEvent.test.ts`
Expected: FAIL - `groups.createFromEvent` does not exist.

- [ ] **Step 4: Implement the procedure**

In `apps/api/src/routers/groups.ts`:
- Extend the `@bethere/shared` import to include `CreateGroupFromEventInput`.
- Extend the `../db/groups.js` import to include `isInRoster, rosterUserIds`.
- Extend the `./schema.js`/db import to include `events` (the events table) if not already imported.

Add this procedure to `groupsRouter` (after `create`):

```ts
  // Crystallize a meetup's roster (origin members + attached groups + ad-hoc participants) into a new
  // permanent group - the mirror of "redo a past meetup". Caller must be in the roster. Mints an
  // invite code like create; seeds group_members with everyone on the meetup.
  createFromEvent: protectedProcedure
    .input(CreateGroupFromEventInput)
    .mutation(async ({ ctx, input }) => {
      const [e] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
      if (!e) throw new TRPCError({ code: "NOT_FOUND", message: "meetup not found" });
      if (!(await isInRoster(e.id, e.groupId, ctx.userId))) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const roster = await rosterUserIds(e.id, e.groupId);
      const id = `g_${randomUUID()}`;
      const inviteCode = await freshInviteCode();
      await db.insert(groups).values({ id, name: input.name, inviteCode });
      if (roster.length > 0) {
        await db
          .insert(groupMembers)
          .values(roster.map((userId) => ({ groupId: id, userId })))
          .onConflictDoNothing();
      }
      return { id };
    }),
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/api && node --import tsx --import ./src/test/env.ts --test src/routers/groups-createFromEvent.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/schemas.ts apps/api/src/routers/groups.ts apps/api/src/routers/groups-createFromEvent.test.ts
git commit -m "feat(api,shared): groups.createFromEvent crystallizes a meetup roster into a group (DRP-62)"
```

---

## Task 7: Mobile - "Add a group" and "Make a group from this" sheets

The mobile client uses the **imperative tRPC proxy** (`trpc.x.y.mutate(...)` / `.query(...)`), and `EventDetail.tsx` reloads via its existing focus/poll `load` path. Both sheets follow the `PlanShareSheet` pattern (`EventDetail.tsx:580-661`) - a `BottomSheet` with `ui/` primitives.

**Files:**
- Create: `apps/mobile/src/screens/event-detail/AddGroupSheet.tsx`
- Create: `apps/mobile/src/screens/event-detail/MakeGroupSheet.tsx`
- Modify: `apps/mobile/src/screens/EventDetail.tsx` (render both sheets + trigger buttons)

- [ ] **Step 1: Build the AddGroupSheet**

Create `apps/mobile/src/screens/event-detail/AddGroupSheet.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { trpc } from "../../lib/trpc";
import { trpcErrorCode } from "../../lib/trpcError";
import { BottomSheet, Button, FormError, Row, Text } from "../../ui";

type GroupRow = { id: string; name: string };

// Attach one of the user's OTHER groups to this meetup. Mirrors PlanShareSheet's lazy-fetch sheet.
export function AddGroupSheet({
  visible,
  eventId,
  onClose,
  onAdded,
}: {
  visible: boolean;
  eventId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [groups, setGroups] = useState<GroupRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    trpc.groups.mine
      .query()
      .then((rows: GroupRow[]) => setGroups(rows))
      .catch(() => setError("Could not load your groups."));
  }, [visible]);

  const add = useCallback(
    async (groupId: string) => {
      setBusyId(groupId);
      setError(null);
      try {
        await trpc.events.addGroup.mutate({ eventId, groupId });
        onAdded();
        onClose();
      } catch (err: unknown) {
        setError(
          trpcErrorCode(err) === "FORBIDDEN"
            ? "You can only add groups you're in."
            : "Could not add that group.",
        );
      } finally {
        setBusyId(null);
      }
    },
    [eventId, onAdded, onClose],
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text variant="title">Add a group</Text>
      <Text variant="muted" style={{ marginBottom: 12 }}>
        Everyone in the group joins this meetup. New members are added automatically.
      </Text>
      {error ? <FormError message={error} /> : null}
      {groups?.length === 0 ? <Text variant="muted">You're not in any other groups.</Text> : null}
      {groups?.map((g) => (
        <Row key={g.id}>
          <Text style={{ flex: 1 }}>{g.name}</Text>
          <Button
            label={busyId === g.id ? "Adding..." : "Add"}
            variant="secondary"
            disabled={busyId !== null}
            onPress={() => add(g.id)}
          />
        </Row>
      ))}
    </BottomSheet>
  );
}
```

(If `groups.mine` returns extra fields, the `GroupRow` subset still type-checks; confirm the field names against `groups.mine` in `apps/api/src/routers/groups.ts:46-69` and adjust the `name`/`id` access if they differ. Confirm the exact prop names of `BottomSheet`, `Button`, `Row`, `Text`, `FormError` against `apps/mobile/src/ui/index.ts` and the `PlanShareSheet` usage, and match them.)

- [ ] **Step 2: Build the MakeGroupSheet**

Create `apps/mobile/src/screens/event-detail/MakeGroupSheet.tsx`:

```tsx
import { useCallback, useState } from "react";
import { trpc } from "../../lib/trpc";
import { BottomSheet, Button, Field, FormError, Text } from "../../ui";

// Crystallize this meetup's roster into a new permanent group, then hand back its id to navigate.
export function MakeGroupSheet({
  visible,
  eventId,
  defaultName,
  onClose,
  onCreated,
}: {
  visible: boolean;
  eventId: string;
  defaultName: string;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setError("Give the group a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { id } = await trpc.groups.createFromEvent.mutate({ eventId, name: trimmed });
      onCreated(id);
      onClose();
    } catch {
      setError("Could not make the group.");
    } finally {
      setBusy(false);
    }
  }, [name, eventId, onCreated, onClose]);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text variant="title">Make a group from this</Text>
      <Text variant="muted" style={{ marginBottom: 12 }}>
        Keep everyone who was on this meetup as a group you can plan with again.
      </Text>
      <Field value={name} onChangeText={setName} placeholder="Group name" />
      {error ? <FormError message={error} /> : null}
      <Button
        label={busy ? "Making..." : "Make group"}
        variant="primary"
        disabled={busy}
        onPress={create}
        style={{ marginTop: 12 }}
      />
    </BottomSheet>
  );
}
```

- [ ] **Step 3: Wire both sheets into EventDetail**

In `apps/mobile/src/screens/EventDetail.tsx`:
- Add imports: `import { AddGroupSheet } from "./event-detail/AddGroupSheet";` and `import { MakeGroupSheet } from "./event-detail/MakeGroupSheet";` (match the existing relative-import style; `PhaseViews` is imported from `./event-detail/...`).
- Add state near the other sheet state (`condSheet`/`editSheet`, ~line 100): `const [addGroupSheet, setAddGroupSheet] = useState(false);` and `const [makeGroupSheet, setMakeGroupSheet] = useState(false);`.
- Identify the screen's existing reload function (the `load` callback used by `useFocusEffect`/poll around line 120). Call it from `onAdded`.
- Render the sheets next to `PlanShareSheet` (~line 494):

```tsx
      <AddGroupSheet
        visible={addGroupSheet}
        eventId={eventId}
        onClose={() => setAddGroupSheet(false)}
        onAdded={() => load()}
      />
      <MakeGroupSheet
        visible={makeGroupSheet}
        eventId={eventId}
        defaultName={data.activity || "New group"}
        onClose={() => setMakeGroupSheet(false)}
        onCreated={(groupId) =>
          navigation.navigate("Groups", { screen: "GroupDetail", params: { groupId } })
        }
      />
```

(Replace `load()` with the actual reload function name, and confirm the `navigation.navigate` target against `App.tsx`'s navigator config - match how `JoinMeetup`/`CreateWizard` navigate to a group.)

- Add the triggers. Put an "Add a group" button in the collecting/active region (near the share affordance) and a "Make a group from this" button shown when `data.phase === "cleared"`:

```tsx
      <Button
        label="Add a group"
        variant="secondary"
        onPress={() => setAddGroupSheet(true)}
        style={{ marginTop: 8 }}
      />
      {data.phase === "cleared" ? (
        <Button
          label="Make a group from this"
          variant="secondary"
          onPress={() => setMakeGroupSheet(true)}
          style={{ marginTop: 8 }}
        />
      ) : null}
```

- [ ] **Step 4: Typecheck mobile**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS. Fix any prop/name mismatches against `ui/index.ts` and the real `load`/navigation identifiers.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/screens/event-detail/AddGroupSheet.tsx apps/mobile/src/screens/event-detail/MakeGroupSheet.tsx apps/mobile/src/screens/EventDetail.tsx
git commit -m "feat(mobile): compose meetups - add a group + make a group from a meetup (DRP-62)"
```

---

## Task 8: Full gate + manual demo dry-run

**Files:** none (verification only)

- [ ] **Step 1: Run the full pre-PR gate**

Run: `pnpm check`
Expected: PASS (lint + typecheck + test + quality). No escape hatches (`as any`/`@ts-*`/`biome-ignore`). API DB tests need `pnpm db:up`.

- [ ] **Step 2: Boot the app locally and dry-run the demo path**

Run `pnpm dev:api` and `pnpm dev:mobile`. Walk the success-criteria path from the spec:
1. Create a meetup from group A.
2. "Add a group" -> attach group B; confirm B's members appear.
3. Share the link; open it as an outsider (incognito web / `EXPO_PUBLIC_DEV_AUTH`); confirm they join as a participant and appear on the plan, and that they are NOT in group A under My Groups.
4. Everyone votes / RSVPs; the reveal shows all by name across A, B, and the guest.
5. On the cleared plan, "Make a group from this" -> a new group with all of them.
6. While collecting, add a member to group B and confirm they show in the roster live.

- [ ] **Step 3: Update Linear**

Move DRP-62 toward Done with a comment referencing the commits, or leave In Progress with a status note if the PR is still open. Open a PR `feat/adhoc-cross-group-meetups` -> `dev` when the dry-run passes.

---

## Self-Review

**Spec coverage:**
- Live union roster -> Task 2 (`rosterUserIds`) + Tasks 2/3 wiring. ✓
- Additive tables, no backfill -> Task 1. ✓
- 5 read paths (get members, gate, mine, quorum/resolveIn, conditional picker + reveal) -> get members + gate (Task 2), mine (Task 3); quorum/resolveIn/reveal are fed by responses/reactions (untouched) and the `members` list from `get` (covered by Task 2). ✓
- joinByToken -> participant -> Task 4. ✓
- events.addGroup -> Task 5. groups.createFromEvent -> Task 6. ✓
- Compose UI + "make a group" -> Task 7. ✓
- Anonymity unchanged (counts nameless; names at reveal/picker) -> no code change needed; the existing reveal/picker now operate over the union roster, which is the intended "names shown" behavior. ✓
- Deferred (groupless meetup, people-you've-met, name-hiding) -> not built, by design. ✓

**Placeholder scan:** No TBD/TODO/"handle errors"; every code step shows the code. The two "confirm prop/identifier names" notes in Task 7 are real verification steps (the mobile `ui/` prop names and the screen's `load`/navigation identifiers must be read at execution), not deferred logic. ✓

**Type consistency:** `rosterUserIds(eventId, originGroupId)` / `isInRoster(eventId, originGroupId, userId)` / `requireInRoster(eventId, originGroupId, userId)` used consistently across Tasks 2-6. `AddGroupInput` (events) and `CreateGroupFromEventInput` (groups) defined before use. `joinByToken` keeps its `{ eventId, groupId, alreadyMember }` return shape for the existing client. ✓

**Risk note:** Task 4 Step 5 intentionally updates an existing `events-share.test.ts` assertion because the `joinByToken` behavior changes by design - flagged so it is not mistaken for a regression.
