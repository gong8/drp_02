// Quick-pick presets that prefill the date+time pickers, so the common plans skip the calendar
// entirely (Tom: "this Saturday evening", "tomorrow", "in two days"). Each pick is a picker-ready
// "YYYY-MM-DD" / "HH:mm" pair - byte-compatible with `isoFrom`. Pure given `now`, for testability.

export interface QuickPick {
  key: string;
  label: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
}

const EVENING_HOUR = 19;
const SAT_AFTERNOON_HOUR = 13;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A copy of `base` shifted by `addDays` and snapped to a whole hour.
function shift(base: Date, addDays: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// Days from `from` to the next given weekday (0=Sun..6=Sat); 0 when today already is that weekday.
function daysUntilWeekday(from: Date, weekday: number): number {
  return (weekday - from.getDay() + 7) % 7;
}

export function quickPicks(now: Date = new Date()): QuickPick[] {
  const picks: QuickPick[] = [];

  // "Tonight" only while the evening is still ahead.
  if (now.getHours() < EVENING_HOUR) {
    picks.push({ key: "tonight", label: "Tonight", ...split(shift(now, 0, EVENING_HOUR)) });
  }

  picks.push({ key: "tomorrow", label: "Tomorrow eve", ...split(shift(now, 1, EVENING_HOUR)) });

  const satDays = daysUntilWeekday(now, 6);
  picks.push({ key: "sat", label: "This Sat", ...split(shift(now, satDays, SAT_AFTERNOON_HOUR)) });
  picks.push({ key: "sat-eve", label: "Sat eve", ...split(shift(now, satDays, EVENING_HOUR)) });

  picks.push({ key: "next-week", label: "Next week", ...split(shift(now, 7, EVENING_HOUR)) });

  return picks;
}

function split(d: Date): { date: string; time: string } {
  return { date: ymd(d), time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}
