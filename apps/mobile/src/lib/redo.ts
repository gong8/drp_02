// The wizard's pre-fillable state when starting a meetup FROM a past one (or fresh). The time is never
// carried (always stale). The plan's NAME is its activity, which rides in the activity list - so there
// is no separate name field to carry.
export type Prefill = {
  activityChips: string[];
  lockTimes: boolean;
  lockActivity: boolean;
  location: string;
  description: string;
};

// The "Start fresh" baseline: an empty wizard.
export const EMPTY_PREFILL: Prefill = {
  activityChips: [],
  lockTimes: false,
  lockActivity: false,
  location: "",
  description: "",
};

// The shape we pre-fill from. A structural subset of the events.pastForGroup row, declared here so this
// module stays free of the trpc client (keeps it pure and unit-testable). The screen passes the trpc
// result, which is structurally compatible.
export type PastMeetupShell = {
  activity: string;
  lockTimes: boolean;
  location: string;
  description: string | null;
};

// Map a chosen past meetup into the wizard's pre-fill state. The plan's name (its won activity) is
// preloaded as a single activity and the activity lock is pre-ticked, so a redo keeps the same thing
// by default - the creator just picks a new time (and can untick the lock to reopen it to a vote). A
// time-only past plan (no named activity) preloads nothing and leaves the lock off.
export function prefillFromMeetup(m: PastMeetupShell): Prefill {
  const activity = m.activity.trim();
  const hasActivity = activity !== "";
  return {
    activityChips: hasActivity ? [activity] : [],
    lockTimes: m.lockTimes,
    lockActivity: hasActivity,
    location: m.location,
    description: m.description ?? "",
  };
}

// The wizard steps. The "source" step (start fresh vs use a previous meetup) appears only when the
// chosen group has past meetups. "details" (location + notes) and "deadlines" (decides-by + reply-by)
// are separate screens - they are unrelated concerns that were cramped onto one step before.
export type StepKey =
  | "group"
  | "source"
  | "activities"
  | "times"
  | "details"
  | "deadlines"
  | "confirm";

export function wizardSteps(hasPast: boolean): StepKey[] {
  const STEPS: StepKey[] = [
    "group",
    "source",
    "activities",
    "times",
    "details",
    "deadlines",
    "confirm",
  ];
  return STEPS.filter((s) => s !== "source" || hasPast);
}
