import assert from "node:assert/strict";
import { test } from "node:test";
import { MOMENT_MS } from "@bethere/shared";
import { resolveCreateDeadlines, resolveMomentEnd } from "./event-schedule.js";

const NOW = Date.parse("2026-06-09T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const earliest = NOW + 48 * HOUR; // two days out
const last = NOW + 72 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

test("collecting plan with no custom deadlines: decides-by defaults, sits between now and earliest", () => {
  const r = resolveCreateDeadlines(false, earliest, last, true, undefined, undefined, NOW);
  assert.ok(r.decidesBy);
  assert.ok((r.decidesBy as Date).getTime() > NOW);
  assert.ok((r.decidesBy as Date).getTime() <= earliest);
  assert.equal(r.replyBy, null);
  assert.equal(r.momentEndsAt, null);
  assert.equal(r.respondByAt.getTime(), last); // no live moment -> falls back to the last time
});

test("custom decides-by is accepted when after now and a moment before the earliest time", () => {
  const ms = earliest - MOMENT_MS - HOUR;
  const r = resolveCreateDeadlines(false, earliest, last, true, iso(ms), undefined, NOW);
  assert.equal((r.decidesBy as Date).getTime(), ms);
});

test("rejects a decides-by in the past and one too close to the earliest time", () => {
  assert.throws(
    () => resolveCreateDeadlines(false, earliest, last, true, iso(NOW - HOUR), undefined, NOW),
    /decides-by must be after now/,
  );
  // Inside the required MOMENT_MS headroom before earliest.
  assert.throws(
    () =>
      resolveCreateDeadlines(
        false,
        earliest,
        last,
        true,
        iso(earliest - MOMENT_MS / 2),
        undefined,
        NOW,
      ),
    /decides-by must be after now/,
  );
});

test("reply-by floor is the decides-by (custom) and it cannot exceed the earliest time", () => {
  const decides = iso(earliest - 6 * HOUR);
  // After the vote-close floor and before earliest: accepted.
  const ok = resolveCreateDeadlines(
    false,
    earliest,
    last,
    true,
    decides,
    iso(earliest - HOUR),
    NOW,
  );
  assert.equal((ok.replyBy as Date).getTime(), earliest - HOUR);
  // At/under the floor: rejected.
  assert.throws(
    () =>
      resolveCreateDeadlines(false, earliest, last, true, decides, iso(earliest - 6 * HOUR), NOW),
    /reply-by must be after the vote closes/,
  );
  // Past the earliest time: rejected.
  assert.throws(
    () => resolveCreateDeadlines(false, earliest, last, true, decides, iso(earliest + HOUR), NOW),
    /reply-by must be after the vote closes/,
  );
});

test("concrete plan: no decides-by, a live moment end, respondByAt mirrors it", () => {
  const r = resolveCreateDeadlines(true, earliest, last, true, undefined, undefined, NOW);
  assert.equal(r.decidesBy, null);
  assert.ok(r.momentEndsAt);
  assert.equal(r.respondByAt.getTime(), (r.momentEndsAt as Date).getTime());
});

test("resolveMomentEnd clamps a full short window when the event is already here", () => {
  assert.equal(resolveMomentEnd(NOW, NOW - HOUR, null).getTime(), NOW + MOMENT_MS);
});
