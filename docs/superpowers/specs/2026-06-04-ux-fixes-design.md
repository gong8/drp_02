# UX fixes: create flow, editable meetups, typography, countdown

Date: 2026-06-04
Status: Approved (design), pending implementation plan
Area: `apps/mobile`, `apps/api`, `packages/shared`

## Background

Five UX complaints against the unified suggest flow, all on the core meetup
surfaces (CreateWizard, EventDetail, Dashboard):

1. The create wizard's "A few options" step is too large; the two lock toggles
   are stranded on it instead of next to the lists they lock.
2. Meetups cannot be edited after creation - no title, location, or notes edit
   path exists at all (no API mutation, no UI).
3. SpaceMono (a monospace "programmer" font) is used throughout where it breaks
   the theme - e.g. "4 on the table" renders in mono.
4. The green `DrainBar` countdown reads as an ambiguous percentage and buries
   the actual time left.
5. The time-remaining should be stated plainly and unmissably instead.

This spec covers all five as one cohesive pass. They share files and a theme.

## Goals

- Move the lock toggles to the steps they belong on.
- Let any group member edit a meetup's title, location, and notes after
  creation, safely under concurrent edits.
- Let creators optionally name a meetup at creation (still auto-derived if left
  blank).
- Remove SpaceMono entirely; keep typography in-theme.
- Replace the green bar with a prominent, plain-language time-left line.

## Non-goals (YAGNI)

- No realtime sync / push. Other members see edits on their next fetch/focus.
- No editing of votes or moment responses.
- No structural editing after creation (times, activities, locks, deadlines are
  not editable post-create in this pass - scope is text metadata only).
- No edit attribution or history (edits are anonymous, like everything else).

---

## Area A - Create flow

### A1. Move the lock toggles (relocation only)

Currently both lock `CheckRow`s live on the "options" step
(`CreateWizard.tsx:342-357`). Move them to the lists they govern:

- `Lock the times` -> bottom of the "When could it be?" step, after the
  `+ Add a time` chip (`CreateWizard.tsx` ~line 320).
- `Lock the activity` -> bottom of the "What do you fancy?" step, after the
  Add-an-activity `Field` (~line 290).

State (`lockTimes`, `lockThings`) stays in the parent component; this is a pure
JSX relocation. The `CheckRow` component and its disabled "Add a time first" /
"Add an activity first" copy move with it - and now the disabled hint sits right
next to the empty list, so it reads naturally. The `isConcrete` /
`planOpensMoment` logic is unaffected (it reads the same state).

Per the chosen scope, the "options" step is otherwise left as-is (Location,
Notes, Decides-by card, Reply-by card). It is shorter by two rows. We are not
restructuring it in this pass.

### A2. Optional title at create

Add an optional `Title` field to the create flow (the title is currently never
set - `const title = ""`, `CreateWizard.tsx:36`).

- Render a `Field` labelled "Title" (optional) grouped with the other optional
  text metadata on the "options" step, above Location. (Same cluster the edit
  sheet shows: Title, Location, Notes.)
- Replace `const title = ""` with `const [title, setTitle] = useState("")`.
- `submit()` already sends `title: title.trim() || undefined`; behavior is
  unchanged when left blank (server stores `""` and auto-derives at lock via
  `resolveTitle`).
- No server change: `CreateEventInput.title` already exists
  (`schemas.ts:52`, `z.string().max(80).optional()`).

---

## Area B - Editable meetup metadata (the concurrency-sensitive one)

Any group member can edit a meetup's `title`, `location`, and `description`
(Notes) while the plan is not yet `cleared`/`fizzled`. Edits are anonymous.

### B1. Title-derive interaction (must preserve)

A collecting plan usually stores `title = ""` and `get` returns the *derived*
`displayTitle` (the leading activity, or "An activity"). The raw stored title is
what controls auto-derive:

- Empty raw title -> `resolveTitle` keeps deriving from the winning activity at
  lock.
- Non-empty raw title -> kept as-is through lock.

Therefore:

- `get` must additionally return `titleRaw: e.title` (the raw stored string).
  The existing derived `title` field stays for display.
- The edit sheet prefills the Title input from `titleRaw` (often empty), and
  shows the current derived title as the input's *placeholder* (so the user sees
  "An activity" / "Bowling" greyed-out, and an empty field means "let it keep
  auto-naming").
- Saving an empty title writes `""` (reverts to auto-derive); saving text writes
  an override.

`location` and `description` are already returned raw by `get`
(`location: e.location`, `description: e.description`), so they need nothing
extra.

### B2. Authorization and phase gate

- Authorization: any member of the event's group. Reuse `loadEvent(eventId,
  userId)` (events.ts:255), which 404s a missing event and `requireMember`s the
  caller. No creator check (deliberately - "anyone can edit").
- Phase gate: reject when `phase` is `cleared` or `fizzled` (the plan is final).
  Allowed in `collecting` and `moment`.

### B3. Concurrency model - per-field compare-and-set (CAS)

Because anyone can edit, two members can edit the same plan at once. We must not
silently clobber a write, and independent fields must not falsely collide.

Mechanism (no schema migration; field values are the concurrency token):

- The client sends, for each field it changed, a `{ from, to }` pair: `from` is
  the value it loaded (for title: `titleRaw`), `to` is the new value.
- The server runs one transaction:
  1. `SELECT ... FOR UPDATE` the event row (serializes concurrent updates -
     eliminates read-modify-write races).
  2. Phase gate (see B2).
  3. For each provided field, compare the current DB value to `from`:
     - equal -> stage `to` into the `SET`.
     - not equal -> record a conflict `{ field, current }`; do not write it.
  4. Apply the `SET` for non-conflicting fields (if any).
  5. Return `{ applied: string[], conflicts: { field, current }[] }`.

Properties this gives us:

- **No lost updates.** Same-field concurrent edits: first wins; the second gets
  a conflict carrying the now-current value instead of overwriting it.
- **No false conflicts.** Different-field edits (A: location, B: title) each CAS
  only their own field, so both succeed.
- **Title-derive race is covered.** If lock derives the title (`"" -> "Bowling"`)
  while a member is editing, the member's CAS (`from: ""`) fails against
  `"Bowling"` and they are shown it; if the member's edit lands first, lock sees
  a non-empty title and skips. Either ordering converges.
- **No new column.** We considered an `updatedAt`/`rev` token; there is no
  `updatedAt` on `events`, and per-field CAS is both migration-free and more
  precise (field-level rather than row-level conflicts).

### B4. Client behavior (edit sheet)

- An "Edit details" affordance on `EventDetail` near the title, visible to all
  members while the plan is not `cleared`/`fizzled`.
- Opening it loads current values (the screen already has `get` data; the sheet
  reads `titleRaw`, `location`, `description` from it).
- On Save: call `events.update` with `{ from, to }` for changed fields.
  - Full success (`conflicts` empty): close; optimistically reflect locally; the
    next `get`/`mine` fetch confirms.
  - Any conflict: keep the sheet open, replace the conflicted field(s) with the
    server's `current` value, and surface a quiet inline note ("Updated by
    someone else - check the new value"). The user re-decides and can re-save.
- Reuse the existing `BottomSheet` component (`apps/mobile/src/ui/BottomSheet.tsx`).

### B5. Schema and API additions

`packages/shared/src/schemas.ts`:

```ts
// One editable text field's optimistic compare-and-set: `from` is the value the
// client loaded, `to` is the new value. Server writes `to` only if current == from.
export const FieldEdit = z.object({ from: z.string(), to: z.string() });

// Network boundary for events.update - any member edits a plan's text metadata
// (title/location/notes) before it is cleared. Each field is an optional CAS;
// omitted fields are untouched. Anonymous, like every other write.
export const UpdateEventInput = ByEvent.extend({
  title: FieldEdit.optional(),
  location: FieldEdit.optional(),
  description: FieldEdit.optional(),
});
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;
```

(`to` validation mirrors create: title/location `.max`, description `.max(500)`.
Title and location/notes allow empty `to` - empty title reverts to auto-derive,
empty location/notes clears them. `location` column is `notNull`, so an empty
`to` writes `""`, not null.)

`apps/api/src/routers/events.ts` - new `update` mutation:

```ts
update: protectedProcedure.input(UpdateEventInput).mutation(async ({ ctx, input }) => {
  return db.transaction(async (tx) => {
    // load + lock the row, assert membership, phase-gate
    // per-field CAS against the locked row; build SET of applied fields
    // return { applied, conflicts }
  });
});
```

Implementation notes:
- Use `loadEvent`-equivalent logic inside the transaction (select `FOR UPDATE`,
  then `requireMember`). `loadEvent` itself does not lock; the mutation needs the
  `FOR UPDATE` select, so it will inline the fetch on `tx` and call
  `requireMember`.
- Settle is not run here (edit is independent of lifecycle), but the phase read
  is the freshly-locked row's phase.

---

## Area C - Typography (remove SpaceMono)

`font.mono = "SpaceMono_700Bold"` (`theme.ts:26`) is the culprit. Replace every
use, then drop `mono` from the theme and stop loading the font in `App.tsx`.

| Usage | File | New |
| --- | --- | --- |
| "N on the table" + slot labels | `ui/DateChip.tsx` | `font.bold` + tabular-nums |
| Sticker labels | `ui/StickerTag.tsx` | `font.display` |
| Dashboard countdown + spec line | `screens/Dashboard.tsx` | `font.bold` + tabular-nums |
| Hero clock (34px) | `screens/EventDetail.tsx` | `font.display` |
| Day header / AM-PM | `screens/EventDetail.tsx` | `font.bold` |
| Option count badge | `screens/EventDetail.tsx` | `font.bold` + tabular-nums |

- `tabular-nums` (`style={{ fontVariant: ["tabular-nums"] }}`) keeps digit width
  fixed so live countdowns/counts do not jiggle - the one good property mono had.
- After all references are gone: remove `mono` from `font` in `theme.ts`, remove
  the `SpaceMono_700Bold` import and `useFonts` entry in `App.tsx`, and remove
  the dependency if nothing else uses it.
- Hero clock defaults to Archivo `font.display`; if it reads too heavy we can try
  `font.bold` instead (a one-line change). Call this out for visual confirm.

## Area D - Countdown (scrap the bar, state the time)

The green bar is `DrainBar` (`ui/DrainBar.tsx`), used only on the Dashboard
action cards. Remove it; replace with a plain, prominent line.

- New formatter in `apps/mobile/src/lib/format.ts`, e.g. `formatTimeLeft(ms)`:
  - `> 1 day`  -> `"2 days left"` / `"1 day left"`
  - `>= 1 hour` -> `"5 hours left"` / `"1 hour left"`
  - `>= 1 min`  -> `"23 minutes left"` / `"1 minute left"`
  - `<= 0`      -> `"Closing now"`
  - (Keep the existing terse `formatCountdown` if still used elsewhere; this is a
    separate verbose helper.)
- Action card copy is phase-aware and states what closes:
  - collecting -> `"Voting closes in 2 days"`
  - moment -> `"RSVP closes in 5 hours"`
  (Compose: `${label} in ${...}` where the helper returns the bare duration, or a
  small phase-aware wrapper. Final wording can be tuned in review.)
- Urgency: the line turns `ui.brand` (pink) under a fixed threshold (under 1
  hour), `ui.ink` otherwise. No percentage, no fill.
- Remove `DrainBar` import + usage from `Dashboard.tsx` and delete
  `ui/DrainBar.tsx`; remove `remainingFrac` and the `frac`/`hot` plumbing on the
  action card.
- `EventDetail`'s `CountdownBanner` adopts the same verbose phrasing for
  consistency (it already shows text, not a bar).

---

## Change inventory

API / shared:
- `packages/shared/src/schemas.ts` - add `FieldEdit`, `UpdateEventInput`.
- `apps/api/src/routers/events.ts` - add `update` mutation (transactional CAS);
  add `titleRaw` to the `get` response.

Mobile:
- `screens/CreateWizard.tsx` - move both `CheckRow`s; add optional Title field +
  `title` state.
- `screens/EventDetail.tsx` - Edit affordance + edit bottom sheet; verbose
  countdown banner; mono -> display/bold.
- `screens/Dashboard.tsx` - remove `DrainBar`/`remainingFrac`; verbose time-left
  line; mono -> bold + tabular-nums.
- `ui/DateChip.tsx`, `ui/StickerTag.tsx` - mono -> bold/display.
- `ui/DrainBar.tsx` - delete.
- `lib/format.ts` - add `formatTimeLeft` (verbose).
- `theme.ts` - remove `font.mono`.
- `App.tsx` - stop loading `SpaceMono_700Bold`.

## Testing

- `packages/shared`: `UpdateEventInput` parses; rejects oversize `to`.
- `apps/api`: unit/integration on `events.update`:
  - applies a single field; leaves others untouched.
  - non-member -> FORBIDDEN; missing event -> NOT_FOUND.
  - `cleared`/`fizzled` -> rejected.
  - CAS conflict: stale `from` -> field reported in `conflicts`, value unchanged.
  - different-field concurrent edits both apply (no false conflict).
  - empty title `to` reverts to auto-derive at a subsequent lock; non-empty title
    survives lock.
- Mobile: lint + typecheck; manual pass on edit sheet (happy path + simulated
  conflict), create flow lock placement, font render, countdown copy.
- Run `pnpm lint`, `pnpm typecheck`, and per-package tests before the PR
  (aggregate `pnpm test` hangs on mobile jest - run per package, then
  `pkill -f jest`).

## Risks / race conditions (enumerated)

- R1 same-field concurrent edit -> CAS: second writer conflicts, no clobber.
- R2 different-field concurrent edit -> row lock serializes, both apply.
- R3 edit vs auto-lock title-derive -> CAS `from: ""` reconciles either ordering.
- R4 edit vs settle to `cleared`/`fizzled` -> phase gate rejects; client refetch
  shows final state.
- R5 optimistic client value diverging from server -> reconcile on the `update`
  response (and next `get`).

## Open visual confirm (non-blocking)

- Hero clock in Archivo `font.display` vs `font.bold`.
- Final countdown wording ("Voting closes in X" vs alternatives).
