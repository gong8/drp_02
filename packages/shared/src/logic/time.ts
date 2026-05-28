import type { Activity, PartOfDay } from "../schemas.js";

const PART_HOUR: Record<PartOfDay, number> = { morning: 10, afternoon: 14, evening: 19 };

/** Resolve a loose (day, partOfDay) slot to a concrete local datetime. */
export function slotToDate(day: string, part: PartOfDay): Date {
  const d = new Date(day);
  d.setHours(PART_HOUR[part], 0, 0, 0);
  return d;
}

const DEFAULT_PLACE: Record<Activity, string> = {
  coffee: "a local café",
  food: "Pho House",
  gym: "the gym",
  study: "the library",
  drinks: "The Lighthouse",
  anything: "the usual spot",
};

export function defaultPlace(activity: Activity): string {
  return DEFAULT_PLACE[activity];
}

const HEADLINE: Record<Activity, string> = {
  coffee: "Coffee soon?",
  food: "Food tonight?",
  gym: "Gym session?",
  study: "Study together?",
  drinks: "Drinks?",
  anything: "Hang out?",
};

/** A warm, low-pressure headline for the moment, keyed by activity. */
export function headlineFor(activity: Activity): string {
  return HEADLINE[activity];
}
