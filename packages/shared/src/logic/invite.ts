// Group invite codes. A plan/group's join code is the surface-agnostic primitive behind M4
// onboarding: the same code joins a group from a tapped web link, a typed entry, or (later) a
// native deep link. These helpers are pure strings so the mobile client (display + entry) and the
// API (generation) agree on exactly what a valid code looks like. Generation itself lives in the
// API (it needs a crypto RNG + a DB uniqueness check); everything here is portable.

// The code alphabet, deliberately free of visually confusable characters (no 0/1/I/L/O/U) so a code
// survives being read aloud, handwritten, or retyped. 30 symbols ^ 8 chars is a large enough space
// that guessing another group's code is impractical.
export const INVITE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_LENGTH = 8;

// Normalize user input into the canonical lookup form: drop spaces/dashes/punctuation and uppercase.
// A pasted "abcd-ef12 " becomes "ABCDEF12". Characters outside the alphabet are kept (not silently
// dropped) so a genuine typo yields a clean "no match" rather than a mangled accidental hit.
export function normalizeInviteCode(raw: string): string {
  return raw.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

// Group a code for display as two readable quads: "ABCD-EF12". Shorter codes are returned as-is.
export function formatInviteCode(code: string): string {
  const c = code.toUpperCase();
  if (c.length <= 4) return c;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
