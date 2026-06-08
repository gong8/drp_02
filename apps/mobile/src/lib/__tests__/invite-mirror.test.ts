// Pins the mobile-local invite mirror (apps/mobile/src/lib/invite.ts) against the canonical shared
// helpers in packages/shared/src/logic/invite.ts. The mobile copy exists because Metro cannot value-
// import the shared ESM barrel (the `.js` re-exports do not resolve in the bundler); mobile consumes
// shared as TYPES only. Jest, however, CAN load the shared file directly by relative path (no barrel,
// no `.js` re-exports in invite.ts), so this test compares the two implementations side by side. If a
// future edit changes one copy and not the other, the drift assertions here fail loudly. Same pattern
// as lock-mirror.test.ts.
//
// The names diverge across packages (mobile CODE_LENGTH / normalizeCode vs shared INVITE_CODE_LENGTH /
// normalizeInviteCode) so a grep on one will not surface the other - this test is the thing that ties
// the pair together. The mobile copy is a documented SUPERSET of the shared contract: it also extracts
// a code out of a ".../join/CODE" URL and caps at CODE_LENGTH (see invite.ts lines 22-25), which the
// server-side shared helper deliberately does not. We therefore assert agreement only on the shared
// contract domain (non-URL, <= length payload) and assert the mobile-only superset behavior separately
// as a tested contract - not by blindly equating the two modules.

import * as sharedInvite from "../../../../../packages/shared/src/logic/invite";
import * as mobileInvite from "../invite";

// Spec value: a complete code is 8 characters.
const SPEC_CODE_LENGTH = 8;

describe("invite mirror: exported constants match the spec and the shared copy", () => {
  it("CODE_LENGTH is 8 and equals the shared INVITE_CODE_LENGTH", () => {
    expect(mobileInvite.CODE_LENGTH).toBe(SPEC_CODE_LENGTH);
    expect(mobileInvite.CODE_LENGTH).toBe(sharedInvite.INVITE_CODE_LENGTH);
  });
});

describe("formatCode (mobile mirror, display-only helper)", () => {
  // formatCode is a mobile-only presentation helper (the server never groups a code for display), so
  // there is no shared counterpart to equate it with; we pin its documented contract directly. It
  // uppercases and, for inputs longer than 4 chars, groups as ABCD-<rest>; <= 4 is returned as-is.
  it("returns inputs of 4 or fewer chars uppercased and ungrouped", () => {
    expect(mobileInvite.formatCode("")).toBe("");
    expect(mobileInvite.formatCode("AB")).toBe("AB");
    expect(mobileInvite.formatCode("ABCD")).toBe("ABCD");
  });

  it("groups inputs longer than 4 chars as ABCD-<rest> and uppercases lowercase input", () => {
    expect(mobileInvite.formatCode("ABCDEF12")).toBe("ABCD-EF12");
    expect(mobileInvite.formatCode("abcdef12")).toBe("ABCD-EF12");
    expect(mobileInvite.formatCode("23456789")).toBe("2345-6789");
  });
});

describe("normalizeCode (mobile mirror)", () => {
  // The shared contract domain: inputs WITHOUT a "/join/" URL and at or under CODE_LENGTH payload
  // chars. On this domain the mobile copy must agree exactly with the canonical shared helper.
  const SHARED_DOMAIN = ["", "abcdef12", "ABCD-EF12", " abcd ef12 ", "ab cd"];

  it("agrees with the shared normalizeInviteCode on the shared contract domain", () => {
    for (const input of SHARED_DOMAIN) {
      expect(mobileInvite.normalizeCode(input)).toBe(sharedInvite.normalizeInviteCode(input));
    }
  });

  // The documented mobile-only superset (invite.ts lines 22-25), asserted explicitly so the
  // divergence is a tested contract, not an accident.
  it("extracts the code from a /join/CODE URL, which shared deliberately does not", () => {
    expect(mobileInvite.normalizeCode("https://bethere.app/join/ABCD-EF12")).toBe("ABCDEF12");
    // Shared keeps the host chars (no URL extraction), so it does NOT yield the bare code.
    expect(sharedInvite.normalizeInviteCode("https://bethere.app/join/ABCDEF12")).not.toBe(
      "ABCDEF12",
    );
  });

  it("caps the result at CODE_LENGTH, while shared returns the full uppercased run uncapped", () => {
    const overLength = "ABCDEF1234567";
    expect(mobileInvite.normalizeCode(overLength).length).toBe(mobileInvite.CODE_LENGTH);
    // Shared does not cap: it returns the whole uppercased run.
    expect(sharedInvite.normalizeInviteCode(overLength)).toBe("ABCDEF1234567");
    expect(sharedInvite.normalizeInviteCode(overLength).length).toBeGreaterThan(
      mobileInvite.CODE_LENGTH,
    );
  });
});

describe("invite mirror: the public API the mirror is contracted to provide", () => {
  it("exposes CODE_LENGTH, formatCode, and normalizeCode (names intentionally differ from shared)", () => {
    // The mobile names (CODE_LENGTH/formatCode/normalizeCode) deliberately differ from the shared
    // names (INVITE_CODE_LENGTH/normalizeInviteCode); this guard documents that divergence as intended
    // rather than drift. formatCode has no shared counterpart - it is a mobile-only display helper.
    expect("CODE_LENGTH" in mobileInvite).toBe(true);
    expect(typeof mobileInvite.formatCode).toBe("function");
    expect(typeof mobileInvite.normalizeCode).toBe("function");
    expect("INVITE_CODE_LENGTH" in sharedInvite).toBe(true);
    expect(typeof sharedInvite.normalizeInviteCode).toBe("function");
  });
});
