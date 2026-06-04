import { EMPTY_PREFILL, type PastMeetupShell, prefillFromMeetup, wizardSteps } from "./redo";

const shell: PastMeetupShell = {
  activity: "Bowling",
  lockTimes: true,
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

test("prefillFromMeetup preloads the won activity as a single locked chip, plus location and notes", () => {
  expect(prefillFromMeetup(shell)).toEqual({
    activityChips: ["Bowling"],
    lockTimes: true,
    lockActivity: true,
    location: "TenPin",
    description: "come at 6",
  });
});

test("prefillFromMeetup preloads nothing and leaves the lock off for a time-only past plan", () => {
  expect(prefillFromMeetup({ ...shell, activity: "  " })).toEqual({
    activityChips: [],
    lockTimes: true,
    lockActivity: false,
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
    lockActivity: false,
    location: "",
    description: "",
  });
});
