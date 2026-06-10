-- DRP-62 ad-hoc & cross-group meetups: a meetup's roster decouples from a single group. Two additive
-- join tables. Existing meetups have NO rows in either, so their roster stays exactly their origin
-- group's members (events.groupId) - no backfill, byte-for-byte today's behavior.
CREATE TABLE "event_groups" (
  "event_id" text NOT NULL REFERENCES "events"("id"),
  "group_id" text NOT NULL REFERENCES "groups"("id"),
  CONSTRAINT "event_groups_event_id_group_id_pk" PRIMARY KEY ("event_id", "group_id")
);
--> statement-breakpoint
CREATE TABLE "event_participants" (
  "event_id" text NOT NULL REFERENCES "events"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  CONSTRAINT "event_participants_event_id_user_id_pk" PRIMARY KEY ("event_id", "user_id")
);
