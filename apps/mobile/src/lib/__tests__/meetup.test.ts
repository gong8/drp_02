// Unit tests for the mobile-local meetup-link helpers (apps/mobile/src/lib/meetup.ts). Unlike the
// invite helpers there is no shared counterpart to mirror - the meetup link is entirely client-side
// plumbing - so these pin the documented contract directly.

import {
  clearPendingMeetup,
  extractMeetupToken,
  extractMeetupVia,
  getPendingMeetup,
  meetupUrl,
  setPendingMeetup,
} from "../meetup";

describe("extractMeetupToken", () => {
  it("pulls the token out of a /m/<token> URL", () => {
    expect(extractMeetupToken("https://bethere-beta.vercel.app/m/e_abc123")).toBe("e_abc123");
    expect(extractMeetupToken("bethere://m/e_abc123")).toBe("e_abc123");
  });

  it("trims a trailing slash, query, or hash after the token", () => {
    expect(extractMeetupToken("https://bethere-beta.vercel.app/m/e_abc123/")).toBe("e_abc123");
    expect(extractMeetupToken("https://bethere-beta.vercel.app/m/e_abc123?utm=chat")).toBe(
      "e_abc123",
    );
    expect(extractMeetupToken("https://bethere-beta.vercel.app/m/e_abc123#x")).toBe("e_abc123");
  });

  it("returns null for a non-meetup URL or an empty token", () => {
    expect(extractMeetupToken("https://bethere-beta.vercel.app/join/ABCD2345")).toBeNull();
    expect(extractMeetupToken("https://bethere-beta.vercel.app/")).toBeNull();
    expect(extractMeetupToken("https://bethere-beta.vercel.app/m/")).toBeNull();
  });
});

describe("extractMeetupVia", () => {
  it("pulls the sharer ref off a meetup link's query", () => {
    expect(extractMeetupVia("https://bethere-beta.vercel.app/m/e_abc123?via=u_1")).toBe("u_1");
    expect(extractMeetupVia("https://bethere-beta.vercel.app/m/e_abc123?utm=chat&via=u_1#x")).toBe(
      "u_1",
    );
  });

  it("decodes a percent-encoded value", () => {
    expect(extractMeetupVia("https://bethere-beta.vercel.app/m/e_abc?via=u%5F1")).toBe("u_1");
  });

  it("returns null off a non-meetup link, an absent param, or a blank value", () => {
    expect(extractMeetupVia("https://bethere-beta.vercel.app/join/ABCD2345?via=u_1")).toBeNull();
    expect(extractMeetupVia("https://bethere-beta.vercel.app/m/e_abc123")).toBeNull();
    expect(extractMeetupVia("https://bethere-beta.vercel.app/m/e_abc123?via=")).toBeNull();
  });
});

describe("meetupUrl", () => {
  it("builds an /m/<token> path on the web origin", () => {
    expect(meetupUrl("e_abc123").endsWith("/m/e_abc123")).toBe(true);
  });

  it("carries the sharer ref when given (and encodes it)", () => {
    expect(meetupUrl("e_abc123", "u_1").endsWith("/m/e_abc123?via=u_1")).toBe(true);
    expect(meetupUrl("e_abc123", null).endsWith("/m/e_abc123")).toBe(true);
  });
});

describe("pending meetup stash", () => {
  beforeEach(() => clearPendingMeetup());
  afterEach(() => clearPendingMeetup());

  it("round-trips set -> get -> clear, carrying the sharer ref", () => {
    expect(getPendingMeetup()).toBeNull();
    setPendingMeetup("e_abc123", "u_1");
    expect(getPendingMeetup()).toEqual({ token: "e_abc123", via: "u_1" });
    clearPendingMeetup();
    expect(getPendingMeetup()).toBeNull();
  });

  it("defaults the sharer ref to null when not given", () => {
    setPendingMeetup("e_abc123");
    expect(getPendingMeetup()).toEqual({ token: "e_abc123", via: null });
  });
});
