-- DRP-63 +1 trust controls. Two additive column pairs, defaults preserve today's behavior exactly:
-- every existing plan stays open to +1s with the door unlocked, and existing participants read as
-- legacy joins (no attribution, joined_at backfilled to migration time).
ALTER TABLE "events" ADD COLUMN "joins_open" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lock_joins" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
-- SET NULL on inviter deletion: attribution is a soft trust signal, so a +1 whose inviter is gone
-- degrades to a plain "+1" (the same rendering as a legacy/bogus via) instead of blocking deletes.
ALTER TABLE "event_participants" ADD COLUMN "invited_by" text REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "event_participants" ADD COLUMN "joined_at" timestamp NOT NULL DEFAULT now();
