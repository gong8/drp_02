# BeThere — Reference Implementation for `drp_02`

**Date:** 2026-05-28
**Reads with:** `2026-05-28-bethere-product-design.md` (the "why"). This doc is the "how" — stack-matched reference code mapped to the monorepo.

> **This is reference code, not a finished build.** Lift and adapt it. It follows the repo's conventions: pnpm only; type chain Zod (`@drp/shared`) → tRPC (`@drp/api`) → RN client; `apps/api` is ESM (relative imports end in `.js`); Biome formatting (2-space, double quotes, width 100). Branch off `dev` into a `feat/*` branch (see `CONTRIBUTING.md`); these files were written to `docs/` only — nothing under `apps/`/`packages/` has been touched.

---

## 1. Where everything goes (monorepo map)

| Concern | File(s) | Notes |
|---|---|---|
| Domain shapes (Zod) + inferred types | `packages/shared/src/schemas.ts` | re-exported from `index.ts` |
| **Pure logic core** (quorum, matching, conditional resolution, linchpin) | `packages/shared/src/logic/*.ts` | framework-free, unit-tested; reused by client & server |
| DB tables | `apps/api/src/db/schema.ts` | Drizzle/pg |
| Server services (trigger + resolve) | `apps/api/src/services/bethere.ts` | uses the shared logic + `db` |
| API procedures | `apps/api/src/routers/{suggestions,availability,moments}.ts` | mounted in `router.ts` |
| Theme tokens | `apps/mobile/src/theme.ts` | Sage palette + type scale |
| Fonts | `apps/mobile/App.tsx` | `@expo-google-fonts/{lora,inter}` |
| Screens | `apps/mobile/src/screens/*.tsx` | RN; hero screens below, rest spec'd |
| Navigation | `apps/mobile/app/*` (expo-router) | see §7 |

## 2. Dependencies to add

```bash
# shared: nothing new (zod already present). For tests:
pnpm --filter @drp/shared add -D vitest

# mobile: fonts + navigation + (optional) server-state caching
pnpm --filter @drp/mobile add @expo-google-fonts/lora @expo-google-fonts/inter expo-font expo-router
pnpm --filter @drp/mobile add @tanstack/react-query @trpc/react-query   # optional but recommended (caching/polling)
# later: expo-notifications (push), expo-calendar (add-to-calendar)

# api: nothing new (zod via @drp/shared, drizzle/pg/trpc already present)
```

## 3. `@drp/shared` — schemas

`packages/shared/src/schemas.ts`:

```ts
import { z } from "zod";

export const Activity = z.enum(["coffee", "food", "gym", "study", "drinks", "anything"]);
export type Activity = z.infer<typeof Activity>;

export const PartOfDay = z.enum(["morning", "afternoon", "evening"]);
export type PartOfDay = z.infer<typeof PartOfDay>;

export const Slot = z.object({
  day: z.string(), // ISO date, e.g. "2026-06-01"
  partOfDay: PartOfDay,
});
export type Slot = z.infer<typeof Slot>;

export const Conditional = z.object({
  mode: z.enum(["all", "any"]),
  targetIds: z.array(z.string()).min(1),
});
export type Conditional = z.infer<typeof Conditional>;

export const ResponseKind = z.enum(["yes", "no", "conditional"]);
export type ResponseKind = z.infer<typeof ResponseKind>;

// ---- tRPC input schemas (the network boundary) ----
export const CreateSuggestionInput = z.object({
  groupId: z.string(),
  activity: Activity,
  text: z.string().max(80).optional(),
  window: z.object({ start: z.string(), end: z.string() }),
});

export const DropAvailabilityInput = z.object({
  suggestionId: z.string(),
  slots: z.array(Slot).min(1),
});

export const RespondInput = z.object({
  momentId: z.string(),
  kind: ResponseKind,
  cond: Conditional.optional(),
}).refine((v) => v.kind !== "conditional" || !!v.cond, {
  message: "conditional responses require `cond`",
});
```

Re-export from `packages/shared/src/index.ts`:

```ts
export * from "./schemas.js";
export * from "./logic/quorum.js";
export * from "./logic/time.js";
export * from "./logic/matching.js";
export * from "./logic/resolve.js";
```

> ESM note: `@drp/shared` is `"type": "module"`; use `.js` extensions on relative imports (Metro and tsx both resolve these to the `.ts` source).

## 4. `@drp/shared` — the pure logic core (the rigorous part — unit-test it)

`packages/shared/src/logic/quorum.ts`:

```ts
import type { Activity } from "../schemas.js";

// Auto-quorum = smallest viable group for the activity. Tune later.
export const AUTO_QUORUM: Record<Activity, number> = {
  coffee: 2,
  study: 2,
  gym: 2,
  food: 3,
  drinks: 3,
  anything: 2,
};

export function quorumFor(activity: Activity): number {
  return AUTO_QUORUM[activity];
}
```

`packages/shared/src/logic/time.ts`:

```ts
import type { Activity, PartOfDay } from "../schemas.js";

const PART_HOUR: Record<PartOfDay, number> = { morning: 10, afternoon: 14, evening: 19 };

/** Resolve a loose (day, partOfDay) slot to a concrete local datetime. */
export function slotToDate(day: string, part: PartOfDay): Date {
  const d = new Date(day);
  d.setHours(PART_HOUR[part], 0, 0, 0);
  return d;
}

const DEFAULT_PLACE: Record<Activity, string> = {
  coffee: "a local café",
  food: "Pho House",
  gym: "the gym",
  study: "the library",
  drinks: "The Lighthouse",
  anything: "the usual spot",
};

export function defaultPlace(activity: Activity): string {
  return DEFAULT_PLACE[activity];
}
```

`packages/shared/src/logic/matching.ts`:

```ts
import type { PartOfDay } from "../schemas.js";

export interface AvailabilityInput {
  userId: string;
  slots: { day: string; partOfDay: PartOfDay }[];
}

export interface ClearingSlot {
  day: string;
  partOfDay: PartOfDay;
  userIds: string[];
}

/**
 * Find the concrete slot with the most people free, returned only if it meets quorum.
 * Selecting people who share ONE slot guarantees mutual compatibility — this is why
 * there is no intransitivity bug (we never take a "connected component" with no common time).
 */
export function findClearingSlot(
  availabilities: AvailabilityInput[],
  quorum: number,
): ClearingSlot | null {
  const buckets = new Map<string, Set<string>>(); // "day|part" -> userIds
  for (const a of availabilities) {
    for (const s of a.slots) {
      const key = `${s.day}|${s.partOfDay}`;
      const set = buckets.get(key) ?? new Set<string>();
      set.add(a.userId);
      buckets.set(key, set);
    }
  }

  let best: ClearingSlot | null = null;
  for (const [key, set] of buckets) {
    if (set.size < quorum) continue;
    const [day, partOfDay] = key.split("|") as [string, PartOfDay];
    const better =
      !best ||
      set.size > best.userIds.length ||
      (set.size === best.userIds.length && day < best.day); // tie-break: earliest day
    if (better) best = { day, partOfDay, userIds: [...set] };
  }
  return best;
}
```

`packages/shared/src/logic/resolve.ts`:

```ts
import type { ResponseKind } from "../schemas.js";

export interface ResponseInput {
  userId: string;
  kind: ResponseKind;
  cond?: { mode: "all" | "any"; targetIds: string[] };
}

/** Resolve conditionals to a fixpoint. Returns the set of userIds who are IN. */
export function resolveIn(responses: ResponseInput[]): Set<string> {
  const IN = new Set<string>();
  for (const r of responses) if (r.kind === "yes") IN.add(r.userId);

  const conds = responses.filter((r) => r.kind === "conditional" && r.cond);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of conds) {
      if (IN.has(r.userId)) continue;
      const { mode, targetIds } = r.cond!;
      const ok =
        mode === "all"
          ? targetIds.every((id) => IN.has(id))
          : targetIds.some((id) => IN.has(id));
      if (ok) {
        IN.add(r.userId);
        changed = true; // a new IN may satisfy further conditionals — loop again
      }
    }
  }
  return IN; // pure conditional cycles never enter IN: no anchor → no phantom plans
}

export function clears(responses: ResponseInput[], quorum: number): boolean {
  return resolveIn(responses).size >= quorum;
}

/**
 * Linchpins: participants not yet IN whose hypothetical Yes would tip the plan to clearing.
 * Each is eligible for ONE anonymous, positive, ignorable nudge. Returns [] if already clearing.
 */
export function findLinchpins(
  participantIds: string[],
  responses: ResponseInput[],
  quorum: number,
): string[] {
  if (clears(responses, quorum)) return [];
  const current = resolveIn(responses);
  const out: string[] = [];
  for (const p of participantIds) {
    if (current.has(p)) continue;
    const answered = responses.some((r) => r.userId === p && r.kind !== "conditional");
    if (answered) continue; // already said yes/no — don't nudge
    const hypothetical: ResponseInput[] = [
      ...responses.filter((r) => r.userId !== p),
      { userId: p, kind: "yes" },
    ];
    if (clears(hypothetical, quorum)) out.push(p);
  }
  return out;
}
```

### 4a. Tests (vitest — runner-agnostic `describe/it/expect`)

`packages/shared/src/logic/resolve.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveIn, clears, findLinchpins, type ResponseInput } from "./resolve.js";

const yes = (userId: string): ResponseInput => ({ userId, kind: "yes" });
const ifAny = (userId: string, ...t: string[]): ResponseInput =>
  ({ userId, kind: "conditional", cond: { mode: "any", targetIds: t } });
const ifAll = (userId: string, ...t: string[]): ResponseInput =>
  ({ userId, kind: "conditional", cond: { mode: "all", targetIds: t } });

describe("resolveIn", () => {
  it("counts plain yeses", () => {
    expect([...resolveIn([yes("a"), yes("b")])].sort()).toEqual(["a", "b"]);
  });
  it("resolves an 'any' conditional off a yes anchor (and cascades)", () => {
    const r = [yes("a"), ifAny("b", "a"), ifAny("c", "b")];
    expect([...resolveIn(r)].sort()).toEqual(["a", "b", "c"]);
  });
  it("does not resolve an 'all' conditional with a missing target", () => {
    expect(resolveIn([yes("a"), ifAll("b", "a", "c")]).has("b")).toBe(false);
  });
  it("never resolves a pure conditional cycle (no anchor)", () => {
    expect(resolveIn([ifAny("a", "b"), ifAny("b", "a")]).size).toBe(0);
  });
});

describe("clears / findLinchpins", () => {
  it("clears at quorum", () => {
    expect(clears([yes("a"), yes("b"), yes("c")], 3)).toBe(true);
    expect(clears([yes("a"), yes("b")], 3)).toBe(false);
  });
  it("flags the person whose yes would clear", () => {
    expect(findLinchpins(["a", "b", "c"], [yes("a"), yes("b")], 3)).toEqual(["c"]);
  });
  it("flags nobody once already clearing", () => {
    expect(findLinchpins(["a", "b", "c"], [yes("a"), yes("b"), yes("c")], 3)).toEqual([]);
  });
});
```

`packages/shared/src/logic/matching.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findClearingSlot } from "./matching.js";

describe("findClearingSlot", () => {
  it("returns the busiest slot meeting quorum; null otherwise", () => {
    const avail = [
      { userId: "a", slots: [{ day: "2026-06-01", partOfDay: "evening" as const }] },
      { userId: "b", slots: [{ day: "2026-06-01", partOfDay: "evening" as const }] },
      { userId: "c", slots: [{ day: "2026-06-02", partOfDay: "morning" as const }] },
    ];
    expect(findClearingSlot(avail, 2)?.userIds.sort()).toEqual(["a", "b"]);
    expect(findClearingSlot(avail, 3)).toBeNull();
  });
});
```

Add to `packages/shared/package.json`: `"scripts": { "test": "vitest run" }` so root `pnpm test` picks it up.

## 5. `@drp/api` — Drizzle schema

`apps/api/src/db/schema.ts`:

```ts
import { integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const activityEnum = pgEnum("activity", ["coffee", "food", "gym", "study", "drinks", "anything"]);
export const suggestionStatus = pgEnum("suggestion_status", ["collecting", "fired", "expired"]);
export const momentStatus = pgEnum("moment_status", ["open", "cleared", "fizzled"]);
export const responseKindEnum = pgEnum("response_kind", ["yes", "no", "conditional"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatarColor: text("avatar_color").notNull(),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  lastMetAt: timestamp("last_met_at"),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: text("group_id").notNull().references(() => groups.id),
    userId: text("user_id").notNull().references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }),
);

export const suggestions = pgTable("suggestions", {
  id: text("id").primaryKey(),
  groupId: text("group_id").notNull().references(() => groups.id),
  byUserId: text("by_user_id").notNull().references(() => users.id),
  activity: activityEnum("activity").notNull(),
  text: text("text"),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  status: suggestionStatus("status").notNull().default("collecting"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const availability = pgTable("availability", {
  id: text("id").primaryKey(),
  suggestionId: text("suggestion_id").notNull().references(() => suggestions.id),
  userId: text("user_id").notNull().references(() => users.id),
  slots: jsonb("slots").$type<{ day: string; partOfDay: "morning" | "afternoon" | "evening" }[]>().notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const moments = pgTable("moments", {
  id: text("id").primaryKey(),
  suggestionId: text("suggestion_id").notNull().references(() => suggestions.id),
  activity: activityEnum("activity").notNull(),
  proposedTime: timestamp("proposed_time").notNull(),
  proposedPlace: text("proposed_place").notNull(),
  participantIds: jsonb("participant_ids").$type<string[]>().notNull(),
  quorum: integer("quorum").notNull(),
  windowEndsAt: timestamp("window_ends_at").notNull(),
  status: momentStatus("status").notNull().default("open"),
});

export const responses = pgTable("responses", {
  id: text("id").primaryKey(),
  momentId: text("moment_id").notNull().references(() => moments.id),
  userId: text("user_id").notNull().references(() => users.id),
  kind: responseKindEnum("kind").notNull(),
  cond: jsonb("cond").$type<{ mode: "all" | "any"; targetIds: string[] }>(),
});

export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  momentId: text("moment_id").notNull().references(() => moments.id),
  activity: activityEnum("activity").notNull(),
  finalTime: timestamp("final_time").notNull(),
  place: text("place").notNull(),
  confirmedParticipantIds: jsonb("confirmed_participant_ids").$type<string[]>().notNull(),
});
```

Generate + migrate: `pnpm --filter @drp/api db:generate && pnpm --filter @drp/api db:migrate`.

## 6. `@drp/api` — services + tRPC procedures

**Context:** add the current user to tRPC context (the skeleton's `createContext` returns `{}`). For dev, read a header or hardcode; production = real auth.

```ts
// apps/api/src/trpc.ts  (extend createContext)
export function createContext(opts: CreateFastifyContextOptions) {
  const userId = (opts.req.headers["x-user-id"] as string) ?? "u_dev"; // TODO real auth
  return { userId };
}
```

`apps/api/src/services/bethere.ts` — trigger + resolve (the only place that touches privacy-sensitive data):

```ts
import { eq } from "drizzle-orm";
import { quorumFor, defaultPlace, slotToDate, findClearingSlot, resolveIn } from "@drp/shared";
import { db } from "../db/client.js";
import { availability, moments, plans, responses, suggestions } from "../db/schema.js";
import { randomUUID } from "node:crypto";

const WINDOW_MS = 30 * 60 * 1000; // 30-minute moment window

/** Called after each availability drop. Fires a moment if a slot meets quorum. */
export async function tryFireMoment(suggestionId: string): Promise<string | null> {
  const [sug] = await db.select().from(suggestions).where(eq(suggestions.id, suggestionId));
  if (!sug || sug.status !== "collecting") return null;

  const rows = await db.select().from(availability).where(eq(availability.suggestionId, suggestionId));
  const slot = findClearingSlot(
    rows.map((r) => ({ userId: r.userId, slots: r.slots })),
    quorumFor(sug.activity),
  );
  if (!slot) return null;

  const id = randomUUID();
  await db.insert(moments).values({
    id,
    suggestionId,
    activity: sug.activity,
    proposedTime: slotToDate(slot.day, slot.partOfDay),
    proposedPlace: defaultPlace(sug.activity),
    participantIds: slot.userIds,
    quorum: quorumFor(sug.activity),
    windowEndsAt: new Date(Date.now() + WINDOW_MS),
    status: "open",
  });
  await db.update(suggestions).set({ status: "fired" }).where(eq(suggestions.id, suggestionId));
  // TODO push: notify slot.userIds "it's coming together — respond"
  return id;
}

/** Called when a moment's window closes (scheduled sweep or on-read). */
export async function resolveMoment(momentId: string): Promise<"cleared" | "fizzled"> {
  const [m] = await db.select().from(moments).where(eq(moments.id, momentId));
  if (!m || m.status !== "open") return m?.status === "cleared" ? "cleared" : "fizzled";

  const resp = await db.select().from(responses).where(eq(responses.momentId, momentId));
  const IN = resolveIn(resp.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined })));

  if (IN.size >= m.quorum) {
    await db.insert(plans).values({
      id: randomUUID(),
      momentId,
      activity: m.activity,
      finalTime: m.proposedTime,
      place: m.proposedPlace,
      confirmedParticipantIds: [...IN],
    });
    await db.update(moments).set({ status: "cleared" }).where(eq(moments.id, momentId));
    // TODO push: notify IN "it clicked — you're on"
    return "cleared";
  }
  await db.update(moments).set({ status: "fizzled" }).where(eq(moments.id, momentId));
  // SILENT: no notification, no trace (privacy invariant §8.5)
  return "fizzled";
}
```

`apps/api/src/routers/suggestions.ts`:

```ts
import { CreateSuggestionInput } from "@drp/shared";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { suggestions } from "../db/schema.js";
import { publicProcedure, router } from "../trpc.js";

export const suggestionsRouter = router({
  create: publicProcedure.input(CreateSuggestionInput).mutation(async ({ ctx, input }) => {
    const id = randomUUID();
    await db.insert(suggestions).values({
      id,
      groupId: input.groupId,
      byUserId: ctx.userId,
      activity: input.activity,
      text: input.text ?? null,
      windowStart: new Date(input.window.start),
      windowEnd: new Date(input.window.end),
      status: "collecting",
    });
    // TODO push: notify group members "X suggested … add your availability"
    return { id };
  }),
});
```

`apps/api/src/routers/availability.ts`:

```ts
import { DropAvailabilityInput } from "@drp/shared";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { availability } from "../db/schema.js";
import { tryFireMoment } from "../services/bethere.js";
import { publicProcedure, router } from "../trpc.js";

export const availabilityRouter = router({
  drop: publicProcedure.input(DropAvailabilityInput).mutation(async ({ ctx, input }) => {
    await db.insert(availability).values({
      id: randomUUID(),
      suggestionId: input.suggestionId,
      userId: ctx.userId,
      slots: input.slots,
    });
    const momentId = await tryFireMoment(input.suggestionId); // may fire now
    return { floating: true, firedMomentId: momentId }; // NEVER returns who-else/counts
  }),

  withdraw: publicProcedure.input(DropAvailabilityInput.pick({ suggestionId: true })).mutation(
    async ({ ctx, input }) => {
      await db
        .delete(availability)
        .where(and(eq(availability.suggestionId, input.suggestionId), eq(availability.userId, ctx.userId)));
      return { ok: true }; // silent — no one notified
    },
  ),
});
```

`apps/api/src/routers/moments.ts`:

```ts
import { RespondInput } from "@drp/shared";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { moments, responses } from "../db/schema.js";
import { resolveMoment } from "../services/bethere.js";
import { publicProcedure, router } from "../trpc.js";

export const momentsRouter = router({
  // The proposal as the CURRENT USER may see it — never includes others' responses or a tally.
  mine: publicProcedure.query(async ({ ctx }) => {
    const open = await db.select().from(moments).where(eq(moments.status, "open"));
    const forMe = open.filter((m) => m.participantIds.includes(ctx.userId));
    return forMe.map((m) => ({
      id: m.id,
      activity: m.activity,
      proposedTime: m.proposedTime,
      proposedPlace: m.proposedPlace,
      windowEndsAt: m.windowEndsAt,
      // participantIds intentionally OMITTED while open (blind/equal)
    }));
  }),

  respond: publicProcedure.input(RespondInput).mutation(async ({ ctx, input }) => {
    await db.insert(responses).values({
      id: randomUUID(),
      momentId: input.momentId,
      userId: ctx.userId,
      kind: input.kind,
      cond: input.cond ?? null,
    });
    return { recorded: true }; // NEVER echoes the tally back (blind)
  }),
});
```

Mount in `apps/api/src/router.ts`:

```ts
import { availabilityRouter } from "./routers/availability.js";
import { momentsRouter } from "./routers/moments.js";
import { suggestionsRouter } from "./routers/suggestions.js";
import { publicProcedure, router } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true as const })),
  suggestions: suggestionsRouter,
  availability: availabilityRouter,
  moments: momentsRouter,
});
export type AppRouter = typeof appRouter;
```

> **Resolving at the buzzer:** simplest is a periodic sweep — `setInterval` in `index.ts` that finds `moments` with `status="open"` and `windowEndsAt < now` and calls `resolveMoment`. (A job queue is overkill at this scale.) The linchpin nudge uses `findLinchpins(...)` mid-window inside the same sweep, sending at most one push per linchpin.

## 7. `@drp/mobile` — navigation

The skeleton has **no nav library**. Recommended: **expo-router** (file-based, idiomatic for Expo SDK 56). Route files under `apps/mobile/app/`:

```
app/_layout.tsx        # loads fonts; Stack navigator
app/index.tsx          # Home / Groups
app/suggest.tsx        # Suggest
app/availability.tsx   # Availability (params: suggestionId)
app/floating.tsx       # Floating
app/moment.tsx         # The moment (params: momentId)  — presents the conditional sheet
app/reveal.tsx         # It's on
app/plan.tsx           # Firm plan
```

(For a faster prototype, a single `useState<Screen>` switcher also works and avoids the dep — but expo-router is the real-app choice.)

## 8. `@drp/mobile` — theme tokens

`apps/mobile/src/theme.ts`:

```ts
export const colors = {
  bg: "#F7F8F3",
  surface: "#FFFFFF",
  ink: "#1F2823",
  muted: "#8B948B",
  accent: "#5F9472",
  accentInk: "#3F7355",
  accentSoft: "#E9F1EB",
  line: "#E9ECE5",
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { md: 12, lg: 15, xl: 18, sheet: 28 } as const;

export const fonts = {
  display: "Lora_600SemiBold",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;
```

## 9. `@drp/mobile` — fonts (App root)

`apps/mobile/App.tsx` (or `app/_layout.tsx` with expo-router):

```tsx
import { Lora_600SemiBold, useFonts } from "@expo-google-fonts/lora";
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from "@expo-google-fonts/inter";

export default function App() {
  const [loaded] = useFonts({
    Lora_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!loaded) return null;
  return /* navigator / first screen */ null;
}
```

## 10. `@drp/mobile` — hero screen: The Moment

`apps/mobile/src/screens/TheMoment.tsx` — faithful to the agreed design (flat, one accent, quiet countdown, blind). The "I'm in if…" sheet has the **all / at-least-one** toggle.

```tsx
import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space } from "../theme";

type Member = { id: string; name: string };
type Mode = "all" | "any";

export function TheMoment(props: {
  group: string;
  msLeft: number; // drive a countdown string from this
  title: string; // e.g. "Dinner tonight?"
  place: string; // e.g. "Pho House"
  detail: string; // e.g. "Thursday · 7:00pm · 8 min walk"
  members: Member[]; // other participants, for the conditional picker
  onRespond: (r: { kind: "yes" | "no" | "conditional"; mode?: Mode; targetIds?: string[] }) => void;
}) {
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] = useState<Mode>("all");
  const [picked, setPicked] = useState<string[]>([]);
  const left = useMemo(() => {
    const s = Math.max(0, Math.floor(props.msLeft / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
  }, [props.msLeft]);

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <Text style={s.group}>{props.group}</Text>
        <Text style={s.timer}>{left}</Text>
      </View>

      <Text style={s.title}>{props.title}</Text>

      <View style={s.plan}>
        <Text style={s.planTitle}>🍜  {props.place}</Text>
        <Text style={s.planMeta}>{props.detail}</Text>
      </View>

      <View style={{ flex: 1 }} />

      <Pressable style={[s.btn, s.primary]} onPress={() => props.onRespond({ kind: "yes" })}>
        <Text style={s.primaryLabel}>I'm in</Text>
      </Pressable>
      <Pressable style={[s.btn, s.ghost]} onPress={() => setSheet(true)}>
        <Text style={s.ghostLabel}>I'm in if…</Text>
      </Pressable>
      <Pressable style={s.textBtn} onPress={() => props.onRespond({ kind: "no" })}>
        <Text style={s.textLabel}>Can't make it</Text>
      </Pressable>

      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable style={s.dim} onPress={() => setSheet(false)} />
        <View style={s.sheet}>
          <View style={s.handle} />
          <Text style={s.sheetTitle}>I'm in if…</Text>

          <View style={s.seg}>
            {(["all", "any"] as Mode[]).map((m) => (
              <Pressable key={m} style={[s.segOpt, mode === m && s.segOn]} onPress={() => setMode(m)}>
                <Text style={[s.segLabel, mode === m && s.segLabelOn]}>
                  {m === "all" ? "All of these" : "At least one"}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={s.people}>
            {props.members.map((mem) => {
              const on = picked.includes(mem.id);
              return (
                <Pressable
                  key={mem.id}
                  style={[s.person, on && s.personOn]}
                  onPress={() =>
                    setPicked((p) => (on ? p.filter((x) => x !== mem.id) : [...p, mem.id]))
                  }
                >
                  <View style={[s.pav, on && s.pavOn]}>
                    <Text style={[s.pavText, on && { color: "#fff" }]}>{mem.name[0]}</Text>
                  </View>
                  <Text style={s.personName}>{mem.name}</Text>
                  {on && <Text style={s.check}>✓</Text>}
                </Pressable>
              );
            })}
          </View>

          <Pressable
            style={[s.btn, s.primary, { marginTop: space.lg, opacity: picked.length ? 1 : 0.4 }]}
            disabled={!picked.length}
            onPress={() => {
              props.onRespond({ kind: "conditional", mode, targetIds: picked });
              setSheet(false);
            }}
          >
            <Text style={s.primaryLabel}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22, paddingTop: 60, paddingBottom: 22 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  group: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.muted },
  timer: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.accentInk },
  title: { fontFamily: fonts.display, fontSize: 30, color: colors.ink, marginTop: space.md },
  plan: {
    marginTop: space.xl, padding: 18, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.xl, backgroundColor: colors.surface,
  },
  planTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  planMeta: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.muted, marginTop: 5 },
  btn: { borderRadius: radius.lg, paddingVertical: 16, alignItems: "center", marginTop: space.sm },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { fontFamily: fonts.bold, fontSize: 15, color: "#fff" },
  ghost: { borderWidth: 1, borderColor: colors.line, backgroundColor: "transparent" },
  ghostLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
  textBtn: { paddingVertical: 12, alignItems: "center", marginTop: space.xs },
  textLabel: { fontFamily: fonts.semibold, fontSize: 15, color: colors.muted },
  dim: { flex: 1, backgroundColor: "rgba(22,30,25,0.42)" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, padding: 22 },
  handle: { width: 38, height: 4, borderRadius: 999, backgroundColor: "#E2E5DD", alignSelf: "center", marginBottom: 18 },
  sheetTitle: { fontFamily: fonts.bold, fontSize: 21, color: colors.ink, marginBottom: 14 },
  seg: { flexDirection: "row", backgroundColor: "#EEF0EA", borderRadius: radius.md, padding: 4, marginBottom: 18 },
  segOpt: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  segOn: { backgroundColor: colors.surface },
  segLabel: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.muted },
  segLabelOn: { color: colors.ink },
  people: { gap: 9 },
  person: { flexDirection: "row", alignItems: "center", gap: 9, padding: 11, borderWidth: 1, borderColor: colors.line, borderRadius: 13 },
  personOn: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pav: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.accentSoft, alignItems: "center", justifyContent: "center" },
  pavOn: { backgroundColor: colors.accent },
  pavText: { fontFamily: fonts.bold, fontSize: 12, color: colors.accentInk },
  personName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  check: { marginLeft: "auto", fontFamily: fonts.bold, fontSize: 14, color: colors.accent },
});
```

## 11. `@drp/mobile` — hero screen: It's On (reveal)

`apps/mobile/src/screens/Reveal.tsx`:

```tsx
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts, radius, space } from "../theme";

type Person = { id: string; name: string; color: string };

export function Reveal(props: {
  people: Person[]; // the IN crowd (you + others) — already opted in, safe to show
  place: string;
  detail: string;
  onAddToCalendar: () => void;
  onTweak: () => void;
}) {
  const others = props.people.length - 1;
  return (
    <View style={s.screen}>
      <Text style={s.title}>It clicked</Text>
      <Text style={s.sub}>You're not the only one{"\n"}who wanted this.</Text>

      <View style={s.avs}>
        {props.people.map((p, i) => (
          <View key={p.id} style={[s.av, { backgroundColor: p.color, marginLeft: i ? -12 : 0 }]}>
            <Text style={s.avText}>{p.name[0]}</Text>
          </View>
        ))}
      </View>
      <Text style={s.proof}>You + {others} {others === 1 ? "other" : "others"} are in</Text>

      <View style={s.plan}>
        <Text style={s.planTitle}>🍜  {props.place}</Text>
        <Text style={s.planMeta}>{props.detail}</Text>
      </View>

      <View style={{ flex: 1 }} />
      <Pressable style={[s.btn, s.primary]} onPress={props.onAddToCalendar}>
        <Text style={s.primaryLabel}>Add to calendar</Text>
      </Pressable>
      <Pressable style={[s.btn, s.ghost]} onPress={props.onTweak}>
        <Text style={s.ghostLabel}>Suggest a tweak</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 22, paddingTop: 64, paddingBottom: 22 },
  title: { fontFamily: fonts.display, fontSize: 38, color: colors.ink, textAlign: "center" },
  sub: { fontFamily: fonts.medium, fontSize: 14, color: colors.muted, textAlign: "center", marginTop: 12, lineHeight: 20 },
  avs: { flexDirection: "row", justifyContent: "center", marginTop: 30, marginBottom: 14 },
  av: { width: 48, height: 48, borderRadius: 24, borderWidth: 3, borderColor: colors.bg, alignItems: "center", justifyContent: "center" },
  avText: { fontFamily: fonts.bold, fontSize: 16, color: "#fff" },
  proof: { fontFamily: fonts.bold, fontSize: 15.5, color: colors.ink, textAlign: "center" },
  plan: { marginTop: space.xl, padding: 18, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl, backgroundColor: colors.surface },
  planTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.ink },
  planMeta: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.muted, marginTop: 5 },
  btn: { borderRadius: radius.lg, paddingVertical: 16, alignItems: "center", marginTop: space.sm },
  primary: { backgroundColor: colors.accent },
  primaryLabel: { fontFamily: fonts.bold, fontSize: 15, color: "#fff" },
  ghost: { borderWidth: 1, borderColor: colors.line },
  ghostLabel: { fontFamily: fonts.bold, fontSize: 15, color: colors.ink },
});
```

## 12. The remaining screens (build to these specs, same tokens/components)

- **Home / Groups** — `FlatList` of group rows (name + member count); a single primary "Suggest something" button (accent) pinned bottom; a quiet banner only if `moments.mine` returns one. No noise.
- **Suggest** — activity chips (reuse the pill style from the sheet); window chips (Tonight/This week/Weekend); a group selector; primary "Suggest to group" → `trpc.suggestions.create`. Then route to Floating.
- **Availability** — header "X suggested 🍜 — when are you free?"; day chips (from the window) + part-of-day chips; persistent muted line "Private — only you see this"; primary "Drop availability" → `trpc.availability.drop`. The lock line is the *only* reassurance text — keep it to one line.
- **Floating** — calm list of the user's pending availability (status "Floating", no counts/names); a quiet "Withdraw quietly" text button per item → `trpc.availability.withdraw`. When `moments.mine` starts returning a moment, route to TheMoment.
- **Firm plan** — compact card (activity, final time, place, the confirmed avatars from the plan); "Add to calendar" + "Set a reminder". No thread.
- **Silent expiry** — there is no dedicated screen; the floating item simply disappears (its suggestion went `fizzled`). Optionally animate a gentle fade on removal. **Never** show a "failed" state.

## 13. Privacy as concrete server rules (procedure return shapes)

| Procedure | Returns | Must NOT return |
|---|---|---|
| `availability.drop` | `{ floating, firedMomentId }` | who else dropped, any count |
| `availability.withdraw` | `{ ok }` | anything to anyone else |
| `moments.mine` | proposal fields (time/place/activity/deadline) | `participantIds`, others' responses, any tally |
| `moments.respond` | `{ recorded }` | the running tally |
| (on clear) `plans` read | the IN crowd + final details | who said no / didn't respond (indistinguishable) |
| (on fizzle) | nothing — no push, no record surfaced | any signal at all |

These are the teeth behind product-design §8. Keep the rule in a comment on each procedure.

## 14. Build & verify

```bash
pnpm install
pnpm --filter @drp/shared test     # logic core (the rigorous part)
pnpm typecheck                     # whole workspace
pnpm db:up && pnpm --filter @drp/api db:generate && pnpm --filter @drp/api db:migrate
pnpm dev:api                       # http://localhost:3000
pnpm dev:mobile                    # Expo
```

## 15. Deferred (wire later, behind the same interfaces)

- **Push notifications** (`expo-notifications`) — the only 4 signals in product-design §8.6. Real-time is push-based by design; no websockets/subscriptions needed.
- **AI seeding** — `suggestions` can be created by a service that reads `groups.lastMetAt` + past activities; start with a deterministic stub, swap in a model later.
- **Add-to-calendar** (`expo-calendar`) and **reminders**.
- **Server-state caching** — add `@trpc/react-query` + `@tanstack/react-query` for polling `moments.mine` and invalidation; until then call the vanilla `trpc` client in a `useEffect` + focus listener.
