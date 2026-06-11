-- DRP-63 +1 trust controls. Two additive column pairs, defaults preserve today's behavior exactly:
-- every existing plan stays open to +1s with the door unlocked, and existing participants read as
-- legacy joins (no attribution, joined_at backfilled to migration time).
ALTER TABLE "events" ADD COLUMN "joins_open" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lock_joins" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "invited_by" text REFERENCES "users"("id");
--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "joined_at" timestamp NOT NULL DEFAULT now();
