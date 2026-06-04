import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

// Legacy M2 lifecycle, kept so the change stays additive (the new flow uses `phase`).
export const eventStatusEnum = pgEnum("event_status", ["open", "resolved"]);
export const responseKindEnum = pgEnum("response_kind", ["yes", "no", "conditional"]);

// Plan lifecycle: a plan collects reactions -> opens a blind moment -> cleared / fizzled.
export const planPhaseEnum = pgEnum("plan_phase", ["collecting", "moment", "cleared", "fizzled"]);
// Rough time-of-day band a fuzzy candidate sits in.
export const partOfDayEnum = pgEnum("part_of_day", ["morning", "afternoon", "evening", "late"]);
// Which list a candidate sits on: a concrete TIME, or a free-text ACTIVITY (what/where, fused).
export const candidateKindEnum = pgEnum("candidate_kind", ["time", "activity"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatarColor: text("avatar_color").notNull(),
  email: text("email"),
});

export const groups = pgTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }),
);

// A plan. It collects per-candidate reactions across the TIME and ACTIVITY lists, the creator
// locks the winning candidates to open the blind moment, and it clears or silently fizzles.
// `startsAt`/`respondByAt` are retained from M2; they hold the first/last candidate as a
// placeholder until `lock` sets `chosenCandidateId` + the moment window.
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location").notNull(),
  startsAt: timestamp("starts_at").notNull(),
  respondByAt: timestamp("respond_by_at").notNull(),
  status: eventStatusEnum("status").notNull().default("open"),
  contingent: boolean("contingent").notNull().default(false),
  quorum: integer("quorum").notNull().default(1),
  // Plans are always anonymous: createdByUserId is stored for accountability but never surfaced,
  // so isCreator is forced false whenever this is set.
  isAnonymous: boolean("is_anonymous").notNull().default(true),
  phase: planPhaseEnum("phase").notNull().default("collecting"),
  lockTimes: boolean("lock_times").notNull().default(false),
  lockThings: boolean("lock_things").notNull().default(false),
  // Editable "Decides by" deadline. When collecting auto-locks the winning candidates and opens the
  // moment. Null until set. Drives the deadline + auto-lock; settled lazily on read. (was lock_at)
  decidesBy: timestamp("decides_by"),
  chosenCandidateId: text("chosen_candidate_id"),
  momentStartsAt: timestamp("moment_starts_at"),
  momentEndsAt: timestamp("moment_ends_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A candidate time people react to during `collecting`. Exact plans have exactly one; options
// plans have the creator's menu; fuzzy plans have day candidates expanded from the window.
export const eventCandidates = pgTable("event_candidates", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  // TIME candidates set startsAt; ACTIVITY candidates leave it null and use `label` for the text.
  kind: candidateKindEnum("kind").notNull().default("time"),
  startsAt: timestamp("starts_at"),
  partOfDay: partOfDayEnum("part_of_day"),
  label: text("label"),
});

// A "this time works for me" tap. One row per (candidate, user); a user may react to several
// candidates. Replaced wholesale on re-react via delete-by-(eventId, userId).
export const candidateReactions = pgTable(
  "candidate_reactions",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    candidateId: text("candidate_id")
      .notNull()
      .references(() => eventCandidates.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.candidateId, t.userId] }) }),
);

// A member who has bowed out of a collecting plan ("I can't make it"). One row per (event, user)
// while they are opted out; deleted when they rejoin. Their reactions are cleared on opt-out, so
// they drop out of the tally/quorum automatically. Private - never exposed to other members.
export const eventOptOuts = pgTable(
  "event_opt_outs",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.eventId, t.userId] }) }),
);

// A member's commitment during the moment. `cond` carries the "I will make it if…" target set.
export const responses = pgTable("responses", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  userId: text("user_id").notNull(),
  kind: responseKindEnum("kind").notNull(),
  cond: jsonb("cond").$type<{ mode: "all" | "any"; targetIds: string[] }>(),
});
