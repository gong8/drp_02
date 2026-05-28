import { z } from "zod";

// A person's answer to an event. "conditional" carries a `cond` (see Conditional).
export const ResponseKind = z.enum(["yes", "no", "conditional"]);
export type ResponseKind = z.infer<typeof ResponseKind>;

// "I will make it if…" - resolved by the server.
// mode "all": in once every target is in. mode "any": in once any target is in.
export const Conditional = z.object({
  mode: z.enum(["all", "any"]),
  targetIds: z.array(z.string()).min(1),
});
export type Conditional = z.infer<typeof Conditional>;

// Network boundary for events.respond.
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

// Network boundary for events.resolve - locks responses once the deadline passes.
export const ResolveInput = z.object({ eventId: z.string() });
export type ResolveInput = z.infer<typeof ResolveInput>;

// Network boundary for events.create - a concrete meet with a fixed time and place.
export const CreateEventInput = z.object({
  groupId: z.string(),
  title: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  location: z.string().min(1).max(120),
  startsAt: z.string(), // ISO datetime
  respondByAt: z.string(), // ISO datetime
});
export type CreateEventInput = z.infer<typeof CreateEventInput>;

// Network boundary for groups.create.
export const CreateGroupInput = z.object({ name: z.string().min(1).max(60) });
export type CreateGroupInput = z.infer<typeof CreateGroupInput>;
