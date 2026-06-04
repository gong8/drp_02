import { EMPTY_PREFILL, type PastMeetupShell, prefillFromMeetup, wizardSteps } from "./redo";

const shell: PastMeetupShell = {
  activityCandidates: ["bowling", "the pub"],
  lockTimes: true,
  lockThings: false,
  location: "TenPin",
  description: "come at 6",
};

test("wizardSteps inserts the source step only when there is past history", () => {
  expect(wizardSteps(false)).toEqual(["group", "activities", "times", "options", "confirm"]);
  expect(wizardSteps(true)).toEqual([
    "group",
    "source",
    "activities",
    "times",
    "options",
    "confirm",
  ]);
});

test("prefillFromMeetup carries activities, locks, location, and notes", () => {
  expect(prefillFromMeetup(shell)).toEqual({
    activityChips: ["bowling", "the pub"],
    lockTimes: true,
    lockThings: false,
    location: "TenPin",
    description: "come at 6",
  });
});

test("prefillFromMeetup maps a null description to an empty string", () => {
  expect(prefillFromMeetup({ ...shell, description: null }).description).toBe("");
});

test("EMPTY_PREFILL is the start-fresh baseline", () => {
  expect(EMPTY_PREFILL).toEqual({
    activityChips: [],
    lockTimes: false,
    lockThings: false,
    location: "",
    description: "",
  });
});
