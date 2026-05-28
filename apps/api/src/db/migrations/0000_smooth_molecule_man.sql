CREATE TYPE "public"."activity" AS ENUM('coffee', 'food', 'gym', 'study', 'drinks', 'anything');--> statement-breakpoint
CREATE TYPE "public"."moment_status" AS ENUM('open', 'cleared', 'fizzled');--> statement-breakpoint
CREATE TYPE "public"."response_kind" AS ENUM('yes', 'no', 'conditional');--> statement-breakpoint
CREATE TABLE "moments" (
	"id" text PRIMARY KEY NOT NULL,
	"activity" "activity" NOT NULL,
	"title" text NOT NULL,
	"place" text NOT NULL,
	"detail" text NOT NULL,
	"participant_ids" jsonb NOT NULL,
	"quorum" integer NOT NULL,
	"status" "moment_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" text PRIMARY KEY NOT NULL,
	"moment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" "response_kind" NOT NULL,
	"cond" jsonb
);
--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE no action ON UPDATE no action;