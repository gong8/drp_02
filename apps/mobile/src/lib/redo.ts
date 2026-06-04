// The wizard's pre-fillable state when starting a meetup FROM a past one (or fresh). The time is never
// carried (always stale). The title IS carried so a redo keeps the plan's name (editable); it may be
// blank, in which case the server re-derives it from the winning activity at lock, as for a fresh plan.
export type Prefill = {
  title: string;
  activityChips: string[];
  lockTimes: boolean;
  lockThings: boolean;
  location: string;
  description: string;
};

// The "Start fresh" baseline: an empty wizard.
export const EMPTY_PREFILL: Prefill = {
  title: "",
  activityChips: [],
  lockTimes: false,
  lockThings: false,
  location: "",
  description: "",
};

// The shape we pre-fill from. A structural subset of the events.pastForGroup row, declared here so this
// module stays free of the trpc client (keeps it pure and unit-testable). The screen passes the trpc
// result, which is structurally compatible.
export type PastMeetupShell = {
  title: string;
  activityCandidates: string[];
  lockTimes: boolean;
  lockThings: boolean;
  location: string;
  description: string | null;
};

// Map a chosen past meetup into the wizard's pre-fill state.
export function prefillFromMeetup(m: PastMeetupShell): Prefill {
  return {
    title: m.title,
    activityChips: m.activityCandidates,
    lockTimes: m.lockTimes,
    lockThings: m.lockThings,
    location: m.location,
    description: m.description ?? "",
  };
}

// The wizard steps. The "source" step (start fresh vs use a previous meetup) appears only when the
// chosen group has past meetups; otherwise the wizard is exactly as it was before redo.
export function wizardSteps(hasPast: boolean): string[] {
  return hasPast
    ? ["group", "source", "activities", "times", "options", "confirm"]
    : ["group", "activities", "times", "options", "confirm"];
}
