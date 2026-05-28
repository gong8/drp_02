import { integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const activityEnum = pgEnum("activity", [
  "coffee",
  "food",
  "gym",
  "study",
  "drinks",
  "anything",
]);
export const suggestionStatusEnum = pgEnum("suggestion_status", ["collecting", "fired", "expired"]);
export const momentStatusEnum = pgEnum("moment_status", ["open", "cleared", "fizzled"]);
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
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => ({ pk: primaryKey({ columns: [t.groupId, t.userId] }) }),
);

// A light "let's hang out" seed for a group: an activity + a loose window. While
// "collecting" it gathers private availability; it "fires" into a moment once a
// slot meets quorum, or "expires".
export const suggestions = pgTable("suggestions", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  byUserId: text("by_user_id")
    .notNull()
    .references(() => users.id),
  activity: activityEnum("activity").notNull(),
  text: text("text"),
  windowStart: timestamp("window_start").notNull(),
  windowEnd: timestamp("window_end").notNull(),
  status: suggestionStatusEnum("status").notNull().default("collecting"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A person's private, loose availability for a suggestion. Never revealed to anyone
// but its owner (privacy §8.1).
export const availability = pgTable("availability", {
  id: text("id").primaryKey(),
  suggestionId: text("suggestion_id")
    .notNull()
    .references(() => suggestions.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
  slots: jsonb("slots")
    .$type<{ day: string; partOfDay: "morning" | "afternoon" | "evening" }[]>()
    .notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One concrete, timed proposal sent to a set of participants. Display strings
// (title/place line/when) are computed at read time in moments.mine - they are
// NOT stored here.
export const moments = pgTable("moments", {
  id: text("id").primaryKey(),
  suggestionId: text("suggestion_id")
    .notNull()
    .references(() => suggestions.id),
  activity: activityEnum("activity").notNull(),
  proposedTime: timestamp("proposed_time").notNull(),
  proposedPlace: text("proposed_place").notNull(),
  participantIds: jsonb("participant_ids").$type<string[]>().notNull(),
  quorum: integer("quorum").notNull(),
  windowEndsAt: timestamp("window_ends_at").notNull(),
  status: momentStatusEnum("status").notNull().default("open"),
});

// A participant's blind answer to a moment. `cond` carries the "I'm in if…" target set.
export const responses = pgTable("responses", {
  id: text("id").primaryKey(),
  momentId: text("moment_id")
    .notNull()
    .references(() => moments.id),
  userId: text("user_id").notNull(),
  kind: responseKindEnum("kind").notNull(),
  cond: jsonb("cond").$type<{ mode: "all" | "any"; targetIds: string[] }>(),
});

// A cleared moment: the firm plan with the IN crowd. Only the IN crowd is recorded
// (No's / non-responders are never represented - privacy §8.4).
export const plans = pgTable("plans", {
  id: text("id").primaryKey(),
  momentId: text("moment_id")
    .notNull()
    .references(() => moments.id),
  activity: activityEnum("activity").notNull(),
  finalTime: timestamp("final_time").notNull(),
  place: text("place").notNull(),
  confirmedParticipantIds: jsonb("confirmed_participant_ids").$type<string[]>().notNull(),
});
