CREATE TYPE "public"."part_of_day" AS ENUM('morning', 'afternoon', 'evening', 'late');--> statement-breakpoint
CREATE TYPE "public"."plan_phase" AS ENUM('collecting', 'moment', 'cleared', 'fizzled');--> statement-breakpoint
CREATE TYPE "public"."when_mode" AS ENUM('exact', 'options', 'fuzzy');--> statement-breakpoint
CREATE TABLE "candidate_reactions" (
	"event_id" text NOT NULL,
	"candidate_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "candidate_reactions_candidate_id_user_id_pk" PRIMARY KEY("candidate_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "event_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"starts_at" timestamp NOT NULL,
	"part_of_day" "part_of_day",
	"label" text
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "when_mode" "when_mode" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "contingent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "quorum" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "phase" "plan_phase" DEFAULT 'collecting' NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "chosen_candidate_id" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "moment_starts_at" timestamp;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "moment_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "candidate_reactions" ADD CONSTRAINT "candidate_reactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_reactions" ADD CONSTRAINT "candidate_reactions_candidate_id_event_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."event_candidates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_reactions" ADD CONSTRAINT "candidate_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_candidates" ADD CONSTRAINT "event_candidates_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;