# Lock-in Deadline + Bounded Additions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lock-in deadline for non-exact plans logically sound and well-placed across timescales, and bound member-added candidate times to the plan's window/horizon.

**Architecture:** All new timing logic lives as pure, unit-tested functions in `packages/shared/src/logic/lock.ts` (the codebase has no tRPC router test harness; routers stay thin and call shared helpers). Two intent-named defaults replace the single `defaultLockAt`: one anchored to a deliberate proposed time (`options`), one anchored to a loose window (`fuzzy`). A pure `addCandidateHorizon` computes the upper bound for added times, enforced server-side and mirrored in the mobile picker. The deadline stays fixed once set; the creator override path is unchanged except for tightened bounds.

**Tech Stack:** TypeScript, pnpm workspace. Shared: vitest. API: Fastify + tRPC v11, Drizzle (`node --import tsx --test`). Mobile: Expo SDK 54, React Native, `@react-native-community/datetimepicker`.

Spec: `docs/superpowers/specs/2026-06-03-lockin-deadline-bounded-additions-design.md`. Linear: DRP-32.

**Sequencing note:** Each task leaves the repo green. Task 1 *adds* the new helpers alongside the existing `defaultLockAt` (no call sites broken). Tasks 2-5 migrate every call site. Task 6 deletes the now-unused `defaultLockAt`.

---

## File Structure

- `packages/shared/src/logic/lock.ts` (modify) - constants, `defaultLockAtForOptions`, `defaultLockAtForWindow`, `addCandidateHorizon`; `defaultLockAt` removed in Task 6.
- `packages/shared/src/logic/lock.test.ts` (modify) - tests for the new helpers; old `defaultLockAt` block removed in Task 6.
- `apps/api/src/routers/events.ts` (modify) - per-mode default + override bounds in `create`; `addCandidate` upper bound; `settleFloating` crystallization call site.
- `apps/api/src/routers/floats.ts` (modify) - `tipAt` default call site.
- `apps/mobile/src/lib/lock.ts` (modify) - mirror `defaultLockAtForOptions` + `addCandidateHorizon`.
- `apps/mobile/src/screens/CreateWizard.tsx` (modify) - use mirrored default.
- `apps/mobile/src/ui/DateTimeField.types.ts`, `DateTimeField.tsx`, `DateTimeField.web.tsx`, `DateTimePill.tsx` (modify) - add `maximumDate` (date mode).
- `apps/mobile/src/screens/EventDetail.tsx` (modify) - pass `minimumDate`/`maximumDate` to the add-time pill.

---

## Task 1: Shared timing helpers (add alongside the old one)

**Files:**
- Modify: `packages/shared/src/logic/lock.ts`
- Test: `packages/shared/src/logic/lock.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/src/logic/lock.test.ts` (keep the existing `defaultLockAt` block for now; add the new import on line 2):

```ts
import {
  addCandidateHorizon,
  DAY_MS,
  defaultLockAt,
  defaultLockAtForOptions,
  defaultLockAtForWindow,
  MAX_REACT_MS,
} from "./lock.js";
```

Then append these blocks at the end of the file:

```ts
describe("defaultLockAtForOptions", () => {
  it("caps the notice lead at one day for far-out options", () => {
    for (const days of [3, 5, 14]) {
      const earliest = now + days * DAY;
      expect(defaultLockAtForOptions(earliest, now)).toBe(earliest - DAY);
    }
  });

  it("gives the react phase the larger share for mid-range options (lead = T/3)", () => {
    const earliest = now + 24 * HOUR;
    expect(defaultLockAtForOptions(earliest, now)).toBe(earliest - 8 * HOUR);
  });

  it("always returns a value strictly after now and before the earliest slot", () => {
    for (const gapHours of [0.5, 1, 3, 6, 12, 23, 25, 48, 24 * 14]) {
      const earliest = now + gapHours * HOUR;
      const t = defaultLockAtForOptions(earliest, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(earliest);
    }
  });

  it("falls back to a clamped midpoint when the slot is too close for the lead", () => {
    const earliest = now + 30 * 60 * 1000; // 30 min out
    expect(defaultLockAtForOptions(earliest, now)).toBe(now + 15 * 60 * 1000);
  });
});

describe("defaultLockAtForWindow", () => {
  it("locks after ~a third of a short window", () => {
    const last = now + 6 * HOUR;
    expect(defaultLockAtForWindow(last, now)).toBe(now + 2 * HOUR);
  });

  it("caps the react window at three days for a long window", () => {
    const last = now + 14 * DAY;
    expect(defaultLockAtForWindow(last, now)).toBe(now + MAX_REACT_MS);
  });

  it("always returns a value strictly after now and before the last slot", () => {
    for (const spanHours of [1, 4, 24, 24 * 7, 24 * 14]) {
      const last = now + spanHours * HOUR;
      const t = defaultLockAtForWindow(last, now);
      expect(t).toBeGreaterThan(now);
      expect(t).toBeLessThan(last);
    }
  });

  it("falls back to the midpoint when the whole window fits inside one moment", () => {
    const last = now + 30 * 60 * 1000; // 30 min span
    expect(defaultLockAtForWindow(last, now)).toBe(now + 15 * 60 * 1000);
  });
});

describe("addCandidateHorizon", () => {
  it("for fuzzy plans is exactly the last window slot", () => {
    const earliest = now + DAY;
    const latest = now + 7 * DAY;
    expect(addCandidateHorizon(earliest, latest, true)).toBe(latest);
  });

  it("for options plans allows a small slack past the spread, capped at two days", () => {
    const earliest = now + DAY;
    const latest = now + 3 * DAY; // span 2 days
    expect(addCandidateHorizon(earliest, latest, false)).toBe(latest + 2 * DAY);
    const tight = now + DAY + HOUR; // span 1h -> slack 1h
    expect(addCandidateHorizon(now + DAY, tight, false)).toBe(tight + HOUR);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @bethere/shared test`
Expected: FAIL - `addCandidateHorizon`, `defaultLockAtForOptions`, `defaultLockAtForWindow`, `MAX_REACT_MS` are not exported.

- [ ] **Step 3: Add the implementation**

In `packages/shared/src/logic/lock.ts`, keep the existing `defaultLockAt` exactly as-is and add above it (after the existing `HOUR_MS`/`DAY_MS` consts) plus below:

```ts
export const MOMENT_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * MOMENT_MS;
export const MIN_REACT_MS = 2 * MOMENT_MS; // a real reacting window for loose plans
export const MAX_REACT_MS = 3 * DAY_MS; // cap collecting so a loose plan does not lose momentum

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Default deadline for an options/exact-N plan, anchored to a deliberate proposed time. The notice
 * lead scales as a third of the time-to-earliest (so the active reacting phase gets the larger
 * share) and caps at one day. Returns an instant strictly in (now, earliest).
 */
export function defaultLockAtForOptions(
  earliestMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = earliestMs - nowMs;
  const lead = clamp(Math.round(span / 3), momentMs, DAY_MS);
  const ideal = earliestMs - lead;
  if (ideal > nowMs) return ideal;
  // Degenerate near-term plan: not enough room for the lead. Fall back to the midpoint, pulled no
  // later than earliest - moment so the blind moment still fits before the event.
  const latest = earliestMs - momentMs;
  const midpoint = nowMs + span / 2;
  return Math.round(latest > nowMs ? Math.min(midpoint, latest) : midpoint);
}

/**
 * Default deadline for a fuzzy plan, anchored to the loose window (its last slot) rather than to the
 * always-soon earliest slot that window expansion produces. The reacting window is a third of the
 * window span, floored at MIN_REACT_MS and capped at MAX_REACT_MS. Returns an instant strictly in
 * (now, lastSlot).
 */
export function defaultLockAtForWindow(
  lastSlotMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = lastSlotMs - nowMs;
  const react = clamp(Math.round(span / 3), MIN_REACT_MS, MAX_REACT_MS);
  const latest = lastSlotMs - momentMs; // leave moment room before the last day
  const lockAt = Math.min(nowMs + react, latest);
  if (lockAt > nowMs) return Math.round(lockAt);
  return Math.round(nowMs + span / 2); // window narrower than one moment
}

/**
 * Upper bound (epoch ms) for a member-added candidate time. Fuzzy plans stay inside the expanded
 * window (its last slot). Options plans allow a small slack past the creator's spread - the spread
 * length, capped at two days - so a member can suggest a slightly later time without an absurd jump.
 */
export function addCandidateHorizon(
  earliestMs: number,
  latestMs: number,
  isFuzzy: boolean,
): number {
  if (isFuzzy) return latestMs;
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}
```

Note: the existing file already declares `const HOUR_MS`/`const DAY_MS` at the top. To avoid a duplicate `DAY_MS`, delete the existing top-of-file `const HOUR_MS = ...` / `const DAY_MS = ...` lines and have the old `defaultLockAt` use the new exported `MOMENT_MS`/`DAY_MS` (rename its internal `HOUR_MS` references to `MOMENT_MS`). The old function is deleted in Task 6 anyway.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @bethere/shared test`
Expected: PASS (all blocks, including the retained `defaultLockAt` block).

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm --filter @bethere/shared typecheck
git add packages/shared/src/logic/lock.ts packages/shared/src/logic/lock.test.ts
git commit -m "feat(shared): per-anchor lock defaults + add-candidate horizon helper"
```

---

## Task 2: Wire per-mode defaults + bounds into events router

**Files:**
- Modify: `apps/api/src/routers/events.ts`

- [ ] **Step 1: Update the shared import**

In `apps/api/src/routers/events.ts` (import block ending line 20), replace the `defaultLockAt,` line with:

```ts
  addCandidateHorizon,
  defaultLockAtForOptions,
  defaultLockAtForWindow,
```

- [ ] **Step 2: Replace the create-time default + override validation**

Replace the block at `events.ts:368-385` (the `let lockAt: Date | null = null; ...` through the closing `}` of the `if (!exact)`) with:

```ts
    // Non-exact plans collect until a fixed deadline, then auto-lock the winning slot. Options anchor
    // the default to the earliest proposed time; a fuzzy window anchors to its last slot. An explicit
    // creator override is honoured if it sits after now and leaves the blind moment room before the
    // anchor. The deadline never moves once stored.
    let lockAt: Date | null = null;
    if (!exact) {
      const momentMs = DEFAULT_MOMENT_MINUTES * 60 * 1000;
      const earliestMs = cands[0].startsAt.getTime();
      const lastMs = cands[cands.length - 1].startsAt.getTime();
      const fuzzy = when.mode === "fuzzy";
      const anchorMs = fuzzy ? lastMs : earliestMs;
      if (input.lockAt) {
        const t = new Date(input.lockAt);
        if (
          Number.isNaN(t.getTime()) ||
          t.getTime() <= Date.now() ||
          t.getTime() > anchorMs - momentMs
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "lock-in time must be after now and leave room before the plan's window",
          });
        }
        lockAt = t;
      } else {
        lockAt = new Date(
          fuzzy
            ? defaultLockAtForWindow(lastMs, Date.now(), momentMs)
            : defaultLockAtForOptions(earliestMs, Date.now(), momentMs),
        );
      }
    }
```

- [ ] **Step 3: Update the settleFloating crystallization call site**

At `events.ts:243-245`, replace:

```ts
  const lockAt = new Date(
    defaultLockAt(slots[0], now.getTime(), DEFAULT_MOMENT_MINUTES * 60 * 1000),
  );
```

with (a crystallized float is a window; anchor to its last slot):

```ts
  const lockAt = new Date(
    defaultLockAtForWindow(slots[slots.length - 1], now.getTime(), DEFAULT_MOMENT_MINUTES * 60 * 1000),
  );
```

- [ ] **Step 4: Add the addCandidate upper bound**

In `addCandidate` (`events.ts:487-518`), move the `const existing = await candidatesFor(input.eventId);` line so it runs *before* the bound checks, then add the horizon check. Replace the body from the `const startsAt = ...` line through the duplicate-detection block with:

```ts
    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid time" });
    }
    // A new slot must sit after the lock-in deadline (still a live choice when we lock) and within
    // the plan's window/horizon (fuzzy: the window's last day; options: a small slack past the
    // existing spread). Keeps the deadline meaningful without recomputing it.
    if (e.lockAt && startsAt.getTime() <= e.lockAt.getTime()) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "that time is before the lock-in deadline",
      });
    }
    const existing = await candidatesFor(input.eventId);
    const times = existing.map((c) => c.startsAt.getTime());
    const horizon = addCandidateHorizon(
      Math.min(...times),
      Math.max(...times),
      e.whenMode === "fuzzy",
    );
    if (startsAt.getTime() > horizon) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "that time is past this plan's window",
      });
    }
    const dup = existing.find((c) => c.startsAt.getTime() === startsAt.getTime());
    if (dup) return { id: dup.id };
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @bethere/api typecheck`
Expected: PASS (no remaining `defaultLockAt` reference in this file).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routers/events.ts
git commit -m "feat(api): per-mode lock defaults, tightened override + bounded addCandidate"
```

---

## Task 3: Wire the window default into the floats router

**Files:**
- Modify: `apps/api/src/routers/floats.ts`

- [ ] **Step 1: Update the import**

In `apps/api/src/routers/floats.ts` (import block, line 6), replace `defaultLockAt,` with `defaultLockAtForWindow,`.

- [ ] **Step 2: Anchor the tip default to the last window slot**

Replace `floats.ts:67-82` (`const earliestMs = ...` through the `tipAt` assignment) with:

```ts
    const earliestMs = new Date(slots[0].startsAt).getTime();
    const lastMs = new Date(slots[slots.length - 1].startsAt).getTime();

    let tipAt: Date;
    if (input.tipAt) {
      const t = new Date(input.tipAt);
      if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now() || t.getTime() > earliestMs) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "tip time must be after now and on or before the window",
        });
      }
      tipAt = t;
    } else {
      tipAt = new Date(defaultLockAtForWindow(lastMs, Date.now(), DEFAULT_MOMENT_MINUTES * 60 * 1000));
    }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bethere/api typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routers/floats.ts
git commit -m "feat(api): anchor float tip default to the window's last slot"
```

---

## Task 4: Mirror the options default on mobile

**Files:**
- Modify: `apps/mobile/src/lib/lock.ts`
- Modify: `apps/mobile/src/screens/CreateWizard.tsx`

- [ ] **Step 1: Replace the mobile lock helper**

Replace the body of `apps/mobile/src/lib/lock.ts` (keep the top doc comment, update its first line) with:

```ts
// Mobile-local mirror of the lock helpers from `packages/shared/src/logic/lock.ts`.
//
// Why duplicated rather than imported: `@bethere/shared`'s barrel re-exports with explicit `.js`
// extensions (required because `apps/api` is ESM). tsx/tsc resolve `.js`->`.ts`, but Metro does not,
// so a *value* import of `@bethere/shared` from the mobile app fails to bundle. Mobile only consumes
// shared as *types* everywhere else. Keep these in sync with the shared helpers; the server is the
// source of truth for what is actually applied. See docs/tech-debt.md.

const MOMENT_MS = 60 * 60 * 1000;
const DAY_MS = 24 * MOMENT_MS;

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

export function defaultLockAtForOptions(
  earliestMs: number,
  nowMs: number,
  momentMs: number = MOMENT_MS,
): number {
  const span = earliestMs - nowMs;
  const lead = clamp(Math.round(span / 3), momentMs, DAY_MS);
  const ideal = earliestMs - lead;
  if (ideal > nowMs) return ideal;
  const latest = earliestMs - momentMs;
  const midpoint = nowMs + span / 2;
  return Math.round(latest > nowMs ? Math.min(midpoint, latest) : midpoint);
}

export function addCandidateHorizon(
  earliestMs: number,
  latestMs: number,
  isFuzzy: boolean,
): number {
  if (isFuzzy) return latestMs;
  const span = latestMs - earliestMs;
  return latestMs + Math.min(span, 2 * DAY_MS);
}
```

- [ ] **Step 2: Update CreateWizard to use the new name**

In `apps/mobile/src/screens/CreateWizard.tsx`:
- Line 14: change `import { defaultLockAt } from "../lib/lock";` to `import { defaultLockAtForOptions } from "../lib/lock";`
- Line 90: change `new Date(defaultLockAt(earliestMs, Date.now())).toISOString()` to `new Date(defaultLockAtForOptions(earliestMs, Date.now())).toISOString()`

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS (no remaining `defaultLockAt` import).

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src/lib/lock.ts apps/mobile/src/screens/CreateWizard.tsx
git commit -m "feat(mobile): mirror options lock default + add-candidate horizon"
```

---

## Task 5: Bound the add-time picker (maximumDate)

**Files:**
- Modify: `apps/mobile/src/ui/DateTimeField.types.ts`
- Modify: `apps/mobile/src/ui/DateTimeField.tsx`
- Modify: `apps/mobile/src/ui/DateTimeField.web.tsx`
- Modify: `apps/mobile/src/ui/DateTimePill.tsx`
- Modify: `apps/mobile/src/screens/EventDetail.tsx`

- [ ] **Step 1: Add `maximumDate` to the prop type**

In `apps/mobile/src/ui/DateTimeField.types.ts`, after the `minimumDate?: Date;` line add:

```ts
  maximumDate?: Date; // date mode only
```

- [ ] **Step 2: Thread it through the native picker**

In `apps/mobile/src/ui/DateTimeField.tsx`:
- In the destructured props (near line 86, alongside `minimumDate,`) add `maximumDate,`.
- In the imperative Android call (near line 110, next to `minimumDate: mode === "date" ? minimumDate : undefined,`) add:

```ts
        maximumDate: mode === "date" ? maximumDate : undefined,
```

- In the iOS `<DateTimePicker .../>` (near line 199, next to `minimumDate={...}`) add:

```tsx
              maximumDate={mode === "date" ? maximumDate : undefined}
```

- [ ] **Step 3: Thread it through the web picker**

In `apps/mobile/src/ui/DateTimeField.web.tsx`:
- Add `maximumDate,` to the destructured props (next to `minimumDate,`, near line 23).
- Add a `max` attribute to the date `<input>` mirroring the existing `min` (near lines 29-30). Find the `min={...}` expression on the date input and add directly after it:

```tsx
        max={
          isDate && maximumDate
            ? `${maximumDate.getFullYear()}-${pad(maximumDate.getMonth() + 1)}-${pad(maximumDate.getDate())}`
            : undefined
        }
```

- [ ] **Step 4: Thread it through the pill**

In `apps/mobile/src/ui/DateTimePill.tsx`:
- Add `maximumDate,` to the destructured params (next to `minimumDate,`, line 15) and `maximumDate?: Date;` to the param type (next to line 23).
- On the date `<DateTimeField>` (line 41-48), add after `minimumDate={minimumDate}`:

```tsx
            maximumDate={maximumDate}
```

- [ ] **Step 5: Pass bounds from the collecting add-time UI**

In `apps/mobile/src/screens/EventDetail.tsx`, inside `CollectingView` (which already has `data`), add near the other derived values (after line 565, `const newIso = isoFrom(newDate, newTime);`):

```ts
  const candTimes = data.candidates.map((c: Cand) => new Date(c.startsAt).getTime());
  const lockMs = data.lockAt ? new Date(data.lockAt).getTime() : Date.now();
  const addMin = new Date(Math.max(Date.now(), lockMs));
  const addMax = new Date(
    addCandidateHorizon(Math.min(...candTimes), Math.max(...candTimes), data.whenMode === "fuzzy"),
  );
```

Add the import at the top of `EventDetail.tsx` (with the other `../lib/...` imports):

```ts
import { addCandidateHorizon } from "../lib/lock";
```

Then update the `<DateTimePill .../>` in the add-time card (lines 660-666) to replace `minimumDate={new Date()}` with:

```tsx
            minimumDate={addMin}
            maximumDate={addMax}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/src/ui/DateTimeField.types.ts apps/mobile/src/ui/DateTimeField.tsx apps/mobile/src/ui/DateTimeField.web.tsx apps/mobile/src/ui/DateTimePill.tsx apps/mobile/src/screens/EventDetail.tsx
git commit -m "feat(mobile): bound the add-time picker to the plan's window"
```

---

## Task 6: Remove the deprecated `defaultLockAt`

**Files:**
- Modify: `packages/shared/src/logic/lock.ts`
- Modify: `packages/shared/src/logic/lock.test.ts`

- [ ] **Step 1: Confirm there are no remaining call sites**

Run: `grep -rn "defaultLockAt\b" apps packages --include=*.ts --include=*.tsx | grep -v "defaultLockAtForOptions\|defaultLockAtForWindow"`
Expected: only matches inside `lock.ts`/`lock.test.ts` (the function definition and its test block). If any other file matches, migrate it (options call site -> `defaultLockAtForOptions`, window/float call site -> `defaultLockAtForWindow`) before continuing.

- [ ] **Step 2: Delete the function and its test block**

- In `packages/shared/src/logic/lock.ts`, delete the entire `export function defaultLockAt(...) { ... }` block (the original helper).
- In `packages/shared/src/logic/lock.test.ts`, delete the `describe("defaultLockAt", () => { ... })` block and remove `defaultLockAt,` from the import added in Task 1.

- [ ] **Step 3: Run the full shared suite**

Run: `pnpm --filter @bethere/shared test`
Expected: PASS (only the new helper blocks remain).

- [ ] **Step 4: Full verification across the workspace**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: all PASS. (`pnpm lint` enforces the no-em-dashes / Biome rules; `pnpm typecheck` covers all three packages.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/logic/lock.ts packages/shared/src/logic/lock.test.ts
git commit -m "refactor(shared): drop the superseded defaultLockAt helper"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** two-anchor default (Task 1/2/3), creator override bounds tightened (Task 2), bounded additions server-side (Task 2) + picker (Task 5), mobile default mirror (Task 4), float call sites (Task 2 settleFloating, Task 3 tipAt). Moment-duration is explicitly out of scope per the spec.
- **Type consistency:** `defaultLockAtForOptions(earliestMs, nowMs, momentMs?)`, `defaultLockAtForWindow(lastSlotMs, nowMs, momentMs?)`, `addCandidateHorizon(earliestMs, latestMs, isFuzzy)` are used with these exact signatures in every task and on both sides (shared + mobile mirror).
- **Greenness:** Task 1 adds without removing; the old `defaultLockAt` is only deleted in Task 6 after every call site is migrated and verified by the Step 1 grep.
