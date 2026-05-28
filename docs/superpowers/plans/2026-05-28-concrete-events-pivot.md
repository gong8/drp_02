# Plan: pivot BeThere to a concrete-event RSVP app (M2)

**Date:** 2026-05-28
**Status:** Draft for approval. No code yet.
**Authoritative design:** `docs/mockups/m2/ALL_MOCKUPS.pdf` (30 pages).
**Supersedes:** the loose-availability product-design spec (paused, archived for a later iteration) and the earlier `match-app-to-m2-mockups` plan.

## Decisions (locked with the user)

- Pivot from loose-availability / auto-match / blind-moment to **concrete events**: the creator sets a specific date, time and place; members RSVP. The loose model is archived to restore next iteration.
- **Two-tab bottom nav:** Meetups (dashboard) + Groups (full CRUD).
- Conditional response stays **people-only**: pick people + (at least one of / all of) + "are going". No change-time or free-text conditions yet.
- At the respond-by deadline: **resolve conditionals; the event always happens** (no quorum / cancel).
- **"Who's going" lists only the people going** (not a privacy guarantee, just that listing non-going is uninteresting).
- Create form is **text only**: title, description, date, time, free-text location. No photo upload or map yet; user/group avatars are generated from initials + colour.
- Archive the loose code by **moving it into an in-repo `archive/` folder** kept out of the build.
- Defaults: add group members by picking from the seeded users; notifications simulated in-app (no real push yet); "Suggest a Meet" opens the Create form.

## Step 0 - Archive the loose implementation

Commit/tag first, then move into `archive/loose-availability/` (excluded from tsconfig + biome + build):

- mobile: `Availability.tsx`, `Floating.tsx`, `Suggest.tsx` (chip/window version)
- api: `routers/availability.ts`, `routers/suggestions.ts`; the matching / auto-fire logic in `services/bethere.ts`
- shared: `logic/matching.ts`, `logic/time.ts`, `logic/quorum.ts`; `CreateSuggestionInput`, `DropAvailabilityInput`, `Slot`

**Reuse (do NOT archive):** `logic/resolve.ts` (the conditional fixpoint is identical), the response + conditional UI (from `TheMoment.tsx`), the who's-going list (from `Reveal.tsx`), the theme tokens, and the tRPC plumbing.

## Data model (Drizzle)

- `users` (keep): id, name, avatarColor.
- `groups` (keep): id, name. Avatar generated from id.
- `groupMembers` (keep): groupId, userId.
- `events` (NEW): id, groupId, createdByUserId, title, description (nullable), location (text), startsAt (timestamp), respondByAt (timestamp), status enum(open | resolved), createdAt. Title is free text (drop the activity enum).
- `responses` (repurpose to point at eventId): id, eventId, userId, kind(yes | no | conditional), cond jsonb {mode, targetIds}.
- Archive the `suggestions`, `availability`, `moments`, `plans` tables (replaced by `events` + `responses`).

## Per-user event status (drives the dashboard)

- **Declined:** my response is "no".
- **Going:** my response is "yes", or my conditional resolved to going (after the deadline).
- **Awaiting Your Response:** no response yet, or a pending conditional before the deadline (card shows "Pending Xh Ym").

## API (tRPC)

- `groups.mine` (extend with `members: {id,name,color}[]`), `groups.get({id})`, `groups.create({name})`, `groups.rename({id,name})`, `groups.addMember({groupId,userId})`, `groups.removeMember({groupId,userId})`.
- `users.addable({groupId})` -> seeded users not already in the group (for "Add to group").
- `events.create(CreateEventInput)`, `events.mine` -> dashboard rows {id, groupName, title, location, startsAt, respondByAt, myStatus, going[]}, `events.get({id})` -> detail + my response + members (for the picker) + going[] (if resolved) + msLeft, `events.respond({eventId, kind, cond?})`, `events.resolve({eventId})` (reuse `resolve.ts`; mark resolved; the event stays).
- Resolution trigger: lazily when `now > respondByAt` on read (same shape as the current resolve-on-buzzer), plus an explicit `resolve`.

## Shared

- New `CreateEventInput {groupId, title, description?, location, startsAt(ISO), respondByAt(ISO)}`. Reuse the `Conditional` + `RespondInput` shapes (retarget `momentId` -> `eventId`). Keep `resolve.ts`.

## Mobile

- Nav: introduce `@react-navigation` (bottom-tabs + native-stack) for two tabs that each push (Groups -> GroupDetail, Meetups -> EventDetail / CreateEvent). Alternative is a hand-rolled tab+stack; react-navigation is the pragmatic choice. **One implementation choice to confirm.**
- Screens:
  - **MeetupsDashboard** (tab): sections Awaiting Your Response / Going / Declined, date sub-headers within, event cards, "Suggest a Meet".
  - **EventDetail**: header (date, title, location, time), respond (I will make it / I won't make it / I will make it if...), conditional sheet (reuse), who's-going list (going only) once resolved.
  - **CreateEvent**: title, description, date, time, free-text location, Create.
  - **GroupsList** (tab): Your Groups rows (avatar + caret) -> GroupDetail.
  - **GroupDetail**: members (avatar + name), remove (x), "Add to group" (pick addable users), edit name; entry to create a group.
  - **CreateGroup**.
- Reuse theme tokens; generated avatars (initials + colour) for users and groups.

## Slices / sequence (thin slices, M3-friendly)

0. Archive loose code (+ tag).
1. DB + shared: `events` / `responses` tables, `CreateEventInput`, retarget responses; keep resolve.
2. API: `events.*` + groups CRUD + `users.addable`; update the seed.
3. Nav shell: bottom tabs (Meetups | Groups) + stacks.
4. Meetups dashboard + EventDetail (respond + conditional + who's-going) + resolve-on-read.
5. CreateEvent.
6. Groups tab: list + GroupDetail (members, add/remove, rename) + CreateGroup.
7. Polish + seed data matching the mockups (Bowling / The Boys / Climbing etc.) for the demo.

## Open / deferred (next iteration)

- The loose-availability model returns (un-archive).
- Real push via `expo-notifications` ("Results are in!"); in-app for now.
- Photo upload + map location picker.
- "Add yourself to other groups" / join-by-code / temporary meetups.
- Auth / multi-device; still a single seeded `ctx.userId` for the demo.
