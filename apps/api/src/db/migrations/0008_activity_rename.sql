-- Unify a plan's name with its activity: rename the title column to activity and the lock_things flag
-- to lock_activity. Pure column renames, no data transform. See the activity-unification spec.
ALTER TABLE "events" RENAME COLUMN "title" TO "activity";--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "lock_things" TO "lock_activity";
