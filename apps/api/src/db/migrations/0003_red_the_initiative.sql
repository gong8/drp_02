CREATE TABLE "event_opt_outs" (
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "event_opt_outs_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lock_at" timestamp;--> statement-breakpoint
ALTER TABLE "event_opt_outs" ADD CONSTRAINT "event_opt_outs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_opt_outs" ADD CONSTRAINT "event_opt_outs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;