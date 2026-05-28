# Plan: align the app to the M2 mockups (privacy-preserving)

**Date:** 2026-05-28
**Status:** Draft for review. No code yet.
**Mockups:** `docs/mockups/m2/screens/` (see that folder's `README.md` for the screen map).
**Companion:** product-design spec `docs/superpowers/specs/2026-05-28-bethere-product-design.md`.

## Decisions taken (these scope everything below)

1. **Spec wins over mockups on conflict.** Keep the privacy thesis: loose private availability, blind responses, no public "no". We honour the mockups only where they do not break this.
2. **Suggest stays the loose model.** Activity + loose-window chips and slot-matching stay. We do not adopt the concrete date/time/place create-form.

### What this rules OUT (mockup features we will NOT build)

- **Reveal "not going" rows** (`reveal-whos-going` red crosses). Showing decliners breaks privacy invariant 8.4. Reveal shows only the going crowd. (Already the case after the first pass.)
- **Concrete create-form** (`suggest-create` title/description/specific date+time/location map). Diverges from the loose-availability core. We keep chips and add only an optional free-text title (see Slice 3).
- These stay listed here so the crit answer is "deliberate, evidence-driven scoping", not an oversight.

## What we WILL build (thin slices, M3-friendly)

Ordered roughly easiest-first. Each slice is independently shippable and keeps the loop clickable.

---

### Slice 1 - Group roster + expandable rows  (`groups-a-list`, `groups-b-expanded`)
Mockup: group rows carry a coloured avatar and expand to show members; one group shows "Members (8)" + a list + a Confirm button.

- **Privacy:** group membership is explicitly not secret (see `moments.ts` comment, and `groups.mine` already exposes a count). Showing names/avatars is fine. No availability is touched.
- **shared:** none (types inferred).
- **api:** extend `groups.mine` to include `members: { id, name, color }[]` (join `groupMembers` -> `users`, use `users.avatarColor`). Cheap; it already loads the membership rows.
- **mobile (`Home.tsx`):** make each group row expand/collapse (caret like the mockup) to reveal member avatars + names. Keep the existing "active suggestion -> add availability" behaviour as the row's primary tap or as the expanded CTA.
- **Open decision:** what does the mockup's orange **Confirm** button do? Best guess: it is the "add your availability" CTA when the group has an active suggestion (hidden otherwise). Confirm before building.
- **Effort:** S.

### Slice 2 - Plans / Agenda view  (`home-a-plans`, `home-b-confirm-countdown`, `home-c-confirmed`)
Mockup: a dated agenda of your meets with status (GOING / confirm-within countdown), plus "Suggest a Meet".

- **Privacy:** this is YOUR own agenda - your firm plans and your one pending moment. Firm-plan rows show the IN crowd (allowed at reveal). No other user's availability or "no" is shown. Compatible.
- **api:** add `plans.mine` query -> every `plans` row where `ctx.userId` is in `confirmedParticipantIds`, returning `{ id, activity, place, finalTimeMs, groupName, people[] }`, sorted by `finalTime`. (The `plans` table already stores everything; today only `moments.plan` by id exists.)
- **mobile:** new `Agenda.tsx` screen:
  - Pending moment from the existing `moments.mine` rendered as a "Confirm within Xh Ym" card that taps into `TheMoment`.
  - Confirmed plans from `plans.mine`, grouped by date, each a card with activity, place, time, and a "Going" pill.
  - A simple **two-tab switch at the top: Groups | Plans** (Home stays the groups list; Plans is the agenda). Add a `{ name: "agenda" }` route to `App.tsx` (hand-rolled nav, one more entry).
- **Open decision:** tabs vs. making the agenda the default landing screen. Recommend tabs (keeps both mockup surfaces; smallest nav change).
- **Effort:** M (one new endpoint, one new screen, a tab toggle).

### Slice 3 - Optional title on Suggest  (`suggest-create`, loose model kept)
Mockup has a Title field. We adopt only the title (the rest is the concrete-event model we ruled out).

- **shared/api:** already done. `CreateSuggestionInput.text` is optional (max 80) and `suggestions.create` already stores `input.text`.
- **mobile (`Suggest.tsx`):** add an optional single-line "Title" `TextInput` above the chips; pass it as `text` in the `suggestions.create` call. Surface it on `Availability` (it already reads `suggestion.text`).
- **Effort:** XS (mobile-only).

### Slice 4 - Reveal header polish  (`reveal-whos-going`)
The "Who's going" list already matches. Mockup also has an activity + time + place header.

- **mobile (`Reveal.tsx`):** add a compact header line (activity headline + time, place) above the list, from the existing `moments.plan` fields (`activity`, `detail`, `place`). No backend change.
- **Effort:** XS.

### Slice 5 (optional) - Status colour tokens
Mockups use green/red/orange for status. Decision 1 keeps the flat one-accent brand, so by default we do NOT colour the moment buttons.

- If we want a touch of the mockup's status colour, add a **small set of semantic status tokens** to `theme.ts` (e.g. `going` = accent, `pending` = a muted amber) used ONLY for agenda status pills (functional status, not decorative). The three moment buttons stay one-accent.
- **Open decision:** allow the muted amber pending pill, or keep strictly one-accent? Recommend the muted pending pill (reads better on the agenda).
- **Effort:** XS.

### Deferred - Push notifications  (`notification-results`)
"Results are in!" is a push mock. Spec 12 already defers push to `expo-notifications`. Out of scope now; the in-app poll on focus already simulates it. Future milestone: register a device token and send only the four allowed signals (suggest / moment / linchpin / firm-plan reminder).

## Suggested order & Linear

Quick wins first: **3 -> 4 -> 1 -> 2 -> 5**. I will create a Linear issue per slice under `DRP_02` (children of, or related to, **DRP-17**) once this plan is approved.

## Open decisions to confirm before building

1. Group **Confirm** button semantics (Slice 1).
2. Agenda as a **tab** vs the default landing screen (Slice 2).
3. Allow a **muted amber "pending" pill** on the agenda, or stay strictly one-accent (Slice 5).
