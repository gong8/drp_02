import type { PartOfDay, Timescale } from "../schemas.js";

// A rough time-of-day band resolves to a concrete local hour for the proposed slot.
export const PART_HOUR: Record<PartOfDay, number> = {
  morning: 10,
  afternoon: 14,
  evening: 19,
  late: 22,
};

export interface WindowSlot {
  startsAt: string; // ISO datetime
  partOfDay: PartOfDay;
}

function atBand(day: Date, band: PartOfDay): Date {
  const d = new Date(day);
  d.setHours(PART_HOUR[band], 0, 0, 0);
  return d;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Expand a loose window (timescale + band) into the concrete day candidates people react to.
 * `fromMs` is "now", passed in so this stays pure and testable. Slots whose band hour has already
 * passed are dropped so we never propose a time that is already gone; if that empties the slate
 * (e.g. "tonight" asked after the band hour), we keep the first day so the plan is never empty.
 */
export function expandWindow(timescale: Timescale, band: PartOfDay, fromMs: number): WindowSlot[] {
  const today = new Date(fromMs);
  today.setHours(0, 0, 0, 0);

  let days: Date[] = [];
  if (timescale === "tonight") {
    days = [today];
  } else if (timescale === "this_week") {
    days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  } else if (timescale === "next_two_weeks") {
    days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  } else {
    // this_weekend: the upcoming Saturday + Sunday (today onward if it is already the weekend).
    const dow = today.getDay(); // 0 Sun .. 6 Sat
    const toSat = (6 - dow + 7) % 7;
    const sat = addDays(today, toSat);
    days = [sat, addDays(sat, 1)];
  }

  const slots: WindowSlot[] = [];
  for (const day of days) {
    const at = atBand(day, band);
    if (at.getTime() < fromMs) continue;
    slots.push({ startsAt: at.toISOString(), partOfDay: band });
  }
  if (slots.length === 0) {
    // Every slot in the window has already passed: roll forward to the next occurrence of the band
    // so we still never propose a time that is already gone.
    let d = days[days.length - 1] ?? new Date(fromMs);
    for (let i = 0; i < 14; i++) {
      d = addDays(d, 1);
      const at = atBand(d, band);
      if (at.getTime() >= fromMs) {
        slots.push({ startsAt: at.toISOString(), partOfDay: band });
        break;
      }
    }
  }
  return slots;
}
