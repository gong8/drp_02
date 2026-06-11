# +1 trust controls: joins lock, brought-by attribution, Who's-in roster (DRP-63)

**Date:** 2026-06-11 | **Linear:** DRP-63 | **Driver:** Nathan M4 interview
(`docs/drp-context/interviews/m4 interviews/nathan interview.md`)

## Problem

The DRP-56/62 meetup share link admits anyone holding it as an ad-hoc participant, and a +1 can
re-share the link, so chains are unbounded ("I can imagine a group really expanding"). Nathan's
interview surfaced three asks:

1. **Control** - "adding +1s has to be a controlled thing" (though his real-life protocol is
   awareness, not approval votes).
2. **Awareness with a timing edge** - "between when I vote and when the votes are tallied, someone
   else gets invited"; the failure mode is showing up and a stranger is there.
3. **Recognition** - "this person has been to an event with you" (explicitly DEFERRED to a later
   iteration; biggest build of the bundle).

Side findings, no action: he was skeptical of multi-group meetups but his fallback ("I'd just make
a new group with everyone") is exactly `groups.createFromEvent`; the hidden-members-before-join
design is "fine how it is".

## Scope (iteration 5)

Three slices: **joins lock**, **brought-by attribution**, **Who's-in roster sheet**.
Out of scope: met-before signal, notifications (push needs the dev-build migration off Expo Go),
per-link revocation, any change to the vote engine or OG cards.

## Decisions (settled in brainstorming)

- **Lock shape:** the creator picks the door state at suggestion AND whether it is locked. Locked =
  frozen for everyone forever (consistent with `lockTimes`/`lockActivity`); unlocked = any group
  member can toggle the door later. No creator-privileged runtime action exists.
- **Toggle constituency:** group members (origin or attached), NOT ad-hoc participants. A +1 must
  not reopen a door the group closed; that would recreate the expansion problem.
- **Attribution mechanism:** Approach 1, a per-sharer `?via=<userId>` query param on the minted
  link, validated against the live roster at join time and stored. A per-sharer token table was
  rejected: forwarding semantics are identical (a forwarded link attributes to its minter either
  way, which is correct - "joined via Leo's link"), so the table only buys spoof-resistance, and
  this is a trust signal, not a security boundary. The lock is the enforced control. Hand-edited
  or stale `via` degrades to null attribution, never an error.
- **Bearer-link reality:** "only members can re-share" is unenforceable (a URL is text); the only
  real gate is `joinByToken`, so the lock lives there.
- **Roster UI:** the full "Who's in" sheet (user chose over a +1s-only section): origin group,
  attached groups, then +1s with attribution. Presence is not a vote; vote anonymity and creator
  anonymity are untouched.
- **"New" badge baseline:** client-side per-event seen marker ("new since you last looked"),
  set when the sheet is opened. Chosen over a server-side "since you responded" comparison because
  `candidate_reactions`/`responses` carry no timestamps; adding them is churn for a weaker
  semantic (viewing happens at or after voting). Limitation: the marker is device-local
  (localStorage on web; in-memory on native, so native badges reset per launch). Acceptable.
- **Naming:** `joins*`, not `plusOne*` - "+1" already means a candidate vote in this codebase.
  UI copy may still say "+1s".

## Data model

`events` gains (mirroring the `lock_times`/`lock_activity` pair):

- `joins_open` boolean NOT NULL DEFAULT true - the door. Existing plans stay open (today's
  behavior, byte-for-byte).
- `lock_joins` boolean NOT NULL DEFAULT false - set at suggestion, never changeable; true freezes
  `joins_open` for everyone.

`event_participants` gains:

- `invited_by` text NULL REFERENCES users(id) - who minted the link this +1 redeemed; null for
  legacy joins or invalid via (rendered as a plain "+1").
- `joined_at` timestamp NOT NULL DEFAULT now() - backfilled to migration time for existing rows.

Migration `0012_plus_one_trust_controls.sql`, hand-authored + journal entry (idx 12).

Shared Zod: `CreateEventInput` grows `joinsOpen: z.boolean().optional().default(true)` and
`lockJoins: z.boolean().optional().default(false)` next to the existing lock flags.

## API surface (`apps/api/src/routers/events.ts`)

- `create` - persists both flags.
- `shareLink` - appends `?via=<callerUserId>` to the minted URL; also returns `via` so the client
  fallback URL builder can append it. Token unchanged; every existing link keeps working.
- `joinByToken` - input gains optional `via`. Order: (1) already in roster -> no-op success exactly
  as today, so existing people reopen their link even when closed (the door blocks NEW people
  only); (2) `joinsOpen === false` -> FORBIDDEN with friendly copy; (3) insert participant with
  `invitedBy = via` only if that user is currently in the roster, else null.
- `previewByToken` - additionally returns `joinsOpen` (a boolean, leaks no identity) so the
  logged-out web landing shows "closed" before sign-in.
- NEW `events.roster` (protected, roster-gated via `loadEvent`) - the Who's-in payload: origin
  group then attached groups (id, name, member cards via the `getUserCards` batch), then
  participants `{id, name, invitedBy: card | null, joinedAt}` sorted by joinedAt; plus
  `joinsOpen`, `lockJoins`, `canToggle` (caller is a group member AND not lockJoins). A
  participant who later joined a constituent group appears in the group section only (filtered
  from the +1 list server-side).
- NEW `events.setJoinsOpen` (protected) - flips the door. Rejected when `lockJoins`; restricted to
  group members (origin or attached), participants get FORBIDDEN. Last-write-wins boolean (no CAS;
  unlike `events.update` text fields, a boolean toggle has no meaningful conflict).

Vote engine, settle, OG card functions: untouched.

## Mobile (`apps/mobile`)

- **Create wizard:** a third lock row alongside times/activity: "Open to +1s" switch (default on)
  plus a "Lock" control (lockJoins), following the existing lock-row idiom; both sent on create.
- **EventDetail:** a "Who's in" row (count + "N new" pill) opening a Who's-in BottomSheet
  (idiom: `MakeGroupSheet`): group sections, then a "+1s" section of PersonRows with
  "via <name>'s link" subtitles and NEW badges; sheet header shows the door state with the toggle
  when `canToggle`, or a "fixed when the plan was suggested" note when `lockJoins`.
- **Seen marker:** `lib/rosterSeen.ts`, pure + unit-tested, webStore-style storage; rule: no
  marker stored = treat all as seen and set the marker on first open (avoids all-new noise on
  migration-backfilled rows); badge = `joinedAt > marker`; opening the sheet advances the marker.
- **Share funnel (web):** link parsing preserves `via` (today `extractMeetupToken` strips the
  query); the pending-meetup stash becomes `{token, via}` JSON with back-compat parsing of a bare
  stashed token; resume calls `joinByToken` with via. `MeetupWelcome` shows a closed state from
  `previewByToken.joinsOpen` ("closed to new +1s - if you're already in it, sign in"); the authed
  join path renders the same closed state on FORBIDDEN (race: closed between preview and join).
- **PlanShareSheet:** unchanged except the link carries via; when the door is closed, a note that
  the link won't admit new people.
- Copy via `lib/copy.ts`; compose from `ui/` components; trpc manual mock updated for any new
  client calls.

## Edge cases

- Door closes between preview and join: friendly FORBIDDEN -> closed-state UI, stash dropped.
- `via` user left the group before redemption: attribution null; the link still admits (the door
  is the control, not the sharer).
- Legacy `/m/<id>` links without via: work; attribution null.
- Participant who is also a group member: shown once, in the group section.
- `setJoinsOpen` when frozen or by a participant: FORBIDDEN; non-roster: loadEvent's
  NOT_FOUND-before-FORBIDDEN pattern.

## Testing

- Shared: schema defaults + explicit flags.
- API (DB-backed, `pnpm db:up`): create persists flags; shareLink carries via; joinByToken
  attribution (valid via / stranger via / absent via), closed-door rejection for new joiners,
  no-op rejoin while closed for existing roster; roster shape + gating + graduation filter;
  setJoinsOpen permissions (member ok, participant FORBIDDEN, frozen FORBIDDEN); previewByToken
  exposes joinsOpen and still leaks no names.
- Mobile: via/token parsing, stash back-compat, rosterSeen unit tests, Who's-in sheet render,
  wizard sends flags, MeetupWelcome closed state.

## Rollout

No backfill, no behavior change for existing data (defaults preserve today's semantics). Ship on
`dev` in modular commits; `pnpm check` green before push.
