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
