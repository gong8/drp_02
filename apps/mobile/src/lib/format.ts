import type { PartOfDay } from "@bethere/shared";
import { plural } from "./copy";

// Zero-pad a small number to two digits ("3" -> "03"); shared by every time/date string builder.
const pad2 = (n: number) => String(n).padStart(2, "0");

// Millisecond magnitudes, single-sourced so every countdown/duration surface shares one set.
const SEC_MS = 1000;
const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Build a UTC ISO instant from the picker's local "YYYY-MM-DD" + "HH:mm" strings. Uses the numeric
// Date constructor (always local time, in every engine) rather than `new Date("YYYY-MM-DDTHH:mm")`:
// a string with no offset is parsed as UTC by Hermes (React Native), which lands times an hour off
// in zones like BST. null until both parts are present and valid.
export function isoFrom(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  const dt = new Date(y, mo - 1, d, h, mi, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

// Date -> the picker's local "YYYY-MM-DD" string (the forward of isoFrom's date half).
export function dateStringFrom(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// Parse the picker's local "YYYY-MM-DD" -> noon-anchored Date (the inverse of dateStringFrom).
// Numeric constructor, never `new Date(string)`: a string with no offset parses as UTC in Hermes.
// Noon-anchored to dodge DST midnight edges. null when any component is missing or non-numeric.
export function parseLocalDate(value: string): Date | null {
  const [y, mo, d] = value.split("-").map(Number);
  if ([y, mo, d].some((n) => Number.isNaN(n))) return null;
  return new Date(y, mo - 1, d, 12, 0, 0, 0);
}

// Parse the picker's local "HH:mm" -> today-anchored Date (the inverse of timeStringFrom).
// Numeric components only (always local), never `new Date(string)`. null when invalid.
export function parseLocalTime(value: string): Date | null {
  const [h, mi] = value.split(":").map(Number);
  if ([h, mi].some((n) => Number.isNaN(n))) return null;
  const t = new Date();
  t.setHours(h, mi, 0, 0);
  return t;
}

// Date -> the picker's local "HH:mm" string (the forward of isoFrom's time half).
export function timeStringFrom(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ISO instant -> the picker's local { date, time } strings. The literal inverse of isoFrom.
export function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: dateStringFrom(d), time: timeStringFrom(d) };
}

// Date -> "Wed 4 Jun" short day label (used by DateTimeField).
export function shortDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const AVATAR_COLORS = ["#5F9472", "#C9823F", "#7E6BB0", "#3F7BA8", "#B0654F"] as const;

// Deterministic avatar colour from an id, so a group reads as a distinct circle.
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Shared "Wed 3 Jun" day label - the weekday/day/month half of every slot string.
const dayLabel = (d: Date) =>
  `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

// "2026-06-03T19:00..." -> "Wed 3 Jun, 19:00" - the compact label for a candidate slot.
export function formatSlot(iso: string): string {
  const d = new Date(iso);
  return `${dayLabel(d)}, ${timeStringFrom(d)}`;
}

// "2026-06-06T19:00..." -> "SAT 6 JUN" - the uppercase day line for the plan-detail time hero.
export function dayUpper(iso: string): string {
  const d = new Date(iso);
  return dayLabel(d).toUpperCase();
}

// "...T19:00..." -> { time: "7:00", ampm: "PM" } - 12-hour clock split for the time hero.
export function clock12(iso: string): { time: string; ampm: string } {
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h < 12 ? "AM" : "PM";
  h %= 12;
  if (h === 0) h = 12;
  return { time: `${h}:${pad2(d.getMinutes())}`, ampm };
}

// "evening" -> "Evening".
export function partOfDayLabel(part: PartOfDay | null | undefined): string {
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1);
}

// A live moment countdown: "12:34" under an hour, "3h 04m" / "2d 3h" beyond. Empty once passed.
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalMins = Math.floor(ms / MIN_MS);
  if (totalMins < 60) {
    const secs = Math.floor((ms % MIN_MS) / SEC_MS);
    return `${totalMins}:${pad2(secs)}`;
  }
  const hours = Math.floor(totalMins / 60);
  if (hours < 24) return `${hours}h ${pad2(totalMins % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

// A bare, verbose duration phrase for the largest whole unit: "2 days", "1 hour", "23 minutes",
// "under a minute". Returns the duration ALONE (no "left"/"in") so callers compose phase-aware copy,
// e.g. `${label} in ${formatTimeLeft(ms)}` -> "Voting closes in 2 days". Callers special-case the
// passed `ms <= 0` themselves to render "Closing now" (this returns the bare "now").
export function formatTimeLeft(ms: number): string {
  if (ms <= 0) return "now";
  if (ms >= DAY_MS) {
    const n = Math.floor(ms / DAY_MS);
    return `${n} ${plural(n, "day")}`;
  }
  if (ms >= HOUR_MS) {
    const n = Math.floor(ms / HOUR_MS);
    return `${n} ${plural(n, "hour")}`;
  }
  if (ms >= MIN_MS) {
    const n = Math.floor(ms / MIN_MS);
    return `${n} ${plural(n, "minute")}`;
  }
  return "under a minute";
}

// The "under an hour is hot" threshold, shared by every countdown surface.
export const HOT_MS = HOUR_MS;

// The standalone time-left phrase shared by the Countdown primitive and the dashboard card footer:
// "Closing now" once passed, else "<duration> left". One home for the terminal string + wording.
export function countdownLabel(ms: number): string {
  return ms <= 0 ? "Closing now" : `${formatTimeLeft(ms)} left`;
}
