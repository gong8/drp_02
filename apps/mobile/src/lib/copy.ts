// One vocabulary for the whole app. Every user-facing string that recurs (or used to recur in three
// different phrasings) lives here, so a plan is always a "meetup", and the privacy / deadline / error
// lines never drift between screens. Code-internal names (plan, candidate, react) are unchanged; this
// only governs what the user reads.

import type { StepKey } from "./redo";
import type { MyStatus } from "./status";

// The single decline phrase (drop "I"/"You're").
export const LABEL_CANT_MAKE_IT = "Can't make it";

// The two conditional-RSVP modes ("Go if these people are in"), labelled once so the segmented
// control's options and the mode-to-wire mapping in EventDetail stay in lockstep.
export const COND_MODE = { any: "At least one", all: "All of them" } as const;

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

// ----- M4 onboarding: invite + join + first-run (one voice across the new surfaces) -----

// Invite sheet (GroupDetail).
export const TITLE_INVITE = "Invite to group";
export const INVITE_HINT = "Anyone with the code can join.";
export const LABEL_JOIN_CODE = "Join code";
export const LABEL_INVITE_LINK = "Invite link";
export const ACTION_SHARE_INVITE = "Share invite";
export const ACTION_COPY = "Copy";
export const ACTION_COPIED = "Copied";
export const ACTION_LINK_COPIED = "Link copied";
export const INVITE_CODE_PENDING = "This group's code is on its way.";

// Join funnel (JoinGroup + the GroupsList paste sheet).
export const TITLE_JOIN = "Join a group";
export const ACTION_JOIN_WITH_CODE = "Join with a code";
export const JOIN_PROMPT_TITLE = "Got a code?";
export const JOIN_PROMPT_SUB = "Type or paste your group's join code.";
export const ACTION_FIND_GROUP = "Find group";
export const ACTION_JOIN = "Join";
export const ACTION_JOIN_GROUP = "Join group";
export const ACTION_JOINING = "Joining...";
export const ACTION_NOT_NOW = "Not now";
export const ACTION_BACK_TO_GROUPS = "Back to groups";
export const ACTION_TRY_AGAIN = "Try again";
export const JOIN_NOT_FOUND_TITLE = "Code not found";
export const JOIN_NOT_FOUND_BODY = "That code doesn't match a group. Check it and try again.";

// Zero-group onboarding (GroupsList empty state) + create-to-share.
export const ONBOARD_NO_GROUPS_TITLE = "No groups yet";
export const ONBOARD_NO_GROUPS_BODY =
  "Start a group and invite your people, or join one with a code.";
export const ACTION_CREATE_GROUP = "Create a group";
export const CREATE_GROUP_NEXT = "You'll get a link to share right after.";

// Editable display name (Account).
export const LABEL_DISPLAY_NAME = "Display name";
export const PLACEHOLDER_DISPLAY_NAME = "Your name";
export const NAME_HINT = "This is the name your groups see.";

// "12 members" / "1 member" - the join-confirm group-size line.
export function memberCountLabel(n: number): string {
  return `${n} ${plural(n, "member")}`;
}

// "Join The Boys?" - the join-confirm heading.
export function joinPrompt(name: string): string {
  return `Join ${name}?`;
}

// "You're in. Welcome to The Boys." - the one-time post-join welcome band.
export function welcomeToGroup(name: string): string {
  return `You're in. Welcome to ${name}.`;
}

// The OS-share / web-share body: `Join "The Boys" on BeThere.` (the URL is passed separately).
export function inviteShareText(name: string): string {
  return `Join "${name}" on BeThere.`;
}

// ----- DRP-56: meetup share link (the web-first conversion funnel) -----

// JoinMeetup public preview (shown BEFORE sign-in, when someone opens a /m/<token> link).
export const MEETUP_INVITE_TITLE = "You're invited";
export const MEETUP_NO_APP = "No app to download.";
export const MEETUP_PREVIEW_PICK_TIME = "Help pick a time";
export const ACTION_VIEW_MEETUP = "View the meetup";
export const ACTION_JOINING_MEETUP = "Joining...";
export const MEETUP_NOT_FOUND_TITLE = "Meetup not found";
export const MEETUP_NOT_FOUND_BODY = "This meetup link isn't valid anymore.";

// In-app-browser escape hatch (WhatsApp/Instagram/etc. block Google sign-in).
export const MEETUP_OPEN_IN_BROWSER_TITLE = "Open in your browser to join";
export const MEETUP_OPEN_IN_BROWSER_BODY =
  "Sign-in won't work inside this chat app. Open this link in Safari or Chrome to continue.";
export const ACTION_OPEN_IN_BROWSER = "Open in browser";
export const ACTION_COPY_LINK = "Copy link";

// Plan share sheet (EventDetail "Share this meetup").
export const TITLE_SHARE_MEETUP = "Share this meetup";
export const SHARE_MEETUP_HINT = "Anyone with the link can join and respond.";

// Post-response retention nudge (web only - web users get no notifications yet).
export const GET_APP_TITLE = "Get BeThere for reminders";
export const GET_APP_BODY = "We'll nudge you when it's your turn to vote or RSVP.";
export const ACTION_GET_APP = "Get the app";

// "Join The Boys & respond" - the single primary CTA on the public meetup preview.
export function joinAndRespond(groupName: string): string {
  return `Join ${groupName} & respond`;
}

// "You're invited to bowling" - the meetup preview headline once an activity is known. Falls back to
// the bare MEETUP_INVITE_TITLE when the activity is still blank (a collecting plan with no candidate).
export function meetupInviteHeadline(activity: string): string {
  const a = activity.trim();
  return a ? `You're invited to ${a}` : MEETUP_INVITE_TITLE;
}

// The OS-share / web-share body for a meetup: `bowling with The Boys - respond on BeThere.` (the URL
// rides separately). Falls back to the group when there is no activity name yet.
export function meetupShareText(activity: string, groupName: string): string {
  const a = activity.trim();
  return a ? `${a} with ${groupName} - respond on BeThere.` : `Respond to ${groupName} on BeThere.`;
}
