import { z } from "zod";

export const Activity = z.enum(["coffee", "food", "gym", "study", "drinks", "anything"]);
export type Activity = z.infer<typeof Activity>;

export const PartOfDay = z.enum(["morning", "afternoon", "evening"]);
export type PartOfDay = z.infer<typeof PartOfDay>;

// A loose time slot: a calendar day plus a coarse part-of-day (resolved to a concrete time later).
export const Slot = z.object({
  day: z.string(), // ISO date, e.g. "2026-06-01"
  partOfDay: PartOfDay,
});
export type Slot = z.infer<typeof Slot>;

// A person's answer to a moment. "conditional" carries a `cond` (see Conditional).
export const ResponseKind = z.enum(["yes", "no", "conditional"]);
export type ResponseKind = z.infer<typeof ResponseKind>;

// "I'm in if…" - resolved by the server, never revealed to the targets.
// mode "all": in once every target is in. mode "any": in once any target is in.
export const Conditional = z.object({
  mode: z.enum(["all", "any"]),
  targetIds: z.array(z.string()).min(1),
});
export type Conditional = z.infer<typeof Conditional>;

// Network boundary for moments.respond.
export const RespondInput = z
  .object({
    momentId: z.string(),
    kind: ResponseKind,
    cond: Conditional.optional(),
  })
  .refine((v) => v.kind !== "conditional" || !!v.cond, {
    message: "conditional responses require `cond`",
  });
export type RespondInput = z.infer<typeof RespondInput>;

// Network boundary for moments.resolve - the "buzzer" for a single moment.
export const ResolveInput = z.object({ momentId: z.string() });
export type ResolveInput = z.infer<typeof ResolveInput>;

// Network boundary for suggestions.create - a low-pressure nudge to a group.
export const CreateSuggestionInput = z.object({
  groupId: z.string(),
  activity: Activity,
  text: z.string().max(80).optional(),
  window: z.object({ start: z.string(), end: z.string() }),
});
export type CreateSuggestionInput = z.infer<typeof CreateSuggestionInput>;

// Network boundary for availability.drop - privately float when you're free.
export const DropAvailabilityInput = z.object({
  suggestionId: z.string(),
  slots: z.array(Slot).min(1),
});
export type DropAvailabilityInput = z.infer<typeof DropAvailabilityInput>;
