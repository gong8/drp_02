import { z } from "zod";

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

// Rough time-of-day band a fuzzy plan is anchored to. Maps to a concrete hour (see window.ts).
export const PartOfDay = z.enum(["morning", "afternoon", "evening", "late"]);
export type PartOfDay = z.infer<typeof PartOfDay>;

// The two candidate lists a unified plan owns: a "time" (a concrete instant) or an "activity" (a
// fused what+where). Single source of truth for the DB candidate_kind enum and the mobile mirror.
// Replaces the old FloatAxis (idea -> activity).
export const CandidateKind = z.enum(["time", "activity"]);
export type CandidateKind = z.infer<typeof CandidateKind>;

// The two axes of a float's suggestion chips: an `idea` (a fused what+where) or a `time` (a loose
// band). Single source of truth for the union the DB `floatAxisEnum` and the seed/mobile use.
export const FloatAxis = z.enum(["idea", "time"]);
export type FloatAxis = z.infer<typeof FloatAxis>;

// How loose a fuzzy plan's window is. Expanded into concrete day candidates server-side.
export const Timescale = z.enum(["tonight", "this_week", "this_weekend", "next_two_weeks"]);
export type Timescale = z.infer<typeof Timescale>;

// How precisely the creator pinned the `when`. The user never picks this label directly - it is
// implied by how they fill the when-picker, and it silently routes the plan's behaviour.
export const WhenMode = z.enum(["exact", "options", "fuzzy"]);
export type WhenMode = z.infer<typeof WhenMode>;

// A plan's lifecycle. An exact, locked-time plan opens straight into `moment`; every other plan
// starts `collecting` public +1s, then a lock (creator or the auto "decides by") opens the
// `moment`, which ends `cleared` (quorum committed) or `fizzled` (not - silent for contingent).
export const PlanPhase = z.enum(["collecting", "moment", "cleared", "fizzled"]);
export type PlanPhase = z.infer<typeof PlanPhase>;

// The `when` the creator expresses at creation. The variant they pick is the ONLY thing that
// differs between an "organise" plan and a "float it" plan - the rest of the pipeline is shared.
export const WhenInput = z.discriminatedUnion("mode", [
  // One fixed time - the plan is set; it skips collecting and always happens.
  z.object({ mode: z.literal("exact"), startsAt: z.string() }),
  // One or more proposed times people react to - the best-supported slot wins. A single time is
  // allowed: it starts as one candidate that the group can react to and add alternatives around.
  z.object({ mode: z.literal("options"), options: z.array(z.string()).min(1).max(6) }),
  // A loose window - expanded into day candidates at the chosen band; people react.
  z.object({ mode: z.literal("fuzzy"), timescale: Timescale, band: PartOfDay }),
]);
export type WhenInput = z.infer<typeof WhenInput>;

// One time candidate the wizard sends: a concrete instant plus an optional part-of-day hint (the
// wizard resolves part-of-day chips to concrete days CLIENT-side, so the server only sees instants).
export const TimeCandidateInput = z.object({
  startsAt: z.string(),
  partOfDay: PartOfDay.optional(),
});
export type TimeCandidateInput = z.infer<typeof TimeCandidateInput>;

// Network boundary for events.create - ONE unified flow. A plan owns two candidate lists, TIME and
// ACTIVITY, both optional. Two creator locks (default false = open) decide who may add to each list.
// `decidesBy` is the editable auto-lock instant; `quorum` defaults server-side.
export const CreateEventInput = z.object({
  groupId: z.string(),
  title: z.string().max(80).optional(),
  description: z.string().max(500).optional(),
  location: z.string().max(120).optional(),
  timeCandidates: z.array(TimeCandidateInput).max(10).optional(),
  activityCandidates: z.array(z.string().min(1).max(80)).max(10).optional(),
  lockTimes: z.boolean().optional().default(false),
  lockThings: z.boolean().optional().default(false),
  decidesBy: z.string().optional(),
  quorum: z.number().int().min(1).max(50).optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

// Shared base for every per-event mutation/query input: an `{ eventId }` envelope. The event-axis
// inputs below `.extend(...)` it so the field is defined once and the routers can `.input(ByEvent)`
// directly for the bare-eventId procedures.
export const ByEvent = z.object({ eventId: z.string() });
export type ByEvent = z.infer<typeof ByEvent>;

// Network boundary for events.react - replace the caller's "these times work for me" taps.
// An empty array means "none of these work".
export const ReactInput = ByEvent.extend({
  worksCandidateIds: z.array(z.string()),
});
export type ReactInput = z.infer<typeof ReactInput>;

// Network boundary for events.toggleReaction - ONE public +1 toggle on a single candidate of EITHER
// kind. Inserting/removing the caller's row; counts are public during collecting (momentum).
export const ToggleReactionInput = ByEvent.extend({ candidateId: z.string() });
export type ToggleReactionInput = z.infer<typeof ToggleReactionInput>;

// Network boundary for events.addCandidate - any member adds to a list while collecting, kind-gated
// server-side by the creator's locks. A "time" candidate needs `startsAt` (+ optional partOfDay
// hint); an "activity" candidate needs `text`. Adding a candidate +1s it for the author.
export const AddCandidateInput = ByEvent.extend({
  kind: CandidateKind,
  startsAt: z.string().optional(),
  partOfDay: PartOfDay.optional(),
  text: z.string().min(1).max(80).optional(),
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
// omitted means the server picks the best-supported candidate. `momentMinutes` sets the countdown.
export const LockInput = ByEvent.extend({
  candidateId: z.string().optional(),
  momentMinutes: z.number().int().min(1).max(1440).optional(),
});
export type LockInput = z.infer<typeof LockInput>;

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

// Shared `{ id }` envelope for the bare-id queries (events.get, groups.get, floats.get).
export const ByIdInput = z.object({ id: z.string() });
export type ByIdInput = z.infer<typeof ByIdInput>;

// Shared `{ groupId }` envelope (groups.addableUsers).
export const ByGroupInput = z.object({ groupId: z.string() });
export type ByGroupInput = z.infer<typeof ByGroupInput>;

// Shared `{ groupId, userId }` ref for membership mutations (groups.addMember / removeMember).
export const GroupMemberRef = z.object({ groupId: z.string(), userId: z.string() });
export type GroupMemberRef = z.infer<typeof GroupMemberRef>;

// The loose window a float lives in: a timescale plus an optional part-of-day band (defaulted server
// -side). Drives the tip-deadline default and the collecting fallback when the float grows no times.
export const FloatWindow = z.object({ timescale: Timescale, band: PartOfDay.optional() });
export type FloatWindow = z.infer<typeof FloatWindow>;

// Network boundary for floats.create - float a loose idea to a group. ALWAYS unsigned and ownerless.
// `ideas` are the seed IDEA chips (at least one spark). `tipAt` overrides the window-derived default.
export const CreateFloatInput = z.object({
  groupId: z.string(),
  ideas: z.array(z.string().min(1).max(80)).min(1).max(6),
  window: FloatWindow,
  tipAt: z.string().optional(),
  // The min distinct +1 backers the winning idea needs to tip (else it fizzles). >= 2.
  minHeat: z.number().int().min(2).max(50).optional(),
});
export type CreateFloatInput = z.infer<typeof CreateFloatInput>;

// Network boundary for floats.addIdea - any member drops a free-text IDEA chip (fused what+where).
export const AddIdeaInput = ByEvent.extend({ text: z.string().min(1).max(80) });
export type AddIdeaInput = z.infer<typeof AddIdeaInput>;

// Network boundary for floats.addTime - any member drops a loose TIME band (a day at a part-of-day).
export const AddTimeInput = ByEvent.extend({
  day: z.string(),
  band: PartOfDay,
});
export type AddTimeInput = z.infer<typeof AddTimeInput>;

// Network boundary for floats.toggleVote - one-tap +1/un-+1 on any chip. Interest, not commitment.
export const ToggleVoteInput = ByEvent.extend({ suggestionId: z.string() });
export type ToggleVoteInput = z.infer<typeof ToggleVoteInput>;
