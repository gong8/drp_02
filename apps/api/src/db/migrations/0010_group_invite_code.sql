-- M4 group onboarding: add a stable per-group invite code. Add the column nullable, backfill every
-- existing row with a deterministic code derived from its id (md5 mapped onto the no-confusable
-- alphabet, first 8 chars), then enforce NOT NULL + uniqueness. New groups get a crypto-random code
-- from the app at create time (see db/groups.ts freshInviteCode). md5(id) is unique per id, so the
-- mapped 8-char prefix is unique across rows with overwhelming probability.
ALTER TABLE "groups" ADD COLUMN "invite_code" text;--> statement-breakpoint
UPDATE "groups"
  SET "invite_code" = substr(translate(md5("id"), '0123456789abcdef', 'ABCDEFGH23456789'), 1, 8)
  WHERE "invite_code" IS NULL;--> statement-breakpoint
ALTER TABLE "groups" ALTER COLUMN "invite_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_invite_code_unique" UNIQUE("invite_code");
