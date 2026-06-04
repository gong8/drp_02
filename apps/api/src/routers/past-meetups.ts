// Cap the redo picker so a long-lived group's history stays usable. De-dup of repeated redos of the
// same activity is a possible future refinement, not done here (see the spec's "Risks / notes").
export const PAST_MEETUPS_LIMIT = 20;

// A clone is sent through events.create, whose CreateEventInput caps activityCandidates at 10. An open
// plan can collect more than that, so cap the cloned list to stay within the create bound.
export const MAX_CLONE_ACTIVITIES = 10;

// A cleared plan's row, reduced to the fields a redo needs. The router maps Drizzle rows into this so
// the shaping below stays pure and testable without a database.
export type PastMeetupInput = {
  id: string;
  title: string;
  location: string;
  description: string | null;
  startsAt: Date;
  lockTimes: boolean;
  lockThings: boolean;
  activityLabels: string[];
};

// The clonable shell the client pre-fills the wizard from. Carries no time (always stale) and no RSVP
// data. `title` is the plan's raw resolved title (may be ""); the client both prefills it and shows a
// fallback when blank - keeping the placeholder out of the cloned title field.
export type PastMeetup = {
  id: string;
  title: string;
  location: string;
  description: string | null;
  activityCandidates: string[];
  lockTimes: boolean;
  lockThings: boolean;
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
      title: r.title.trim(),
      location: r.location,
      description: r.description,
      activityCandidates: r.activityLabels.slice(0, MAX_CLONE_ACTIVITIES),
      lockTimes: r.lockTimes,
      lockThings: r.lockThings,
      lastStartsAt: r.startsAt.toISOString(),
    }));
}
