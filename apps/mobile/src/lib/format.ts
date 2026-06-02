const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

// "2026-05-28T16:00:00.000Z" -> "28th May 2026"
export function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${ordinal(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// "...T16:00..." -> "16:00"
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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

// A stable per-day key for grouping a list of events under date headers.
export function dateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Time remaining until `iso`, e.g. "8h 49m" or "3d 4h". Empty once passed.
export function countdown(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / (60 * 24));
  const hours = Math.floor((mins % (60 * 24)) / 60);
  const m = mins % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${m}m`;
  return `${m}m`;
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
  return { time: `${h}:${String(d.getMinutes()).padStart(2, "0")}`, ampm };
}

// "evening" -> "Evening".
export function partOfDayLabel(part: string | null | undefined): string {
  if (!part) return "";
  return part.charAt(0).toUpperCase() + part.slice(1);
}

// A live moment countdown: "12:34" under an hour, "3h 04m" / "2d 3h" beyond. Empty once passed.
export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const totalMins = Math.floor(ms / 60000);
  if (totalMins < 60) {
    const secs = Math.floor((ms % 60000) / 1000);
    return `${totalMins}:${String(secs).padStart(2, "0")}`;
  }
  const hours = Math.floor(totalMins / 60);
  if (hours < 24) return `${hours}h ${String(totalMins % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}
