-- Unify float (fuzzy) / flexible / concrete into one votable plan.
-- ADDITIVE + COPY + BACK-MIGRATE only. Destructive drops are deferred to 0006,
-- which runs only after the code switch is merged + deployed. Safe under SEED_ON_BOOT=if-empty.

-- 1. float_axis enum -> candidate_kind, value 'idea' -> 'activity'. Rename in place so existing
--    columns typed on it (event_candidates.kind below) keep working; PG ALTER TYPE handles this.
ALTER TYPE "public"."float_axis" RENAME VALUE 'idea' TO 'activity';--> statement-breakpoint
ALTER TYPE "public"."float_axis" RENAME TO "candidate_kind";--> statement-breakpoint

-- 2. event_candidates: add kind (default 'time' - existing rows are all concrete time candidates),
--    make starts_at NULLABLE (activity candidates carry text in `label`, no time).
ALTER TABLE "event_candidates" ADD COLUMN "kind" "candidate_kind" DEFAULT 'time' NOT NULL;--> statement-breakpoint
ALTER TABLE "event_candidates" ALTER COLUMN "starts_at" DROP NOT NULL;--> statement-breakpoint

-- 3. events: add lock flags (default false = open), rename lock_at -> decides_by.
ALTER TABLE "events" ADD COLUMN "lock_times" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lock_things" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" RENAME COLUMN "lock_at" TO "decides_by";--> statement-breakpoint

-- 4. Copy float_suggestions -> event_candidates. TIME suggestions become kind 'time' (startsAt set);
--    IDEA suggestions become kind 'activity' (label = text, startsAt NULL). axis was renamed to the
--    candidate_kind type, whose 'idea' value is now 'activity', so axis already reads 'time'/'activity'.
INSERT INTO "event_candidates" ("id", "event_id", "starts_at", "part_of_day", "label", "kind")
SELECT "id", "event_id", "starts_at", "part_of_day", "text", "axis"
FROM "float_suggestions";--> statement-breakpoint

-- 5. Copy float_votes -> candidate_reactions. suggestion_id maps 1:1 to the copied candidate id.
INSERT INTO "candidate_reactions" ("event_id", "candidate_id", "user_id")
SELECT "event_id", "suggestion_id", "user_id"
FROM "float_votes";--> statement-breakpoint

-- 6. Back-migrate phase: floating plans (former floats) now collect like everything else.
-- Compare via ::text, NOT the enum literal 'floating': this whole migration set runs in ONE
-- transaction on a fresh DB, where 0004's `ALTER TYPE plan_phase ADD VALUE 'floating'` is not yet
-- committed, so referencing it as an enum literal here raises 55P04 (unsafe use of new value).
UPDATE "events" SET "phase" = 'collecting' WHERE "phase"::text = 'floating';
