// One vocabulary for the whole app. Every user-facing string that recurs (or used to recur in three
// different phrasings) lives here, so the verb for +1'ing is always "vote", a plan is always a
// "meetup", and the privacy / deadline / error lines never drift between screens. Code-internal names
// (plan, candidate, react) are unchanged; this only governs what the user reads.

import type { StepKey } from "./redo";
import type { MyStatus } from "./status";

// The single verb for reacting to a candidate (banner already says "Voting closes").
export const VERB_VOTE = "Vote";
export const VERB_VOTED = "Voted";

// The single decline phrase (drop "I"/"You're").
export const LABEL_CANT_MAKE_IT = "Can't make it";

// Deadline labels, paired with the phase field in status.activeDeadline.
export const DEADLINE_VOTING = "Voting closes";
export const DEADLINE_RSVP = "RSVP closes";

// One- to two-word tags shared by the create preview and the live banners, so they speak identically.
export const NOTE_TOP_PICK = "Top pick wins";
export const NOTE_BLIND = "Blind";

// The privacy disclaimer, said once.
export const NO_NAMES = "No names, just the group.";

// The anonymity note on the create flow's "Ready to send?" screen - a small uppercase tag + a
// plain-English reassurance that the suggestion never shows as coming from the creator.
export const ANON_SEND_TITLE = "Sent anonymously";
export const ANON_SEND_BODY =
  "The group sees the meetup, never that it came from you. No names, ever.";

// Two canonical error strings: a fetch failure vs a mutation failure.
export const ERR_NETWORK = "Couldn't reach the server.";
export const ERR_SAVE = "Couldn't save. Try again.";

// "didn't come together" used by both the dashboard footer and the fizzled card title.
export const DIDNT_COME_TOGETHER = "Didn't come together";

// The one count-suffix primitive: "1 option" -> singular, anything else -> pluralForm (default +"s").
// Every counted label in the app routes through this so the suffix rule lives in one place.
export function plural(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

// "3 options" - the terse candidate count (replaces "3 on the table").
export function candidateCountLabel(n: number): string {
  return `${n} ${plural(n, "option")}`;
}

// "2 actions required" - the dashboard's action-section header count.
export function actionsRequiredLabel(n: number): string {
  return `${n} ${plural(n, "action")} required`;
}

// A plan's display name: its activity, else just the group name (stays consistent with the NO_NAMES
// privacy wording - no creator, no title, just the meetup or the group).
export function planLabel(e: { activity: string | null; groupName: string }): string {
  return e.activity || e.groupName;
}

// "3 going".
export function goingCountLabel(n: number): string {
  return `${n} going`;
}

// The going/declined/awaiting -> short label map, shared by the detail status line and any pill.
export function statusLabel(s: MyStatus): string {
  switch (s) {
    case "going":
      return "You're in";
    case "declined":
      return LABEL_CANT_MAKE_IT;
    default:
      return "Awaiting you";
  }
}

// Wizard step titles + subs, keyed by the step key from lib/redo.ts. Terse; one table = one voice.
export const STEP_COPY: Record<StepKey, { title: string; sub?: string }> = {
  group: { title: "Who's it for?" },
  source: { title: "Start from", sub: "Reuse a past meetup, or start fresh." },
  activities: { title: "What do you fancy?", sub: "Optional - the group can add more." },
  times: { title: "When could it be?", sub: "Optional - the group votes." },
  details: { title: "Where & notes", sub: "All optional." },
  deadlines: { title: "Deadlines", sub: "When voting and replies close." },
  confirm: { title: "Ready to send?" },
};

// Recurring screen titles + labels (>=2 screens each).
export const TITLE_NEW_MEETUP = "New meetup";
export const TITLE_NEW_GROUP = "New group";
export const LABEL_GROUP_NAME = "Group name";
