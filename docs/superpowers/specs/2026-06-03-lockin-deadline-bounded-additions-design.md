# Lock-in deadline + bounded additions for flexible plans

Date: 2026-06-03
Status: Approved (design), pending implementation plan

## Context

In the convergence model, a non-exact plan (`options` or `fuzzy`) collects reactions until a
deadline (`events.lockAt`), then `settleCollecting` auto-locks the best-supported candidate and opens
the blind moment. Any group member can also add candidate times during `collecting` via
`events.addCandidate`.

Two problems exist today:

1. **`lockAt` is stored as a fixed wall-clock instant, but its real meaning is "shortly before the
   event."** It is computed once at creation from the *earliest* candidate (`defaultLockAt`, "the day
   before") and never recomputed. The instant only stays meaningful if the candidate set never
   changes and the earliest candidate wins. It is the source of the "does it all make sense" doubt.

2. **`addCandidate` has only a lower bound** (`startsAt > lockAt`, `events.ts:500`) and no upper
   bound, so a member can add an absurd far-future time that is still in the running and can win,
   firing the lock long before the chosen event.

A quieter third issue: the default deadline `earliest - 1 day` is naive for **fuzzy** windows.
`expandWindow` always emits a slot for tomorrow (sometimes today), so the earliest is ~always "soon"
even for a "next two weeks" window. "1 day before the earliest" would lock tonight after a near-zero
react window (the squeeze).

## Decisions (from brainstorming)

- The deadline is **fixed once set** (never recomputed after creation). The creator may override the
  default at create time; whatever is stored is final. This is the existing override path
  (`CreateWizard.startEditLock` -> `lockToSend` -> `input.lockAt`), kept.
- Added times are **bounded to the plan's window/horizon**, enforced server-side and surfaced in the
  picker so out-of-range times cannot be chosen (no rejection-after-the-fact).
- The *default* deadline must be smart and anchored differently per mode (see below).

## Goals

- A default deadline that is sensible across timescales (tonight -> hours; far out -> capped lead),
  for both anchoring meanings (a real proposed time vs a loose window).
- Added candidate times bounded to the plan's window/horizon, visible in the picker.
- No surprises: the deadline never moves once set.

## Non-goals (out of scope)

- **Moment duration relative to the event.** The blind moment opens at `lockAt` and runs ~1h
  (`momentEnd = min(lock + moment, chosen)`) regardless of how far the event is, so on a far plan the
  moment can fire well before the event. That is a moment-duration question, tracked separately.
- Editing or removing existing candidates.
- Float internal vote/reconcile logic.

## Design

### 1. Default deadline: two anchors

Replace the single `defaultLockAt(earliestMs, nowMs, momentMs, leadMs)` with two intent-named
helpers in `packages/shared/src/logic/lock.ts`. Both return an epoch-ms instant strictly in
`(now, anchor)`.

Constants:

```
MOMENT_MS   = 60 * 60 * 1000      // existing DEFAULT_MOMENT_MINUTES; minimum notice
DAY_MS      = 24 * MOMENT_MS      // lead cap (creator's "1 day")
MIN_REACT_MS = 2 * MOMENT_MS      // 2h: a real reacting window for fuzzy
MAX_REACT_MS = 3 * DAY_MS         // 3 days: cap fuzzy collecting so momentum is not lost
```

**Options / exact-N anchor (a deliberate proposed time):**

```
defaultLockAtForOptions(earliestMs, nowMs, momentMs = MOMENT_MS):
  T    = earliestMs - nowMs
  lead = clamp(round(T / 3), momentMs, DAY_MS)   // notice window
  ideal = earliestMs - lead
  if (ideal > nowMs) return ideal
  // degenerate near-term (T < lead): fall back to midpoint, clamped under earliest - moment
  latest   = earliestMs - momentMs
  midpoint = nowMs + T / 2
  return round(latest > nowMs ? min(midpoint, latest) : midpoint)
```

The `/3` gives the **react** phase the larger share (reacting is the active part; notice only needs
to be "enough"). Lead caps at one day. Behaviour:

| Soonest option | T | Lead (notice) | React window |
|---|---|---|---|
| ~4h (tonight) | 4h | ~1.3h | ~2.7h |
| tomorrow | 24h | 8h | 16h |
| 2 days | 48h | 16h | 32h |
| 3+ days | 72h+ | 24h (capped) | rest |

This generalizes the current helper: a fixed `leadMs = DAY` becomes the adaptive
`clamp(T/3, moment, DAY)`. The degenerate-case branch is the same midpoint clamp used today.

**Fuzzy window anchor (a loose window, not a single time):**

```
defaultLockAtForWindow(lastSlotMs, nowMs, momentMs = MOMENT_MS):
  span  = lastSlotMs - nowMs
  react = clamp(round(span / 3), MIN_REACT_MS, MAX_REACT_MS)
  latest = lastSlotMs - momentMs                 // leave moment room before the last day
  lockAt = min(nowMs + react, latest)
  if (lockAt > nowMs) return round(lockAt)
  return round(nowMs + span / 2)                 // degenerate: window within one moment
```

Anchoring the react window to the **window span** (not to the soon earliest slot) fixes the squeeze
and the long-drag:

| Window | span | React then lock | Effect |
|---|---|---|---|
| tonight | ~4h | ~1.3h | resolves fast |
| this week | 7d | ~2.3d | decide mid-week among remaining days |
| next two weeks | 14d | 3d (capped) | decide in 3 days, not drag 13 |

At lock, `settleCollecting` already picks the best-supported candidate; early window days that have
passed simply have no reactions and are not chosen.

### 2. Wiring the defaults

- `apps/api/src/routers/events.ts` `create`: when no `input.lockAt`, branch on `when.mode`:
  - `options` -> `defaultLockAtForOptions(earliestMs, now)`
  - `fuzzy`   -> `defaultLockAtForWindow(lastSlotMs, now)` where `lastSlotMs = cands[cands.length-1]`
- `apps/api/src/routers/events.ts` `settleFloating` crystallization (currently `defaultLockAt(slots[0], ...)`,
  ~`events.ts:243`): use `defaultLockAtForWindow(slots[slots.length-1], now)` since a float is a window.
- `apps/api/src/routers/floats.ts` `tipAt` default (float deadline): use
  `defaultLockAtForWindow(lastSlotMs, now)` (the latest window slot) consistent with floats being
  windows. Today it uses `defaultLockAt(earliestMs, ...)`.
- `apps/mobile/src/lib/lock.ts`: mirror `defaultLockAtForOptions` (the create wizard's flexible path
  sends `options`, `CreateWizard.tsx:163`). The window variant is server-only and need not be
  mirrored. Keep the "in sync with shared" note.

### 3. Creator override bounds (create time)

`events.create` already accepts `input.lockAt`. Tighten its validation from the current
`now < t <= earliest` to:

- options: `now < t <= earliest - MOMENT_MS` (leave moment room).
- fuzzy:   `now < t <= lastSlot - MOMENT_MS`.

`CreateWizard` already has the override UI (`startEditLock`, `lockDate`/`lockTime`, `lockInvalid`).
Feed it the new default and the tightened upper bound. No schema change.

### 4. Bounded additions

In `events.addCandidate` (`events.ts:487`), after the existing `> lockAt` lower-bound check, add an
upper bound computed from the plan's current candidates:

```
span    = latestExisting - earliestExisting
slack   = whenMode === "options" ? min(span, 2 * DAY_MS) : 0   // fuzzy: hard window end
horizon = latestExisting + slack
if (startsAt.getTime() > horizon) -> BAD_REQUEST "that time is past this plan's window"
```

- fuzzy: `slack = 0`, so additions stay inside the expanded window (its last day).
- options: a small slack lets a member suggest a time slightly later than the creator's spread,
  without allowing an absurd far-future jump. `slack` is the one tunable here.

No change to `AddCandidateInput`; the bound is server-enforced.

### 5. Picker UX (self-evident bounds)

In `EventDetail` (`addCandidate`, `events.ts`/`EventDetail.tsx:190`), derive the addable range on the
client from data already returned (`lockAt` + candidates):

- `minimumDate = new Date(lockAt)` (lower bound; already the server rule)
- `maximumDate = new Date(horizon)` (same formula as the server)

Pass these to the add-time `DateTimePicker` (`DateTimeField.tsx` supports min/max) so out-of-range
times cannot be selected. The deadline countdown already shows in the collecting view
(`EventDetail.tsx:259/288`, "Reacting closes ...") - keep it.

## Affected files

- `packages/shared/src/logic/lock.ts` - replace `defaultLockAt` with the two helpers + constants.
- `apps/api/src/routers/events.ts` - `create` default branch, override bounds, `addCandidate` upper
  bound, `settleFloating` crystallization call site.
- `apps/api/src/routers/floats.ts` - `tipAt` default call site.
- `apps/mobile/src/lib/lock.ts` - mirror `defaultLockAtForOptions`.
- `apps/mobile/src/screens/CreateWizard.tsx` - feed new default + tightened bound.
- `apps/mobile/src/screens/EventDetail.tsx` (+ `ui/DateTimeField.tsx` if needed) - min/max on the
  add-time picker.

## Edge cases

- Very near-term options (`T < lead`): degenerate midpoint branch keeps `now < lockAt < earliest`.
- Window entirely within one moment: degenerate midpoint branch.
- Adding a duplicate timestamp: existing dedup returns the existing id (unchanged).
- Override exactly at a bound: `<=` upper bound permits the boundary minus moment; `>` lower bound
  excludes equality with `lockAt` (unchanged).

## Testing

- Unit tests (`packages/shared`) for `defaultLockAtForOptions` and `defaultLockAtForWindow` covering
  the table rows (tonight / tomorrow / 2d / 3d / 2wk), asserting `now < result < anchor`, the
  1-day lead cap, and the 3-day react cap.
- API tests for `addCandidate`: reject below `lockAt`, reject above horizon, accept in-range; fuzzy
  vs options horizon difference.
- Update any existing tests that call `defaultLockAt` to the new helpers.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` green before PR.
