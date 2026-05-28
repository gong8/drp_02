import { jsonb, pgEnum, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const eventStatusEnum = pgEnum("event_status", ["open", "resolved"]);
export const responseKindEnum = pgEnum("response_kind", ["yes", "no", "conditional"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  avatarColor: text("avatar_color").notNull(),
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

// A concrete meet: a fixed title, place and time the creator sets up front. Members RSVP
// until `respondByAt`; at the deadline conditionals resolve and the event always happens.
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
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A member's RSVP to an event. `cond` carries the "I will make it if…" target set.
export const responses = pgTable("responses", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  userId: text("user_id").notNull(),
  kind: responseKindEnum("kind").notNull(),
  cond: jsonb("cond").$type<{ mode: "all" | "any"; targetIds: string[] }>(),
});
