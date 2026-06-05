# Activity Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse "title / activity / thing / name" into one concept - the **activity** - everywhere (schema, shared types, API, mobile), so a plan's name IS its activity.

**Architecture:** A rename-heavy refactor coupled through the tRPC type chain, so it lands as one PR on the `feat/redo-from-previous-meetup` branch. Staged foundation-first (shared -> schema+API -> mobile), each stage leaving its own package green. `pnpm typecheck` per package is the spine that proves the rename is complete.

**Tech Stack:** Zod, Drizzle ORM + Postgres (hand-written migration), tRPC v11, Fastify, Expo React Native, `node:test` (api), jest (mobile).

**Spec:** `docs/superpowers/specs/2026-06-04-activity-unification-design.md`. **Linear:** DRP-42.

---

## Conventions (read first)

- pnpm only. `apps/api` is ESM - relative imports need `.js` extensions. NO em dashes (use hyphens; middot `·` is allowed).
- Mobile imports `@bethere/api` type-only; API types flow to mobile via the tRPC chain (do not hand-write them).
- Run tests per package (aggregate `pnpm test` can hang on mobile jest): `pnpm --filter @bethere/api test`, `pnpm --filter @bethere/mobile exec jest --watchAll=false --forceExit`.
- The candidate-kind enum value `"activity"` is UNCHANGED - do not touch `candidate_kind`.
- This refactor will not fully `pnpm typecheck` across all packages until Task 3 is done (the type chain is coupled). Each task leaves ITS package green, in dependency order shared -> api -> mobile.

## File structure (what each task touches)

- Task 1 - `packages/shared/src/schemas.ts` (CreateEventInput, UpdateEventInput).
- Task 2 - `apps/api/src/db/schema.ts`, a new migration `0008_activity_rename.sql` + journal, `apps/api/src/routers/create-plan.ts` (+test), `apps/api/src/routers/events.ts`, `apps/api/src/routers/past-meetups.ts` (+test), `apps/api/src/db/seed-data.ts` (+test), `apps/api/src/db/seed.ts`.
- Task 3 - `apps/mobile/src/lib/redo.ts` (+test), `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/src/screens/Dashboard.tsx`, `apps/mobile/src/screens/EventDetail.tsx`, `apps/mobile/src/lib/notifications.ts`.
- Task 4 - full verification.

---

## Task 1: Shared types

**Files:** Modify `packages/shared/src/schemas.ts`

- [ ] **Step 1: Edit `CreateEventInput`** - drop `title`, rename `lockThings` -> `lockActivity`.

Replace the `CreateEventInput` object's `title` and `lockThings` lines so the schema reads:

```typescript
export const CreateEventInput = z.object({
  groupId: z.string(),
  description: z.string().max(500).optional(),
  location: z.string().max(120).optional(),
  timeCandidates: z.array(TimeCandidateInput).max(10).optional(),
  activityCandidates: z.array(z.string().min(1).max(80)).max(10).optional(),
  lockTimes: z.boolean().optional().default(false),
  lockActivity: z.boolean().optional().default(false),
  decidesBy: z.string().optional(),
  replyBy: z.string().optional(),
  quorum: z.number().int().min(1).max(50).optional(),
});
```

(The `title` field is removed entirely - naming a plan is done via `activityCandidates`.)

- [ ] **Step 2: Edit `UpdateEventInput`** - rename the `title` field to `activity`.

Replace the `title` line in `UpdateEventInput` with:

```typescript
  activity: FieldEdit.refine((f) => f.to.length <= 80, { message: "activity is too long" }).optional(),
```

Also update the doc comment above `UpdateEventInput`: change "(title/location/notes)" to "(activity/location/notes)" and "empty title reverts to auto-derive" to "an empty activity clears the name so it re-derives from the winning candidate".

- [ ] **Step 3: Typecheck shared**

Run: `pnpm --filter @bethere/shared typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "refactor(shared): unify create/update name onto activity (DRP-42)"
```

---

## Task 2: Schema + migration + API

**Files:** `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0008_activity_rename.sql` (create), `apps/api/src/db/migrations/meta/_journal.json`, `apps/api/src/routers/create-plan.ts` (+ `create-plan.test.ts`), `apps/api/src/routers/events.ts`, `apps/api/src/routers/past-meetups.ts` (+ `past-meetups.test.ts`), `apps/api/src/db/seed-data.ts` (+ `seed-data.test.ts`), `apps/api/src/db/seed.ts`

- [ ] **Step 1: Rename the columns in `schema.ts`**

In `apps/api/src/db/schema.ts`, in the `events` table:
- change `title: text("title").notNull(),` to `activity: text("activity").notNull(),`
- change `lockThings: boolean("lock_things").notNull().default(false),` to `lockActivity: boolean("lock_activity").notNull().default(false),`

- [ ] **Step 2: Create the migration** `apps/api/src/db/migrations/0008_activity_rename.sql`:

```sql
-- Unify a plan's name with its activity: rename the title column to activity and the lock_things flag
-- to lock_activity. Pure column renames, no data transform. See the activity-unification spec.
ALTER TABLE "events" RENAME COLUMN "title" TO "activity";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "lock_things" TO "lock_activity";
```

- [ ] **Step 3: Register the migration in the journal**

In `apps/api/src/db/migrations/meta/_journal.json`, append a new entry to the `entries` array (after the `0007_add_reply_by` entry), so the tail reads:

```json
    {
      "idx": 7,
      "version": "7",
      "when": 1780500002000,
      "tag": "0007_add_reply_by",
      "breakpoints": true
    },
    {
      "idx": 8,
      "version": "7",
      "when": 1780500003000,
      "tag": "0008_activity_rename",
      "breakpoints": true
    }
  ]
}
```

(Do NOT run `drizzle-kit generate` - it is interactive and hangs on rename-vs-create. This hand-written migration + journal entry is what `migrate` applies on boot. The drizzle snapshot is only used by `generate`, not `migrate`; leave it.)

- [ ] **Step 4: Rename helpers in `create-plan.ts`**

In `apps/api/src/routers/create-plan.ts`:
- `planOpensMoment`: rename the param `lockThings` -> `lockActivity` (and the `activityPinned` line that uses it).
- `resolveTitle` -> `resolveActivity`; rename its first param `title` -> `activity` (and the `if (title.trim()...` / `if (activity.trim()...` line). Logic otherwise unchanged.
- Delete `FALLBACK_TITLE`. Rename `displayTitle` -> `displayActivity`; it now returns the trimmed resolved value with NO placeholder:

```typescript
// The plan's display name while it has no fixed activity yet: the leading ACTIVITY candidate (most
// public +1s) so a suggested activity names the plan live. Returns "" when there is none - the client
// falls back to the group name, so a nameless plan never renders blank.
export function displayActivity(
  activity: string,
  activityCandidates: { id: string; label: string | null }[],
  reactions: { candidateId: string; userId: string }[],
): string {
  return resolveActivity(activity, activityCandidates, reactions).trim();
}
```

Update the doc comment on `resolveActivity` to say "winning ACTIVITY candidate becomes the plan's name" (drop the word "title").

- [ ] **Step 5: Update `create-plan.test.ts`**

In `apps/api/src/routers/create-plan.test.ts`:
- Update the import to `{ displayActivity, planOpensMoment, resolveActivity }` (drop `FALLBACK_TITLE`).
- Replace `resolveTitle(` -> `resolveActivity(` and `displayTitle(` -> `displayActivity(` in every test.
- Replace the test `"displayTitle falls back to the placeholder with no title and no activities"` with:

```typescript
test("displayActivity is empty with no activity and no candidates (client falls back to the group)", () => {
  assert.equal(displayActivity("", [], []), "");
});
```

- [ ] **Step 6: Run create-plan tests**

Run: `pnpm --filter @bethere/api exec node --import tsx --test src/routers/create-plan.test.ts`
Expected: PASS.

- [ ] **Step 7: Update `events.ts`** (every name/lock site)

In `apps/api/src/routers/events.ts`:
- Import line: `import { displayActivity, planOpensMoment, resolveActivity } from "./create-plan.js";`
- `settleCollecting`: `resolveTitle(e.title, ...)` -> `resolveActivity(e.activity, ...)`; rename the local `const title` -> `const activity`; the guarded write `.set({ title }).where(and(eq(events.id, e.id), eq(events.title, "")))` -> `.set({ activity }).where(and(eq(events.id, e.id), eq(events.activity, "")))`; `e.title = title` -> `e.activity = activity`. Apply the same in `lock`.
- `create`: there is no `input.title` now. Compute the resolved name as `resolveActivity("", activityCands.map((c) => ({ id: c.id, label: c.label })), [])` for the `opensMoment` case, else `""`; store it as `activity:` in the insert (was `title: resolvedTitle`). Replace `lockThings: input.lockThings` -> `lockActivity: input.lockActivity` in the insert. Replace `planOpensMoment(timeCands.length, input.lockTimes, activityCands.length, input.lockThings)` -> `... input.lockActivity)`. Replace the guard `if (input.lockThings && activityCands.length === 0)` -> `if (input.lockActivity && activityCands.length === 0)` (keep its message).
- `addCandidate`: `if (input.kind === "activity" && e.lockThings)` -> `e.lockActivity`.
- `update`: rename the `title` field handling to `activity` (the input field is now `input.activity`; the conflict push `field: "title"` -> `field: "activity"`; the DB column `e.title`/`set.title` -> `e.activity`/`set.activity`). ADD a pre-lock guard: an activity edit is only allowed once the name is fixed. Near the top of the handler, after loading `e`, add:

```typescript
    if (input.activity && e.phase === "collecting") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "the activity is decided by the vote while collecting",
      });
    }
```

- `mine`: `let title = e.title` -> `let activity = e.activity`; `title = displayTitle(e.title, ...)` -> `activity = displayActivity(e.activity, ...)`; the returned `title,` field -> `activity,`.
- `get`: `title: displayTitle(e.title, ...)` -> `activity: displayActivity(e.activity, ...)`; `titleRaw: e.title` -> `activityRaw: e.activity`; `lockThings: e.lockThings` -> `lockActivity: e.lockActivity`.
- `pastForGroup`: in the `shaped.push({...})`, `title: e.title` -> `activity: e.activity`, `lockThings: e.lockThings` -> `lockActivity: e.lockActivity`.

- [ ] **Step 8: Update `past-meetups.ts`** (the shaper)

In `apps/api/src/routers/past-meetups.ts`:
- `PastMeetupInput`: rename `title: string` -> `activity: string`; rename `lockThings: boolean` -> `lockActivity: boolean`.
- `PastMeetup`: rename `title: string` -> `activity: string`; rename `lockThings: boolean` -> `lockActivity: boolean`.
- In `shapePastMeetups`'s `.map`, change `title: r.title.trim(),` -> `activity: r.activity.trim(),` and `lockThings: r.lockThings,` -> `lockActivity: r.lockActivity,`.

- [ ] **Step 9: Update `past-meetups.test.ts`**

Replace `title:` -> `activity:` and `lockThings:` -> `lockActivity:` in the `row()` builder and the assertions. The "raw trimmed" test asserts `activity` instead of `title`.

- [ ] **Step 10: Update the seed**

In `apps/api/src/db/seed-data.ts`: the `Plan` type field `title: string` -> `activity: string`; `lockThings?: boolean` -> `lockActivity?: boolean`; rename every fixture `title:` -> `activity:`.
In `apps/api/src/db/seed.ts`: `title: p.title` -> `activity: p.activity`; `lockThings: p.lockThings ?? false` -> `lockActivity: p.lockActivity ?? false`.
In `apps/api/src/db/seed-data.test.ts`: rename any `title:` -> `activity:` in the inline `Plan` fixtures.

- [ ] **Step 11: Typecheck + tests + lint (api green)**

Run: `pnpm --filter @bethere/api typecheck && pnpm --filter @bethere/api test`
Expected: typecheck clean; all api tests pass.
Run: `pnpm lint` (use `pnpm format` if it only flags style, then re-lint). Expected: clean.

- [ ] **Step 12: Verify the migration applies on a clean DB**

Run: `pnpm db:down && pnpm db:up && pnpm --filter @bethere/api db:migrate`
Expected: migrations apply with no error (the rename runs as 0008). If `db:migrate` is not a script, boot the API once (`pnpm dev:api`) and confirm the "migrations applied" log with no error, then stop it.

- [ ] **Step 13: Commit**

```bash
git add apps/api packages
git commit -m "refactor(api): rename title/lock_things to activity/lock_activity end to end (DRP-42)"
```

---

## Task 3: Mobile

**Files:** `apps/mobile/src/lib/redo.ts` (+ `redo.test.ts`), `apps/mobile/src/screens/CreateWizard.tsx`, `apps/mobile/src/screens/Dashboard.tsx`, `apps/mobile/src/screens/EventDetail.tsx`, `apps/mobile/src/lib/notifications.ts`

- [ ] **Step 1: Simplify `redo.ts`** - the name now rides along in the activity list, so the prefill no longer carries a separate title; just rename the lock flag.

Replace the contents of `apps/mobile/src/lib/redo.ts` with:

```typescript
// The wizard's pre-fillable state when starting a meetup FROM a past one (or fresh). The time is never
// carried (always stale). The plan's NAME is its activity, which rides in the activity list - so there
// is no separate name field to carry.
export type Prefill = {
  activityChips: string[];
  lockTimes: boolean;
  lockActivity: boolean;
  location: string;
  description: string;
};

// The "Start fresh" baseline: an empty wizard.
export const EMPTY_PREFILL: Prefill = {
  activityChips: [],
  lockTimes: false,
  lockActivity: false,
  location: "",
  description: "",
};

// The shape we pre-fill from. A structural subset of the events.pastForGroup row, declared here so this
// module stays free of the trpc client (keeps it pure and unit-testable). The screen passes the trpc
// result, which is structurally compatible.
export type PastMeetupShell = {
  activityCandidates: string[];
  lockTimes: boolean;
  lockActivity: boolean;
  location: string;
  description: string | null;
};

// Map a chosen past meetup into the wizard's pre-fill state.
export function prefillFromMeetup(m: PastMeetupShell): Prefill {
  return {
    activityChips: m.activityCandidates,
    lockTimes: m.lockTimes,
    lockActivity: m.lockActivity,
    location: m.location,
    description: m.description ?? "",
  };
}

// The wizard steps. The "source" step (start fresh vs use a previous meetup) appears only when the
// chosen group has past meetups; otherwise the wizard is exactly as it was before redo.
export function wizardSteps(hasPast: boolean): string[] {
  return hasPast
    ? ["group", "source", "activities", "times", "options", "confirm"]
    : ["group", "activities", "times", "options", "confirm"];
}
```

- [ ] **Step 2: Update `redo.test.ts`**

Replace the `shell` and assertions so there is no `title`, and `lockThings` is `lockActivity`:

```typescript
import { EMPTY_PREFILL, type PastMeetupShell, prefillFromMeetup, wizardSteps } from "./redo";

const shell: PastMeetupShell = {
  activityCandidates: ["bowling", "the pub"],
  lockTimes: true,
  lockActivity: false,
  location: "TenPin",
  description: "come at 6",
};

test("wizardSteps inserts the source step only when there is past history", () => {
  expect(wizardSteps(false)).toEqual(["group", "activities", "times", "options", "confirm"]);
  expect(wizardSteps(true)).toEqual([
    "group",
    "source",
    "activities",
    "times",
    "options",
    "confirm",
  ]);
});

test("prefillFromMeetup carries activities, locks, location, and notes", () => {
  expect(prefillFromMeetup(shell)).toEqual({
    activityChips: ["bowling", "the pub"],
    lockTimes: true,
    lockActivity: false,
    location: "TenPin",
    description: "come at 6",
  });
});

test("prefillFromMeetup maps a null description to an empty string", () => {
  expect(prefillFromMeetup({ ...shell, description: null }).description).toBe("");
});

test("EMPTY_PREFILL is the start-fresh baseline", () => {
  expect(EMPTY_PREFILL).toEqual({
    activityChips: [],
    lockTimes: false,
    lockActivity: false,
    location: "",
    description: "",
  });
});
```

- [ ] **Step 3: Update `CreateWizard.tsx`** - remove the title field, rename the lock, fix prefill + source card.

In `apps/mobile/src/screens/CreateWizard.tsx`:
- Delete the title state: remove `const [title, setTitle] = useState("");` (and its comment).
- Rename the lock state: `const [lockThings, setLockThings] = useState(false);` -> `const [lockActivity, setLockActivity] = useState(false);`. Replace every `lockThings`/`setLockThings` -> `lockActivity`/`setLockActivity`, and `lockThingsEff` -> `lockActivityEff` (the `const lockThingsEff = lockThings && canLockActivity;` line and its uses in `isConcrete`, `confirmMirror`, and `submit`).
- `applyPrefill`: remove `setTitle(p.title);`; change `setLockThings(p.lockThings)` -> `setLockActivity(p.lockActivity)`.
- `submit`: remove the `title: title.trim() || undefined,` line; change `lockThings: lockThingsEff,` -> `lockActivity: lockActivityEff,`.
- Remove the "Title" `Field` from the `stepKey === "options"` block (the `<Field label="Title" ... />` and its `value={title}`/`onChangeText={setTitle}`). Leave Location and Notes; remove the now-unused `style={{ marginTop: 12 }}` shuffle if Location becomes first (Location keeps its own spacing - leave Location without a leading marginTop if it is now first).
- The "Lock the activity" `CheckRow` on the activities step: `on={lockThingsEff}` -> `on={lockActivityEff}`, `onToggle={() => setLockThings((v) => !v)}` -> `setLockActivity`.
- `SourceCard` for past meetups: the title prop reads the meetup's name, now `m.activity`: change `title={m.title || "Untitled meetup"}` -> `title={m.activity}` (cleared plans always have an activity).
- Reword the activities-step `sub` and the confirm-step "No names" line so "name" refers only to anonymity: change `sub="Drop a few activities - optional, and the group can add more. No names - it's the group's."` to `sub="Drop a few activities - optional, and the group can add more. It is the group's, shown without who suggested what."` and the confirm `No names - it's the group's.` to `Shown without names - it is the group's.`

- [ ] **Step 4: Update `Dashboard.tsx`** - apply the heading rule (activity, group fallback).

In `apps/mobile/src/screens/Dashboard.tsx`:
- In the `Ev`-typed card components, the heading currently uses `e.title`. Replace heading usages with `e.activity || e.groupName`:
  - `MeetCard` heading (`{e.title}`) -> `{e.activity || e.groupName}`.
  - The featured/section title prop and `ActionCard`'s `title={e.title}` -> `title={e.activity || e.groupName}`.
- Subline rule: where a card shows the group line `{e.groupName}{e.location ? ` · ${e.location}` : ""}`, when there is NO activity the group is already the heading, so show only the location there. Replace that expression with:

```tsx
{e.activity ? `${e.groupName}${e.location ? ` · ${e.location}` : ""}` : e.location}
```

  (Apply in `MeetCard`; `DeadlineCard` receives `groupName` as a prop - pass `e.activity ? e.groupName : ""` so the group line is blank when the group is already the heading.)

- [ ] **Step 5: Update `EventDetail.tsx`** - rename to activity, gate the name edit to post-lock.

In `apps/mobile/src/screens/EventDetail.tsx`:
- Rename the edit state `editTitle`/`setEditTitle` -> `editActivity`/`setEditActivity`.
- `setEditTitle(data.titleRaw)` -> `setEditActivity(data.activityRaw)`; `const loadedTitle = data.titleRaw` -> `const loadedActivity = data.activityRaw`.
- The patch type/field: `title?: { from: string; to: string }` -> `activity?: ...`; `if (editTitle !== loadedTitle) patch.title = { from: loadedTitle, to: editTitle }` -> `if (editActivity !== loadedActivity) patch.activity = { from: loadedActivity, to: editActivity }`; the empty-check `if (!patch.title && ...)` -> `!patch.activity`; the conflict handler `if (c.field === "title") setEditTitle(c.current)` -> `if (c.field === "activity") setEditActivity(c.current)`.
- The plan-name heading (`{data.title}`) -> `{data.activity || data.groupName}`.
- The edit-sheet name field: only render it when the name is fixed (post-lock). Wrap the title/activity `Field` (the one with `placeholder={data.title}`) in `{(data.phase === "moment" || data.phase === "cleared") && ( ... )}`, label it "Activity", `value={editActivity}`, `onChangeText={setEditActivity}`, `placeholder={data.activity}`.
- `data.lockThings` -> `data.lockActivity` (the two sites: the `Activity` section visibility `(data.activityCandidates.length > 0 || !data.lockThings)` and `{!data.lockThings && <AddActivity .../>}`).

- [ ] **Step 6: Update `notifications.ts`** - the reminder text uses the plan name; keep the OS notification's own `title` arg.

In `apps/mobile/src/lib/notifications.ts`:
- In the `RemindableEvent` `Pick<...>`, replace `"title"` with `"activity"` and add `"groupName"` (so the fallback is available): the Pick becomes `"id" | "activity" | "groupName" | "phase" | "myStatus" | "iReacted" | "decidesBy" | "momentEndsAt"`.
- In the three reminder strings, replace `${e.title}` with `${e.activity || e.groupName}`.
- DO NOT rename the `schedule(date, title, body)` function param or `content: { title, body }` - that `title` is the OS notification's title, a different concept; leave it.

- [ ] **Step 7: Typecheck + jest + lint (mobile green)**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: no errors.
Run: `pnpm --filter @bethere/mobile exec jest --watchAll=false --forceExit`
Expected: all suites pass.
Run: `pnpm lint` (root). Expected: clean (`pnpm format` then re-lint if only style).

- [ ] **Step 8: Commit**

```bash
git add apps/mobile
git commit -m "refactor(mobile): unify the plan name onto activity, group-name heading fallback (DRP-42)"
```

---

## Task 4: Full verification

- [ ] **Step 1: Whole-repo green**

Run: `pnpm typecheck` (all 3 packages Done).
Run: `pnpm --filter @bethere/api test` (api green) and `pnpm --filter @bethere/mobile exec jest --watchAll=false --forceExit` (mobile green).
Run: `pnpm lint` (clean).

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rniE "lockThings|lock_things|resolveTitle|displayTitle|FALLBACK_TITLE|titleRaw|\\.title\\b" apps packages --include=*.ts --include=*.tsx | grep -v "BackBar\|Heading\|Section\|SectionBand\|title=\"\|content: { title\|schedule(" `
Expected: no remaining references to the renamed plan-name identifiers. (Hits inside `BackBar`/`Heading`/`Section`/the OS-notification `title` are unrelated UI-component props named "title" and are fine.)

- [ ] **Step 3: Manual smoke (with API + app running)**

- Create a plan by naming ONE activity and locking it + one locked time -> concrete; its heading is that activity.
- Create a plan by offering several activities open -> the dashboard heading shows the leading one; with none yet, the heading shows the GROUP name (no "An activity").
- Lock it, then edit the name from EventDetail (the Activity field appears only post-lock).
- Redo a past meetup -> activities/locks/location/notes carry; time blank; the source card shows the past activity name.

- [ ] **Step 4: Update Linear DRP-42** with the unification commits; this completes both redo + unification on the branch.

## Self-review notes (checked against the spec)

- **Spec coverage:** model collapse (Tasks 1-3); word `activity` everywhere (naming map applied across Tasks 1-3); schema rename + hand-written migration (Task 2 Steps 1-3, 12); drop title field (Task 1 Step 1, Task 3 Step 3); `events.update` post-lock-only name edit (Task 2 Step 7, Task 3 Step 5); display heading = activity with group fallback (Task 3 Steps 4-5); `displayActivity` returns "" not a placeholder (Task 2 Step 4); reword the "name"/anonymity and "things" copy (Task 3 Step 3); seeds + tests (Task 2 Steps 5,9,10; Task 3 Steps 2; Task 4). Redo title-carry removed because the activity list carries the name (Task 3 Steps 1-3).
- **Type consistency:** `resolveActivity`/`displayActivity`, `lockActivity`/`lockActivityEff`, `events.activity`/`events.lockActivity`, `activity`/`activityRaw` (get), `PastMeetup.activity`, `Prefill` without title - used identically across tasks.
- **No placeholders:** every step lists exact identifiers/paths and the new-logic code.
- **Coupling note:** full `pnpm typecheck` is green only after Task 3; each task leaves its own package green in dependency order.
