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

// How loose a fuzzy plan's window is. Expanded into concrete day candidates server-side.
export const Timescale = z.enum(["tonight", "this_week", "this_weekend", "next_two_weeks"]);
export type Timescale = z.infer<typeof Timescale>;

// How precisely the creator pinned the `when`. The user never picks this label directly - it is
// implied by how they fill the when-picker, and it silently routes the plan's behaviour.
export const WhenMode = z.enum(["exact", "options", "fuzzy"]);
export type WhenMode = z.infer<typeof WhenMode>;

// A plan's lifecycle. A `float` brews unsigned in `floating` until it tips; `exact` plans open
// straight into `moment`; `options`/`fuzzy` plans start `collecting` reactions, then a lock (or a
// float tipping) opens the `moment`, which ends `cleared` (enough committed) or `fizzled` (not -
// silent for contingent plans, and the resting state of a float that never caught on).
export const PlanPhase = z.enum(["collecting", "moment", "cleared", "fizzled", "floating"]);
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

// Network boundary for events.create - one plan, with the `when` expressed at variable precision.
export const CreateEventInput = z.object({
  groupId: z.string(),
  title: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  location: z.string().max(120).optional(),
  when: WhenInput,
  // When collecting auto-locks the winning slot and opens the moment (ISO string). Only meaningful
  // for options/fuzzy plans; ignored for exact. Defaulted server-side ("the day before") when
  // omitted, and validated to sit after now and no later than the earliest proposed slot.
  lockAt: z.string().optional(),
  // Min people (incl. resolved conditionals) for the moment to clear. Defaulted server-side.
  quorum: z.number().int().min(1).max(50).optional(),
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

// Network boundary for events.react - replace the caller's "these times work for me" taps.
// An empty array means "none of these work".
export const ReactInput = z.object({
  eventId: z.string(),
  worksCandidateIds: z.array(z.string()),
});
export type ReactInput = z.infer<typeof ReactInput>;

// Network boundary for events.addCandidate - any group member proposes a new concrete time while
// the plan is still collecting. `startsAt` is an ISO string, like one entry of an options menu.
export const AddCandidateInput = z.object({
  eventId: z.string(),
  startsAt: z.string(),
});
export type AddCandidateInput = z.infer<typeof AddCandidateInput>;

// Network boundary for events.setOptOut - a member bows out of a collecting plan ("I can't make
// it"). `out: true` clears their reactions and excludes them from the convergence and reminders;
// `out: false` rejoins them to a neutral, undecided state. Private - no one else sees it.
export const SetOptOutInput = z.object({
  eventId: z.string(),
  out: z.boolean(),
});
export type SetOptOutInput = z.infer<typeof SetOptOutInput>;

// Network boundary for events.lock - the creator opens the blind moment on a slot. `candidateId`
// omitted means the server picks the best-supported candidate. `momentMinutes` sets the countdown.
export const LockInput = z.object({
  eventId: z.string(),
  candidateId: z.string().optional(),
  momentMinutes: z.number().int().min(1).max(1440).optional(),
});
export type LockInput = z.infer<typeof LockInput>;

// Network boundary for events.respond - a commitment during the moment.
export const RespondInput = z
  .object({
    eventId: z.string(),
    kind: ResponseKind,
    cond: Conditional.optional(),
  })
  .refine((v) => v.kind !== "conditional" || !!v.cond, {
    message: "conditional responses require `cond`",
  });
export type RespondInput = z.infer<typeof RespondInput>;

// Network boundary for events.resolve - resolve the moment at (or after) its deadline.
export const ResolveInput = z.object({ eventId: z.string() });
export type ResolveInput = z.infer<typeof ResolveInput>;

// Network boundary for groups.create.
export const CreateGroupInput = z.object({ name: z.string().min(1).max(60) });
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;

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
export const AddIdeaInput = z.object({ eventId: z.string(), text: z.string().min(1).max(80) });
export type AddIdeaInput = z.infer<typeof AddIdeaInput>;

// Network boundary for floats.addTime - any member drops a loose TIME band (a day at a part-of-day).
export const AddTimeInput = z.object({
  eventId: z.string(),
  day: z.string(),
  band: PartOfDay,
});
export type AddTimeInput = z.infer<typeof AddTimeInput>;

// Network boundary for floats.toggleVote - one-tap +1/un-+1 on any chip. Interest, not commitment.
export const ToggleVoteInput = z.object({ eventId: z.string(), suggestionId: z.string() });
export type ToggleVoteInput = z.infer<typeof ToggleVoteInput>;
