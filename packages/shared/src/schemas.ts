import { z } from "zod";

// A concrete time-instant string at the network boundary. We keep it a string (not z.coerce.date)
// so the inferred type stays string-compatible for every consumer, but reject values Date.parse
// cannot read so a malformed timestamp is caught here instead of silently dropped server-side.
export const Instant = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: "invalid datetime",
});

// A person's answer during the moment. "conditional" carries a `cond` (see Conditional).
export const ResponseKind = z.enum(["yes", "no", "conditional"]);
export type ResponseKind = z.infer<typeof ResponseKind>;

// "I will make it if…" - resolved by the server.
// mode "all": in once every target is in. mode "any": in once any target is in.
export const Conditional = z.object({
  mode: z.enum(["all", "any"]),
  targetIds: z.array(z.string()).min(1),
});
export type Conditional = z.infer<typeof Conditional>;

// Rough time-of-day band the wizard offers. The wizard maps a band to a concrete hour client-side
// (see window.ts) when expanding it into time candidates; it also travels as an optional hint on a
// time candidate. The server only ever sees the resulting concrete instants.
export const PartOfDay = z.enum(["morning", "afternoon", "evening", "late"]);
export type PartOfDay = z.infer<typeof PartOfDay>;

// The two candidate lists a unified plan owns: a "time" (a concrete instant) or an "activity" (a
// fused what+where). Single source of truth for the DB candidate_kind enum and the mobile mirror.
// Replaces the old FloatAxis (idea -> activity).
export const CandidateKind = z.enum(["time", "activity"]);
export type CandidateKind = z.infer<typeof CandidateKind>;

// How loose a window the wizard offers. The wizard expands it into concrete day candidates
// client-side (see window.ts); the server only sees the resulting concrete instants.
export const Timescale = z.enum(["tonight", "this_week", "this_weekend", "next_two_weeks"]);
export type Timescale = z.infer<typeof Timescale>;

// A plan's lifecycle. An exact, locked-time plan opens straight into `moment`; every other plan
// starts `collecting` public +1s, then a lock (creator or the auto "decides by") opens the
// `moment`, which ends `cleared` (quorum committed) or `fizzled` (not - silent for contingent).
export const PlanPhase = z.enum(["collecting", "moment", "cleared", "fizzled"]);
export type PlanPhase = z.infer<typeof PlanPhase>;

// Text-length bounds for a plan's editable text fields, single-sourced so create, addCandidate, and
// update all validate against the same caps (raise one here and every path follows in lockstep).
const ACTIVITY_MAX = 80;
const LOCATION_MAX = 120;
const NOTES_MAX = 500;

// The activity-text rule, single-sourced so addCandidate and create validate identically (mirrors
// the GroupName pattern). The create array additionally trims; see CreateEventInput.
export const ActivityText = z.string().min(1).max(ACTIVITY_MAX);

// One time candidate the wizard sends: a concrete instant plus an optional part-of-day hint (the
// wizard resolves part-of-day chips to concrete days CLIENT-side, so the server only sees instants).
export const TimeCandidateInput = z.object({
  startsAt: Instant,
  partOfDay: PartOfDay.optional(),
});
export type TimeCandidateInput = z.infer<typeof TimeCandidateInput>;

// Network boundary for events.create - ONE unified flow. A plan owns two candidate lists, TIME and
// ACTIVITY, both optional. Two creator locks (default false = open) decide who may add to each list.
// Two editable deadlines, both defaulted server-side: `decidesBy` closes voting + locks the winner;
// `replyBy` closes the blind yes/no/"I'll go if" window, then reveals + resolves. `quorum` defaults.
export const CreateEventInput = z.object({
  groupId: z.string(),
  description: z.string().max(NOTES_MAX).optional(),
  location: z.string().max(LOCATION_MAX).optional(),
  timeCandidates: z.array(TimeCandidateInput).max(10).optional(),
  activityCandidates: z.array(z.string().trim().min(1).max(ACTIVITY_MAX)).max(10).optional(),
  lockTimes: z.boolean().optional().default(false),
  lockActivity: z.boolean().optional().default(false),
  decidesBy: Instant.optional(),
  replyBy: Instant.optional(),
  quorum: z.number().int().min(1).max(50).optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

// Shared base for every per-event mutation/query input: an `{ eventId }` envelope. The event-axis
// inputs below `.extend(...)` it so the field is defined once and the routers can `.input(ByEvent)`
// directly for the bare-eventId procedures.
export const ByEvent = z.object({ eventId: z.string() });
export type ByEvent = z.infer<typeof ByEvent>;

// Network boundary for events.toggleReaction - ONE public +1 toggle on a single candidate of EITHER
// kind. Inserting/removing the caller's row; counts are public during collecting (momentum).
export const ToggleReactionInput = ByEvent.extend({ candidateId: z.string() });
export type ToggleReactionInput = z.infer<typeof ToggleReactionInput>;

// Network boundary for events.addCandidate - any member adds to a list while collecting, kind-gated
// server-side by the creator's locks. A "time" candidate needs `startsAt` (+ optional partOfDay
// hint); an "activity" candidate needs `text`. Adding a candidate +1s it for the author.
export const AddCandidateInput = ByEvent.extend({
  kind: CandidateKind,
  startsAt: Instant.optional(),
  partOfDay: PartOfDay.optional(),
  text: ActivityText.optional(),
});
export type AddCandidateInput = z.infer<typeof AddCandidateInput>;

// Network boundary for events.setOptOut - a member bows out of a collecting plan ("I can't make
// it"). `out: true` clears their reactions and excludes them from the convergence and reminders;
// `out: false` rejoins them to a neutral, undecided state. Private - no one else sees it.
export const SetOptOutInput = ByEvent.extend({
  out: z.boolean(),
});
export type SetOptOutInput = z.infer<typeof SetOptOutInput>;

// Network boundary for events.lock - the creator opens the blind moment on a slot. `candidateId`
// omitted means the server picks the best-supported candidate. The window closes at the plan's
// reply-by (set/defaulted server-side), so no countdown length is passed here.
export const LockInput = ByEvent.extend({
  candidateId: z.string().optional(),
});
export type LockInput = z.infer<typeof LockInput>;

// One editable text field's optimistic compare-and-set: `from` is the value the client loaded, `to`
// is the new value. The server writes `to` only if the current DB value still equals `from` (else it
// reports a conflict and leaves the field untouched), so concurrent edits never silently clobber.
export const FieldEdit = z.object({ from: z.string(), to: z.string() });
export type FieldEdit = z.infer<typeof FieldEdit>;

// Network boundary for events.update - ANY member edits a plan's text metadata (activity/location/notes)
// before it is cleared/fizzled. Each field is an optional CAS; an omitted field is left untouched.
// Anonymous, like every other write. The `to` length bounds mirror create (activity/location 80/120,
// description 500); empty is allowed (an empty activity clears the name so it re-derives from the winning candidate, empty location/notes clears).
export const UpdateEventInput = ByEvent.extend({
  activity: FieldEdit.refine((f) => f.to.length <= ACTIVITY_MAX, {
    message: "activity is too long",
  }).optional(),
  location: FieldEdit.refine((f) => f.to.length <= LOCATION_MAX, {
    message: "location is too long",
  }).optional(),
  description: FieldEdit.refine((f) => f.to.length <= NOTES_MAX, {
    message: "notes are too long",
  }).optional(),
});
export type UpdateEventInput = z.infer<typeof UpdateEventInput>;

// Network boundary for events.respond - a commitment during the moment.
export const RespondInput = ByEvent.extend({
  kind: ResponseKind,
  cond: Conditional.optional(),
}).refine((v) => v.kind !== "conditional" || !!v.cond, {
  message: "conditional responses require `cond`",
});
export type RespondInput = z.infer<typeof RespondInput>;

// Network boundary for events.resolve - resolve the moment at (or after) its deadline. Just an
// `{ eventId }` envelope, so it aliases the shared ByEvent base.
export const ResolveInput = ByEvent;
export type ResolveInput = z.infer<typeof ResolveInput>;

// The group-name rule, single-sourced so create and rename validate identically.
export const GroupName = z.string().min(1).max(60);

// Network boundary for groups.create.
export const CreateGroupInput = z.object({ name: GroupName });
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;

// Network boundary for groups.rename - reuses the shared GroupName rule.
export const RenameGroupInput = z.object({ id: z.string(), name: GroupName });
export type RenameGroupInput = z.infer<typeof RenameGroupInput>;

// Shared `{ id }` envelope for the bare-id queries (events.get, groups.get).
export const ByIdInput = z.object({ id: z.string() });
export type ByIdInput = z.infer<typeof ByIdInput>;

// Shared `{ groupId }` envelope (groups.addableUsers).
export const ByGroupInput = z.object({ groupId: z.string() });
export type ByGroupInput = z.infer<typeof ByGroupInput>;

// Shared `{ groupId, userId }` ref for membership mutations (groups.addMember / removeMember).
export const GroupMemberRef = z.object({ groupId: z.string(), userId: z.string() });
export type GroupMemberRef = z.infer<typeof GroupMemberRef>;
