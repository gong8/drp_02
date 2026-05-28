import { z } from "zod";

export const Activity = z.enum(["coffee", "food", "gym", "study", "drinks", "anything"]);
export type Activity = z.infer<typeof Activity>;

// A person's answer to a moment. "conditional" carries a `cond` (see Conditional).
export const ResponseKind = z.enum(["yes", "no", "conditional"]);
export type ResponseKind = z.infer<typeof ResponseKind>;

// "I'm in if…" — resolved by the server, never revealed to the targets.
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

// Network boundary for moments.resolve — the "buzzer" for a single moment.
export const ResolveInput = z.object({ momentId: z.string() });
export type ResolveInput = z.infer<typeof ResolveInput>;
