import { timingSafeEqual } from "node:crypto";

// Authorize a reseed request. Disabled (returns false) unless ADMIN_RESET_TOKEN is configured; then
// the provided token must match in constant time. Length is checked first because timingSafeEqual
// throws on unequal-length buffers.
export function isAuthorizedReset(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
