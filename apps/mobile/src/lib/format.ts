import type { PartOfDay } from "@bethere/shared";

// Zero-pad a small number to two digits ("3" -> "03"); shared by every time/date string builder.
const pad2 = (n: number) => String(n).padStart(2, "0");

// "...T16:00..." -> "16:00"
function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

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

// Date -> the picker's local "HH:mm" string (the forward of isoFrom's time half).
export function timeStringFrom(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ISO instant -> the picker's local { date, time } strings. The literal inverse of isoFrom.
export function splitIso(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return { date: dateStringFrom(d), time: timeStringFrom(d) };
}

// Date -> "Wed 4 Jun" short day label (shared by FloatBoard + DateTimeField).
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

// "2026-06-03T19:00..." -> "Wed 3 Jun, 19:00" - the compact label for a candidate slot.
export function formatSlot(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${formatTime(iso)}`;
}

// "2026-06-06T19:00..." -> "SAT 6 JUN" - the uppercase day line for the plan-detail time hero.
export function dayUpper(iso: string): string {
  const d = new Date(iso);
  return `${WEEKDAYS[d.getDay()].toUpperCase()} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toUpperCase()}`;
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
  const totalMins = Math.floor(ms / 60000);
  if (totalMins < 60) {
    const secs = Math.floor((ms % 60000) / 1000);
    return `${totalMins}:${pad2(secs)}`;
  }
  const hours = Math.floor(totalMins / 60);
  if (hours < 24) return `${hours}h ${pad2(totalMins % 60)}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
