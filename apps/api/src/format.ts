const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** e.g. "Thu · 7:00pm" — server-side so the client receives a ready string. */
export function formatWhen(date: Date): string {
  const day = DAYS[date.getDay()];
  let h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12 || 12;
  return `${day} · ${h}:${String(m).padStart(2, "0")}${ampm}`;
}
