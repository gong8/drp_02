// Milliseconds left until a nullable deadline, clamped at zero (a passed deadline reads as 0, an
// absent one as null). Single source for the countdown fields the plan reads project.
export function msLeft(d: Date | null): number | null {
  return d ? Math.max(0, d.getTime() - Date.now()) : null;
}
