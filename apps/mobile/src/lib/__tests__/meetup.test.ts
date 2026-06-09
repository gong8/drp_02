// Unit tests for the mobile-local meetup-link helpers (apps/mobile/src/lib/meetup.ts). Unlike the
// invite helpers there is no shared counterpart to mirror - the meetup link is entirely client-side
// plumbing - so these pin the documented contract directly.

import {
  clearPendingMeetup,
  extractMeetupToken,
  getPendingMeetup,
  meetupUrl,
  setPendingMeetup,
} from "../meetup";

describe("extractMeetupToken", () => {
  it("pulls the token out of a /m/<token> URL", () => {
    expect(extractMeetupToken("https://bethere.app/m/e_abc123")).toBe("e_abc123");
    expect(extractMeetupToken("bethere://m/e_abc123")).toBe("e_abc123");
  });

  it("trims a trailing slash, query, or hash after the token", () => {
    expect(extractMeetupToken("https://bethere.app/m/e_abc123/")).toBe("e_abc123");
    expect(extractMeetupToken("https://bethere.app/m/e_abc123?utm=chat")).toBe("e_abc123");
    expect(extractMeetupToken("https://bethere.app/m/e_abc123#x")).toBe("e_abc123");
  });

  it("returns null for a non-meetup URL or an empty token", () => {
    expect(extractMeetupToken("https://bethere.app/join/ABCD2345")).toBeNull();
    expect(extractMeetupToken("https://bethere.app/")).toBeNull();
    expect(extractMeetupToken("https://bethere.app/m/")).toBeNull();
  });
});

describe("meetupUrl", () => {
  it("builds an /m/<token> path on the web origin", () => {
    expect(meetupUrl("e_abc123").endsWith("/m/e_abc123")).toBe(true);
  });
});

describe("pending meetup stash", () => {
  beforeEach(() => clearPendingMeetup());
  afterEach(() => clearPendingMeetup());

  it("round-trips set -> get -> clear", () => {
    expect(getPendingMeetup()).toBeNull();
    setPendingMeetup("e_abc123");
    expect(getPendingMeetup()).toBe("e_abc123");
    clearPendingMeetup();
    expect(getPendingMeetup()).toBeNull();
  });
});
