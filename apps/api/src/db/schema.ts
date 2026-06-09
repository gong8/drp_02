import type { Conditional } from "@bethere/shared";
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Frozen legacy: written on every plan but never read; `phase` is the live lifecycle source of
// truth. Slated for removal in a dedicated migration.
export const eventStatusEnum = pgEnum("event_status", ["open", "resolved"]);
export const responseKindEnum = pgEnum("response_kind", ["yes", "no", "conditional"]);

// Plan lifecycle: a plan collects reactions -> opens a blind moment -> cleared / fizzled.
export const planPhaseEnum = pgEnum("plan_phase", ["collecting", "moment", "cleared", "fizzled"]);
// Rough time-of-day band hint for a TIME candidate.
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
  // Stable per-group invite code (M4 onboarding). Shared via a link or typed in to join; unique so
  // a code resolves to exactly one group. Minted at create time and on demand for legacy rows.
  inviteCode: text("invite_code").notNull().unique(),
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

// A plan. It collects per-candidate reactions across the TIME and ACTIVITY lists; the creator
// (or the decidesBy deadline) locks the winning candidates to open the blind moment, then it
// clears or silently fizzles.
export const events = pgTable("events", {
  id: text("id").primaryKey(),
  groupId: text("group_id")
    .notNull()
    .references(() => groups.id),
  createdByUserId: text("created_by_user_id")
    .notNull()
    .references(() => users.id),
  activity: text("activity").notNull(),
  description: text("description"),
  location: text("location").notNull(),
  // Required. Seeded from the leading/trailing candidate; superseded by the moment window
  // (momentStartsAt/momentEndsAt) once `lock` sets chosenCandidateId.
  startsAt: timestamp("starts_at").notNull(),
  respondByAt: timestamp("respond_by_at").notNull(),
  // Frozen legacy column: written on every plan but never read - phase is the live lifecycle
  // source of truth. Slated for removal in a dedicated migration.
  status: eventStatusEnum("status").notNull().default("open"),
  contingent: boolean("contingent").notNull().default(false),
  quorum: integer("quorum").notNull().default(1),
  // Frozen legacy flag: always true. Anonymity is a global invariant (createdByUserId is stored
  // for accountability but never surfaced; isCreator is always false), not a per-plan toggle.
  // Slated for removal in a dedicated migration.
  isAnonymous: boolean("is_anonymous").notNull().default(true),
  phase: planPhaseEnum("phase").notNull().default("collecting"),
  lockTimes: boolean("lock_times").notNull().default(false),
  lockActivity: boolean("lock_activity").notNull().default(false),
  // Editable "Decides by" deadline. When collecting auto-locks the winning candidates and opens the
  // moment. Null until set. Drives the deadline + auto-lock; settled lazily on read. (was lock_at)
  decidesBy: timestamp("decides_by"),
  // Editable "Reply by": when the blind RSVP window closes, then the plan reveals who's in and
  // resolves. Null until set/defaulted; momentEndsAt is set from it (clamped to the event) at lock.
  replyBy: timestamp("reply_by"),
  chosenCandidateId: text("chosen_candidate_id"),
  momentStartsAt: timestamp("moment_starts_at"),
  momentEndsAt: timestamp("moment_ends_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// A candidate on a plan's TIME or ACTIVITY list that members react to during `collecting`.
// TIME candidates set startsAt (with an optional partOfDay hint); ACTIVITY candidates set `label`.
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
// One commitment per (event, user): the respond handler replaces by delete-then-insert, so the
// unique index keeps a surrogate-id row from ever doubling up under a race.
export const responses = pgTable(
  "responses",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    kind: responseKindEnum("kind").notNull(),
    cond: jsonb("cond").$type<Conditional>(),
  },
  (t) => ({ eventUser: uniqueIndex("responses_event_user_unique").on(t.eventId, t.userId) }),
);
