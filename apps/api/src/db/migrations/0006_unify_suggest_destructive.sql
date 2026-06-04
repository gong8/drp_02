-- Destructive half of the unified-suggest migration. Run ONLY after the code switch is deployed:
-- by now nothing reads float_suggestions / float_votes / min_heat / when_mode, and no row is ever
-- written with phase 'floating'. 0005 already copied float data into event_candidates / candidate_reactions.

-- 1. Drop float tables (votes first - FK to suggestions). Data already copied in 0005.
DROP TABLE "float_votes";--> statement-breakpoint
DROP TABLE "float_suggestions";--> statement-breakpoint

-- Align the is_anonymous DB default with the always-anonymous model (schema declares true).
ALTER TABLE "events" ALTER COLUMN "is_anonymous" SET DEFAULT true;--> statement-breakpoint

-- 2. Drop dead event columns.
ALTER TABLE "events" DROP COLUMN "min_heat";--> statement-breakpoint
ALTER TABLE "events" DROP COLUMN "when_mode";--> statement-breakpoint

-- 3. Drop the now-unused when_mode enum type (no column references it after step 2).
DROP TYPE "public"."when_mode";--> statement-breakpoint

-- 4. Rebuild plan_phase without 'floating' (PG cannot DROP an enum value). 0005 already
--    back-migrated every 'floating' row to 'collecting', so the cast is total.
ALTER TABLE "events" ALTER COLUMN "phase" DROP DEFAULT;--> statement-breakpoint
CREATE TYPE "public"."plan_phase_new" AS ENUM('collecting', 'moment', 'cleared', 'fizzled');--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "phase" TYPE "public"."plan_phase_new" USING "phase"::text::"public"."plan_phase_new";--> statement-breakpoint
DROP TYPE "public"."plan_phase";--> statement-breakpoint
ALTER TYPE "public"."plan_phase_new" RENAME TO "plan_phase";--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "phase" SET DEFAULT 'collecting';
