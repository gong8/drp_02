import { timingSafeEqual } from "node:crypto";

// Authorize a reseed request. Disabled (returns false) unless ADMIN_RESET_TOKEN is configured; then
// the provided token must match in constant time. Byte length is checked first because timingSafeEqual
// throws on unequal-length buffers; comparing String.length (UTF-16 code units) would not catch a
// same-code-unit-but-different-byte-length token (e.g. accented chars vs ASCII) and would throw.
export function isAuthorizedReset(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return false;
  if (typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
