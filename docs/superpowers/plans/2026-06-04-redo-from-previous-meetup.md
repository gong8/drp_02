# Redo: start a meetup from a previous one - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a creator start a new plan FROM a past meetup in the same group, cloning its shell (activities, lock flags, location, notes) but not its time or any RSVP data, killing re-creation friction for recurring hangouts.

**Architecture:** One new read-only tRPC query (`events.pastForGroup`) returns each cleared plan's clonable shell. Its sort/cap/shape logic is a pure function (unit-tested with `node:test`); the procedure is thin DB glue. The mobile `CreateWizard` gains a conditional "source" step after group selection: if the chosen group has past meetups, the creator picks "Start fresh" or one of them, and the chosen one's fields pre-fill the rest of the wizard. The clone is sent through the existing `events.create` mutation. No schema change.

**Tech Stack:** tRPC v11, Zod, Drizzle ORM, Fastify (api); Expo React Native, `@react-navigation` (mobile); `node:test` (api tests), jest (mobile tests). pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-04-redo-from-previous-meetup-design.md`. **Linear:** DRP-42.

---

## Conventions (read before starting)

- **pnpm only.** Per-package scripts: `pnpm --filter @bethere/api <script>`, `pnpm --filter @bethere/mobile <script>`.
- **No em dashes** anywhere (code, comments, docs). Use hyphens.
- `apps/api` is ESM: **relative imports need `.js` extensions** (e.g. `import { x } from "./past-meetups.js"`).
- **Type chain:** Zod/types live in `@bethere/shared`; tRPC procedures in `apps/api`; the mobile client's types follow automatically. Do not hand-write API types on mobile - infer them.
- Mobile imports `@bethere/api` **type-only**.
- Work on `dev`. Commit each task as its own modular commit.
- The aggregate `pnpm test` can hang on mobile jest (a known issue); run tests **per package** as shown in each task.

## File structure

- `apps/api/src/routers/past-meetups.ts` (CREATE) - pure shaper `shapePastMeetups` + `PAST_MEETUPS_LIMIT` + the `PastMeetupInput` / `PastMeetup` types. One responsibility: turn cleared-event rows into the sorted, capped, clonable DTO list.
- `apps/api/src/routers/past-meetups.test.ts` (CREATE) - `node:test` unit tests for the shaper.
- `apps/api/src/routers/events.ts` (MODIFY) - add the `pastForGroup` procedure; import `ByGroupInput` and the shaper.
- `apps/mobile/src/lib/redo.ts` (CREATE) - pure mobile helpers: `wizardSteps(hasPast)`, `prefillFromMeetup(m)`, `EMPTY_PREFILL`, and the `Prefill` / `PastMeetupShell` types.
- `apps/mobile/src/lib/redo.test.ts` (CREATE) - jest unit tests for the helpers.
- `apps/mobile/src/screens/CreateWizard.tsx` (MODIFY) - fetch past meetups on group change, render the conditional source step, apply pre-fill, reset on group change, use dynamic steps.

---

## Task 1: API pure shaper (`shapePastMeetups`)

**Files:**
- Create: `apps/api/src/routers/past-meetups.ts`
- Test: `apps/api/src/routers/past-meetups.test.ts`

This is the only logic in the feature with branches worth testing: filter is done in SQL, but ordering (most-recent-first), the cap, the empty-title fallback, and activity-label mapping are pure and belong here.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routers/past-meetups.test.ts`:

```typescript
import assert from "node:assert/strict";
import { test } from "node:test";
import { FALLBACK_TITLE } from "./create-plan.js";
import { PAST_MEETUPS_LIMIT, type PastMeetupInput, shapePastMeetups } from "./past-meetups.js";

function row(over: Partial<PastMeetupInput> = {}): PastMeetupInput {
  return {
    id: "e1",
    title: "Bowling",
    location: "TenPin",
    description: null,
    startsAt: new Date("2026-05-01T18:00:00.000Z"),
    lockTimes: false,
    lockThings: false,
    activityLabels: [],
    ...over,
  };
}

test("maps a cleared row into a clonable shell", () => {
  const out = shapePastMeetups([
    row({ activityLabels: ["bowling", "the pub"], lockThings: true, description: "come at 6" }),
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: "e1",
    title: "Bowling",
    location: "TenPin",
    description: "come at 6",
    activityCandidates: ["bowling", "the pub"],
    lockTimes: false,
    lockThings: true,
    lastStartsAt: "2026-05-01T18:00:00.000Z",
  });
});

test("orders most-recent-first by startsAt", () => {
  const out = shapePastMeetups([
    row({ id: "old", startsAt: new Date("2026-01-01T00:00:00.000Z") }),
    row({ id: "new", startsAt: new Date("2026-03-01T00:00:00.000Z") }),
    row({ id: "mid", startsAt: new Date("2026-02-01T00:00:00.000Z") }),
  ]);
  assert.deepEqual(
    out.map((m) => m.id),
    ["new", "mid", "old"],
  );
});

test("caps the list at PAST_MEETUPS_LIMIT, keeping the most recent", () => {
  const many = Array.from({ length: PAST_MEETUPS_LIMIT + 5 }, (_, i) =>
    row({ id: `e${i}`, startsAt: new Date(2026, 0, i + 1) }),
  );
  const out = shapePastMeetups(many);
  assert.equal(out.length, PAST_MEETUPS_LIMIT);
  // The newest (largest day) must be first and survive the cap.
  assert.equal(out[0].id, `e${PAST_MEETUPS_LIMIT + 4}`);
});

test("falls back to the placeholder title when the stored title is empty", () => {
  const out = shapePastMeetups([row({ title: "   " })]);
  assert.equal(out[0].title, FALLBACK_TITLE);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/api exec node --import tsx --test src/routers/past-meetups.test.ts`
Expected: FAIL - cannot find module `./past-meetups.js` (or export not found).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/api/src/routers/past-meetups.ts`:

```typescript
import { FALLBACK_TITLE } from "./create-plan.js";

// Cap the redo picker so a long-lived group's history stays usable. De-dup of repeated redos of the
// same activity is a possible future refinement, not done here (see the spec's "Risks / notes").
export const PAST_MEETUPS_LIMIT = 20;

// A cleared plan's row, reduced to the fields a redo needs. The router maps Drizzle rows into this so
// the shaping below stays pure and testable without a database.
export type PastMeetupInput = {
  id: string;
  title: string;
  location: string;
  description: string | null;
  startsAt: Date;
  lockTimes: boolean;
  lockThings: boolean;
  activityLabels: string[];
};

// The clonable shell the client pre-fills the wizard from. Carries no time (always stale) and no RSVP
// data; title is the plan's resolved title, with a placeholder fallback so a row never renders blank.
export type PastMeetup = {
  id: string;
  title: string;
  location: string;
  description: string | null;
  activityCandidates: string[];
  lockTimes: boolean;
  lockThings: boolean;
  lastStartsAt: string;
};

// Shape cleared-plan rows into the redo list: most-recent-first, capped, mapped to the clonable shell.
export function shapePastMeetups(rows: PastMeetupInput[]): PastMeetup[] {
  return rows
    .slice()
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, PAST_MEETUPS_LIMIT)
    .map((r) => ({
      id: r.id,
      title: r.title.trim() || FALLBACK_TITLE,
      location: r.location,
      description: r.description,
      activityCandidates: r.activityLabels,
      lockTimes: r.lockTimes,
      lockThings: r.lockThings,
      lastStartsAt: r.startsAt.toISOString(),
    }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bethere/api exec node --import tsx --test src/routers/past-meetups.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm --filter @bethere/api typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/past-meetups.ts apps/api/src/routers/past-meetups.test.ts
git commit -m "feat(api): pure shaper for past-meetup redo shells (DRP-42)"
```

---

## Task 2: API procedure (`events.pastForGroup`)

**Files:**
- Modify: `apps/api/src/routers/events.ts` (import block near lines 2-23 and 40; new procedure inside the `eventsRouter` object, e.g. after `mine`)

No DB-integration test harness exists in this repo (routers are verified by typecheck + the pure-logic tests + manual run), so this task has no automated test of its own - the branching logic it relies on is covered by Task 1.

- [ ] **Step 1: Add `ByGroupInput` to the shared import**

In `apps/api/src/routers/events.ts`, the import from `@bethere/shared` (starts at line 2) lists inputs alphabetically-ish. Add `ByGroupInput` to it. After editing, the relevant lines read:

```typescript
import {
  AddCandidateInput,
  addCandidateHorizon,
  ByGroupInput,
  ByIdInput,
  type CandidateKind,
  CreateEventInput,
  clears,
  // ...rest unchanged
} from "@bethere/shared";
```

- [ ] **Step 2: Import the shaper**

Below the existing `import { displayTitle, planOpensMoment, resolveTitle } from "./create-plan.js";` (line 40), add:

```typescript
import { type PastMeetupInput, shapePastMeetups } from "./past-meetups.js";
```

- [ ] **Step 3: Add the procedure**

Inside `eventsRouter = router({ ... })`, add this procedure immediately after the `mine` procedure (after its closing `}),` near line 704). It reuses the existing `requireMember`, `candidatesFor`, `db`, and `events`/`eq`/`and` already in this file:

```typescript
  // The redo picker: a group's past (cleared) meetups, each reduced to a clonable shell - activities,
  // lock flags, location, notes - so the wizard can pre-fill a fresh plan from one. Carries no time
  // (always stale) and no RSVP data; the creator stays anonymous (no creator identity is returned).
  pastForGroup: protectedProcedure.input(ByGroupInput).query(async ({ ctx, input }) => {
    await requireMember(input.groupId, ctx.userId);
    const rows = await db
      .select()
      .from(events)
      .where(and(eq(events.groupId, input.groupId), eq(events.phase, "cleared")));
    const shaped: PastMeetupInput[] = [];
    for (const e of rows) {
      const cands = await candidatesFor(e.id);
      const activityLabels = cands
        .filter((c) => c.kind === "activity" && c.label)
        .map((c) => c.label as string);
      shaped.push({
        id: e.id,
        title: e.title,
        location: e.location,
        description: e.description,
        startsAt: e.startsAt,
        lockTimes: e.lockTimes,
        lockThings: e.lockThings,
        activityLabels,
      });
    }
    return shapePastMeetups(shaped);
  }),
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @bethere/api typecheck`
Expected: no errors (confirms `ByGroupInput`, the shaper types, and the Drizzle query all line up).

- [ ] **Step 5: Manual smoke test against the seeded demo**

The local API reseeds a demo on boot with at least one `cleared` plan. In one terminal: `pnpm db:up && pnpm --filter @bethere/api db:migrate && pnpm dev:api`. The demo seeds the dev user `u_dev` into groups. In another terminal, list its groups, then call the new query for a group id from that list:

```bash
# 1) find a group id u_dev belongs to
curl -s 'http://localhost:3000/trpc/groups.mine' -H 'x-user-id: u_dev' | head -c 600; echo
# 2) call pastForGroup for one of those group ids (tRPC GET encodes input as a JSON query param)
curl -s 'http://localhost:3000/trpc/events.pastForGroup?input=%7B%22groupId%22%3A%22GROUP_ID_HERE%22%7D' \
  -H 'x-user-id: u_dev' | head -c 800; echo
```

Expected: step 2 returns `{"result":{"data":[...]}}` where each item has `activityCandidates`, `lockTimes`, `lockThings`, `location`, `lastStartsAt`, and no `phase`/responses/creator fields. A group with no cleared plans returns `[]`. (If the seed has no cleared plan for the chosen group, pick another group id, or note it - this is a smoke check, not an assertion.)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/events.ts
git commit -m "feat(api): events.pastForGroup query for the redo picker (DRP-42)"
```

---

## Task 3: Mobile pure helpers (`redo.ts`)

**Files:**
- Create: `apps/mobile/src/lib/redo.ts`
- Test: `apps/mobile/src/lib/redo.test.ts`

These are the first jest tests in `apps/mobile`. They are pure (no React, no native modules), so jest runs them with no extra config. `prefillFromMeetup` takes a structural `PastMeetupShell` (not the trpc type) so the test needs no client import.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/src/lib/redo.test.ts`:

```typescript
import { EMPTY_PREFILL, type PastMeetupShell, prefillFromMeetup, wizardSteps } from "./redo";

const shell: PastMeetupShell = {
  activityCandidates: ["bowling", "the pub"],
  lockTimes: true,
  lockThings: false,
  location: "TenPin",
  description: "come at 6",
};

test("wizardSteps inserts the source step only when there is past history", () => {
  expect(wizardSteps(false)).toEqual(["group", "activities", "times", "options", "confirm"]);
  expect(wizardSteps(true)).toEqual(["group", "source", "activities", "times", "options", "confirm"]);
});

test("prefillFromMeetup carries activities, locks, location, and notes", () => {
  expect(prefillFromMeetup(shell)).toEqual({
    activityChips: ["bowling", "the pub"],
    lockTimes: true,
    lockThings: false,
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
    lockThings: false,
    location: "",
    description: "",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/mobile exec jest src/lib/redo.test.ts --watchAll=false`
Expected: FAIL - cannot resolve `./redo`.

- [ ] **Step 3: Write the minimal implementation**

Create `apps/mobile/src/lib/redo.ts`:

```typescript
// The wizard's pre-fillable state when starting a meetup FROM a past one (or fresh). The time is never
// carried (always stale); title is never set in the wizard (the server resolves the winning activity).
export type Prefill = {
  activityChips: string[];
  lockTimes: boolean;
  lockThings: boolean;
  location: string;
  description: string;
};

// The "Start fresh" baseline: an empty wizard.
export const EMPTY_PREFILL: Prefill = {
  activityChips: [],
  lockTimes: false,
  lockThings: false,
  location: "",
  description: "",
};

// The shape we pre-fill from. A structural subset of the events.pastForGroup row, declared here so this
// module stays free of the trpc client (keeps it pure and unit-testable). The screen passes the trpc
// result, which is structurally compatible.
export type PastMeetupShell = {
  activityCandidates: string[];
  lockTimes: boolean;
  lockThings: boolean;
  location: string;
  description: string | null;
};

// Map a chosen past meetup into the wizard's pre-fill state.
export function prefillFromMeetup(m: PastMeetupShell): Prefill {
  return {
    activityChips: m.activityCandidates,
    lockTimes: m.lockTimes,
    lockThings: m.lockThings,
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

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @bethere/mobile exec jest src/lib/redo.test.ts --watchAll=false`
Expected: PASS (4 tests). If jest does not exit on its own, that is the known mobile-jest handle leak; the pass/fail summary still prints. You can add `--forceExit` if needed.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/redo.ts apps/mobile/src/lib/redo.test.ts
git commit -m "feat(mobile): pure redo helpers (steps + prefill) (DRP-42)"
```

---

## Task 4: Mobile wizard wiring (the source step)

**Files:**
- Modify: `apps/mobile/src/screens/CreateWizard.tsx`

Wire the conditional source step into the existing wizard. This is RN UI, verified by typecheck + manual run (no RN component-test harness exists in this repo).

- [ ] **Step 1: Import the helpers and the trpc-derived type**

At the top of `CreateWizard.tsx`, alongside the existing imports, add:

```typescript
import { EMPTY_PREFILL, type Prefill, prefillFromMeetup, wizardSteps } from "../lib/redo";
```

Add a type alias near the existing `type Group = ...` (line 21):

```typescript
type PastMeetup = Awaited<ReturnType<typeof trpc.events.pastForGroup.query>>[number];
```

- [ ] **Step 2: Replace the static `STEPS` constant with dynamic steps + new state**

Delete the module-level `const STEPS = [...] as const;` (line 25). Inside the component, the steps now depend on whether the chosen group has past meetups. Add this state near the other `useState` calls (after `groupId`, around line 33):

```typescript
  const [pastMeetups, setPastMeetups] = useState<PastMeetup[]>([]);
  // The source-step choice: null = not chosen yet, "fresh" = start blank, otherwise a past-meetup id.
  const [source, setSource] = useState<"fresh" | string | null>(null);
```

Then replace the early `const stepKey = STEPS[step];` / `const isLastStep = ...` lines (lines 28-30) with derived values computed AFTER `pastMeetups` is declared (move them below the state block):

```typescript
  const STEPS = wizardSteps(pastMeetups.length > 0);
  const stepKey = STEPS[step];
  const isLastStep = step === STEPS.length - 1;
```

(Keep `const [step, setStep] = useState(0);` where it is at the top - only the `STEPS`/`stepKey`/`isLastStep` derivations move down.)

- [ ] **Step 3: Fetch past meetups when the group changes, and reset stale clone state**

Add a `useEffect` keyed on `groupId`, after the existing groups-loading `useEffect` (after line 72). It refetches the picker list and clears any clone carried over from a previously selected group, so switching groups never leaks the wrong group's data:

```typescript
  // When the chosen group changes, refresh its redo list and drop any clone/source from the previous
  // group (the source step is only meaningful for the currently selected group).
  useEffect(() => {
    if (!groupId) return;
    setSource(null);
    applyPrefill(EMPTY_PREFILL);
    trpc.events.pastForGroup
      .query({ groupId })
      .then(setPastMeetups)
      .catch(() => setPastMeetups([]));
  }, [groupId]);
```

- [ ] **Step 4: Add the `applyPrefill` helper**

Inside the component, near the other helpers (e.g. above `commitDraftActivity`, around line 134), add a single setter that applies a `Prefill` to the wizard fields. Reusing it for both "fresh" and a chosen meetup keeps the mapping in one place:

```typescript
  function applyPrefill(p: Prefill) {
    setActivityChips(p.activityChips);
    setActivityDraft("");
    setLockTimes(p.lockTimes);
    setLockThings(p.lockThings);
    setLocation(p.location);
    setDescription(p.description);
    // Time is never carried - reset to a single blank row so the creator sets it fresh.
    setRows([{ id: "t0", date: "", time: "" }]);
    nextRowId.current = 1;
    setDecidesEdit(false);
    setReplyEdit(false);
  }
```

- [ ] **Step 5: Make the source step required in `valid`**

In the `valid` function (lines 121-130), add a `source` case so Next is disabled until the creator picks fresh or a previous meetup:

```typescript
  function valid(key: string): boolean {
    switch (key) {
      case "group":
        return !!groupId;
      case "source":
        return source !== null;
      case "options":
        return !decidesInvalid && !replyInvalid;
      default:
        return true; // activities, times, confirm - all optional
    }
  }
```

- [ ] **Step 6: Render the source step**

Add this block inside the `<ScrollView>`, immediately after the `stepKey === "group"` block closes (after line 239) and before the `stepKey === "activities"` block. Choosing fresh or a meetup applies the matching prefill and advances by Next:

```tsx
          {stepKey === "source" && (
            <Step
              title="Fresh, or do one again?"
              sub="This group has done things before. Reuse one to skip the setup - you'll just pick a new time."
            >
              <Pressable onPress={() => { setSource("fresh"); applyPrefill(EMPTY_PREFILL); }}>
                <Card padding={14} style={{ marginBottom: 11, borderColor: source === "fresh" ? ui.brand : ui.ink }}>
                  <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>
                    Start fresh
                  </Text>
                  <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
                    A blank meetup
                  </Text>
                </Card>
              </Pressable>
              {pastMeetups.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => { setSource(m.id); applyPrefill(prefillFromMeetup(m)); }}
                >
                  <Card
                    padding={14}
                    style={{ marginBottom: 11, borderColor: source === m.id ? ui.brand : ui.ink }}
                  >
                    <Text style={{ fontFamily: font.display, fontSize: 16, color: ui.ink }}>
                      {m.title}
                    </Text>
                    <Text style={{ fontFamily: font.medium, fontSize: 11, color: ui.muted, marginTop: 2 }}>
                      {m.location ? `${m.location} · ` : ""}last on {formatSlot(m.lastStartsAt)}
                    </Text>
                  </Card>
                </Pressable>
              ))}
            </Step>
          )}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: no errors. (Confirms the dynamic `STEPS`, the new state, `applyPrefill`, and the trpc-derived `PastMeetup` type all line up. `formatSlot` and `Card`/`ui`/`font`/`Pressable` are already imported in this file.)

- [ ] **Step 8: Lint the workspace**

Run: `pnpm lint`
Expected: no errors. (`pnpm format` auto-fixes style if needed.)

- [ ] **Step 9: Manual end-to-end check**

With the API running (`pnpm dev:api`) and the app (`pnpm dev:mobile`), signed in as the demo user:
- Open New meetup, pick a group that has a past (cleared) meetup -> the "Fresh, or do one again?" step appears.
- Tap a previous meetup -> Next -> the activities step shows its activities pre-filled, the times step is blank, the options step shows its location/notes/locks pre-filled.
- Set a time, send -> a new plan is created (lands back on the dashboard).
- Pick a group with NO past meetups -> the source step is skipped; the wizard behaves exactly as before.
- From the source step, go Back to group, switch to a different group -> the list updates and any previous pre-fill is cleared.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/screens/CreateWizard.tsx
git commit -m "feat(mobile): conditional source step to redo a past meetup (DRP-42)"
```

---

## Final verification

- [ ] `pnpm --filter @bethere/api test` (api `node:test` suite passes, including the new shaper tests)
- [ ] `pnpm --filter @bethere/mobile exec jest --watchAll=false` (mobile jest passes; use `--forceExit` if the known handle-leak keeps it open)
- [ ] `pnpm typecheck` (all packages)
- [ ] `pnpm lint`
- [ ] Update Linear DRP-42 to In Review / Done and reference the commits.
- [ ] When ready to ship: PR `dev` -> `main`.

## Self-review notes (already checked while writing)

- **Spec coverage:** wizard source step gated on history (Task 4); clone carries activities/locks/location/notes, not time/RSVP (Task 3 `prefillFromMeetup` + Task 4 `applyPrefill`); cleared-only + group-wide + most-recent + cap (Tasks 1-2); one read-only `events.pastForGroup`, no schema change, clone reuses `events.create` (Task 2 + Task 4 send path is the existing `submit`); privacy: no creator identity / no RSVP data returned (Task 2 maps only shell fields).
- **Deviation from spec, intentional:** the spec mentioned a "PastForGroup output schema" in `@bethere/shared`. The codebase does NOT define Zod output schemas for reads (`events.mine`/`events.get` return inferred plain objects), and the input is the already-exported `ByGroupInput`. So no `@bethere/shared` change is needed; the mobile type is inferred via the tRPC chain, matching the existing pattern.
- **Type consistency:** `PastMeetupInput`/`PastMeetup` (api) and `Prefill`/`PastMeetupShell` (mobile) names are used identically across tasks; `shapePastMeetups`, `prefillFromMeetup`, `wizardSteps`, `applyPrefill`, `EMPTY_PREFILL` match their definitions and call sites.
