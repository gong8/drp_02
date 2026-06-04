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

// How precisely the creator pinned the `when` - the spine of the convergence model.
export const whenModeEnum = pgEnum("when_mode", ["exact", "options", "fuzzy"]);
// Plan lifecycle: a float brews in "floating", everything else collects reactions -> blind moment
// -> cleared / fizzled. "floating" is appended last so the enum migration stays append-only.
export const planPhaseEnum = pgEnum("plan_phase", [
  "collecting",
  "moment",
  "cleared",
  "fizzled",
  "floating",
]);
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

// A plan. The `when` is expressed at variable precision (whenMode): an exact plan is set and
// always happens; an options/fuzzy plan is `contingent` - it collects per-candidate reactions,
// the creator locks the winning slot to open the blind moment, and it clears or silently fizzles.
// `startsAt`/`respondByAt` are retained from M2; for non-exact plans they hold the first/last
// candidate as a placeholder until `lock` sets `chosenCandidateId` + the moment window.
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
  whenMode: whenModeEnum("when_mode").notNull().default("exact"),
  contingent: boolean("contingent").notNull().default(false),
  quorum: integer("quorum").notNull().default(1),
  // A float is unsigned (createdByUserId is stored for accountability but never surfaced) and
  // ownerless. It lives in phase "floating"; this flag persists after it tips so the originator
  // stays hidden forever (isCreator is forced false whenever it is set).
  isAnonymous: boolean("is_anonymous").notNull().default(true),
  // Floats only: the min distinct +1 backers the winning idea needs for the float to tip; below
  // this it fizzles silently. >= 2 so a one-person float can never tip and self-reveal.
  minHeat: integer("min_heat").notNull().default(2),
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

// A chip on a float, on one of two axes: a free-text IDEA ("bowling", "the pub" - fused what+where)
// or a loose TIME band (a day at a part-of-day). Any group member adds rows; others +1 them.
// Mirrors eventCandidates. `createdByUserId` is stored for accountability but NEVER surfaced.
export const floatSuggestions = pgTable("float_suggestions", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  axis: candidateKindEnum("axis").notNull(),
  // IDEA: the free-text label. TIME: optional human label (the band + startsAt carry the meaning).
  text: text("text"),
  // TIME only: the rough band, resolved to a concrete hour at crystallize via PART_HOUR (window.ts).
  partOfDay: partOfDayEnum("part_of_day"),
  // TIME only: the concrete slot this band sits on. Null for IDEA chips.
  startsAt: timestamp("starts_at"),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A +1 on a float suggestion - INTEREST, not commitment (like a candidate reaction, never an RSVP).
// One row per (suggestion, user), toggled on/off. Counts are public (the loud register); the
// `userId` is NEVER surfaced - only aggregate counts and the caller's own state leave the server.
export const floatVotes = pgTable(
  "float_votes",
  {
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    suggestionId: text("suggestion_id")
      .notNull()
      .references(() => floatSuggestions.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.suggestionId, t.userId] }) }),
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
