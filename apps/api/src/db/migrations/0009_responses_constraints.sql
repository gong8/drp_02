-- Harden the responses table (code-review fixes):
--   1. A unique index on (event_id, user_id) so a member can never hold two commitments for one
--      plan. The respond handler replaces by delete-then-insert; the index turns a racing double
--      insert into a clean failure instead of duplicate rows that skew the tally/reveal.
--   2. A foreign key on user_id -> users.id, matching every other user-referencing table
--      (group_members, candidate_reactions, event_opt_outs); responses was the lone exception.
-- Both are additive and safe under SEED_ON_BOOT=if-empty (seed/respond data has no dupes).
CREATE UNIQUE INDEX "responses_event_user_unique" ON "responses" ("event_id","user_id");--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
