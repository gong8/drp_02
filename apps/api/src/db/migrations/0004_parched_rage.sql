CREATE TYPE "public"."float_axis" AS ENUM('idea', 'time');--> statement-breakpoint
ALTER TYPE "public"."plan_phase" ADD VALUE 'floating';--> statement-breakpoint
CREATE TABLE "float_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"axis" "float_axis" NOT NULL,
	"text" text,
	"part_of_day" "part_of_day",
	"starts_at" timestamp,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "float_votes" (
	"event_id" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "float_votes_suggestion_id_user_id_pk" PRIMARY KEY("suggestion_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "is_anonymous" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "min_heat" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "float_suggestions" ADD CONSTRAINT "float_suggestions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_suggestions" ADD CONSTRAINT "float_suggestions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_votes" ADD CONSTRAINT "float_votes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_votes" ADD CONSTRAINT "float_votes_suggestion_id_float_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."float_suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "float_votes" ADD CONSTRAINT "float_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;