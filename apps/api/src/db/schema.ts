import { integer, jsonb, pgEnum, pgTable, text } from "drizzle-orm/pg-core";

export const activityEnum = pgEnum("activity", [
  "coffee",
  "food",
  "gym",
  "study",
  "drinks",
  "anything",
]);
export const momentStatusEnum = pgEnum("moment_status", ["open", "cleared", "fizzled"]);
export const responseKindEnum = pgEnum("response_kind", ["yes", "no", "conditional"]);

// One concrete, timed proposal sent to a set of participants.
export const moments = pgTable("moments", {
  id: text("id").primaryKey(),
  activity: activityEnum("activity").notNull(),
  title: text("title").notNull(),
  place: text("place").notNull(),
  detail: text("detail").notNull(),
  participantIds: jsonb("participant_ids").$type<string[]>().notNull(),
  quorum: integer("quorum").notNull(),
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
