-- Add the editable "reply by" deadline: when the blind yes/no/"I'll go if" window closes, then the
-- plan reveals who's in and resolves. Nullable; the API defaults it (one-day-capped from the lock,
-- to the event) when the creator leaves it unset. Additive, safe under SEED_ON_BOOT=if-empty.
ALTER TABLE "events" ADD COLUMN "reply_by" timestamp;
