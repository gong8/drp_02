import {
  type Activity,
  ResolveInput,
  RespondInput,
  type ResponseInput,
  resolveIn,
} from "@drp/shared";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../trpc.js";

type MomentStatus = "open" | "cleared" | "fizzled";

interface Moment {
  id: string;
  activity: Activity;
  title: string; // headline, e.g. "Dinner tonight?"
  place: string; // e.g. "Pho House"
  detail: string; // e.g. "Thu 7pm"
  participantIds: string[];
  quorum: number;
  status: MomentStatus;
}

// ---- In-memory store (no DB yet — resets on restart) ----
// One seeded proposal. Two of the three participants are already IN, so the dev
// user's answer is the one that tips it: Yes → clears (3/3), No → fizzles (2/3).
// Pre-seeded responses live server-side and are NEVER sent to a client.
const SEED_MOMENT_ID = "m_seed";

const moments = new Map<string, Moment>([
  [
    SEED_MOMENT_ID,
    {
      id: SEED_MOMENT_ID,
      activity: "food",
      title: "Dinner tonight?",
      place: "Pho House",
      detail: "Thu 7pm",
      participantIds: ["u_dev", "u_maya", "u_sam"],
      quorum: 3,
      status: "open",
    },
  ],
]);

const responses = new Map<string, ResponseInput[]>([
  [
    SEED_MOMENT_ID,
    [
      { userId: "u_maya", kind: "yes" },
      { userId: "u_sam", kind: "yes" },
    ],
  ],
]);

export const momentsRouter = router({
  // The proposal as THIS user may see it. Returns only display fields — never
  // participantIds, others' responses, or any tally (blind/equal during the window).
  mine: publicProcedure.query(({ ctx }) => {
    for (const m of moments.values()) {
      if (m.status === "open" && m.participantIds.includes(ctx.userId)) {
        return { id: m.id, activity: m.activity, title: m.title, place: m.place, detail: m.detail };
      }
    }
    return null;
  }),

  // Records the user's answer (one per user — a later answer replaces an earlier one).
  // Returns only { recorded } — never the running tally (blind).
  respond: publicProcedure.input(RespondInput).mutation(({ ctx, input }) => {
    if (!moments.has(input.momentId)) throw new TRPCError({ code: "NOT_FOUND" });
    const list = responses.get(input.momentId) ?? [];
    const next = list.filter((r) => r.userId !== ctx.userId);
    next.push({ userId: ctx.userId, kind: input.kind, cond: input.cond });
    responses.set(input.momentId, next);
    return { recorded: true as const };
  }),

  // The buzzer: resolve conditionals and decide clear vs fizzle. On clear we reveal
  // the IN count (those people opted in — safe to show). On fizzle we reveal nothing,
  // not even how close it got (privacy §8.5). Idempotent once resolved.
  resolve: publicProcedure.input(ResolveInput).mutation(({ input }) => {
    const moment = moments.get(input.momentId);
    if (!moment) throw new TRPCError({ code: "NOT_FOUND" });

    if (moment.status === "open") {
      const inSet = resolveIn(responses.get(moment.id) ?? []);
      moment.status = inSet.size >= moment.quorum ? "cleared" : "fizzled";
      if (moment.status === "cleared") return { status: "cleared" as const, inCount: inSet.size };
      return { status: "fizzled" as const };
    }

    if (moment.status === "cleared") {
      const inSet = resolveIn(responses.get(moment.id) ?? []);
      return { status: "cleared" as const, inCount: inSet.size };
    }
    return { status: "fizzled" as const };
  }),
});
