// Cap the redo picker so a long-lived group's history stays usable. De-dup of repeated redos of the
// same activity is a possible future refinement, not done here (see the spec's "Risks / notes").
export const PAST_MEETUPS_LIMIT = 20;

// A cleared plan's row, reduced to the fields a redo needs. The router maps Drizzle rows into this so
// the shaping below stays pure and testable without a database.
export type PastMeetupInput = {
  id: string;
  activity: string;
  location: string;
  description: string | null;
  startsAt: Date;
  lockTimes: boolean;
};

// The clonable shell the client pre-fills the wizard from. Carries no time (always stale) and no RSVP
// data. The plan's NAME is its (won) `activity`; the wizard pre-fills that as a single locked activity,
// so a redo keeps the same thing - the creator just picks a new time. `activity` may be "" for a
// time-only plan that never named one; the redo card shows a fallback then.
export type PastMeetup = {
  id: string;
  activity: string;
  location: string;
  description: string | null;
  lockTimes: boolean;
  lastStartsAt: string;
};

// Shape cleared-plan rows into the redo list: most-recent-first, capped, mapped to the clonable shell.
export function shapePastMeetups(rows: PastMeetupInput[]): PastMeetup[] {
  return rows
    .slice()
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())
    .slice(0, PAST_MEETUPS_LIMIT)
    .map((r) => ({
      id: r.id,
      activity: r.activity.trim(),
      location: r.location,
      description: r.description,
      lockTimes: r.lockTimes,
      lastStartsAt: r.startsAt.toISOString(),
    }));
}
