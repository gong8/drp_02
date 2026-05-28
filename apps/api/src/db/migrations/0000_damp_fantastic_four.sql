CREATE TYPE "public"."activity" AS ENUM('coffee', 'food', 'gym', 'study', 'drinks', 'anything');--> statement-breakpoint
CREATE TYPE "public"."moment_status" AS ENUM('open', 'cleared', 'fizzled');--> statement-breakpoint
CREATE TYPE "public"."response_kind" AS ENUM('yes', 'no', 'conditional');--> statement-breakpoint
CREATE TYPE "public"."suggestion_status" AS ENUM('collecting', 'fired', 'expired');--> statement-breakpoint
CREATE TABLE "availability" (
	"id" text PRIMARY KEY NOT NULL,
	"suggestion_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slots" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"last_met_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "moments" (
	"id" text PRIMARY KEY NOT NULL,
	"suggestion_id" text NOT NULL,
	"activity" "activity" NOT NULL,
	"proposed_time" timestamp NOT NULL,
	"proposed_place" text NOT NULL,
	"participant_ids" jsonb NOT NULL,
	"quorum" integer NOT NULL,
	"window_ends_at" timestamp NOT NULL,
	"status" "moment_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"moment_id" text NOT NULL,
	"activity" "activity" NOT NULL,
	"final_time" timestamp NOT NULL,
	"place" text NOT NULL,
	"confirmed_participant_ids" jsonb NOT NULL
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
CREATE TABLE "suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"by_user_id" text NOT NULL,
	"activity" "activity" NOT NULL,
	"text" text,
	"window_start" timestamp NOT NULL,
	"window_end" timestamp NOT NULL,
	"status" "suggestion_status" DEFAULT 'collecting' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"avatar_color" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moments" ADD CONSTRAINT "moments_suggestion_id_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_moment_id_moments_id_fk" FOREIGN KEY ("moment_id") REFERENCES "public"."moments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestions" ADD CONSTRAINT "suggestions_by_user_id_users_id_fk" FOREIGN KEY ("by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;