# PostHog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instrument BeThere with a focused PostHog integration that captures the Family-D product-outcome telemetry (`docs/m4/quantitative-evaluation.md` section 3.4), with a server `posthog-node` backbone plus a web-first cross-platform client wrapper.

**Architecture:** Two layers over one event vocabulary. Layer 1 - a server `analytics.ts` module called at single-source lifecycle choke points in `apps/api/src/routers/events.ts`; it is the source of truth for every Family-D metric. Layer 2 - a client `analytics.ts` wrapper (`posthog-js` on web, `posthog-react-native` on native) for screen-flow funnels. Both are env-gated: with no key configured they are pure no-ops, so dev/CI/tests never touch the network.

**Tech Stack:** `posthog-node` (api), `posthog-js` + `posthog-react-native` (mobile), TypeScript, tRPC v11, Fastify, React Navigation, Jest (jest-expo on mobile, node test harness on api). PostHog Cloud EU (`https://eu.i.posthog.com`).

**Spec:** `docs/superpowers/specs/2026-06-09-posthog-integration-design.md`. **Linear:** DRP-57. **Branch:** `feat/meetup-link` (per user; this work rides on top of the in-flight DRP-56 commits).

---

## File structure

**Layer 1 - server (`apps/api`):**
- Create `apps/api/src/analytics.ts` - the capture singleton (`capture`, `shutdown`, plus a test seam `__setTestClient`). One responsibility: own the PostHog node client and the no-op gate.
- Create `apps/api/src/analytics.test.ts` - unit tests for the module in isolation.
- Modify `apps/api/src/index.ts` - flush via `fastify.onClose`.
- Modify `apps/api/src/routers/events.ts` - add `capture(...)` calls at choke points (`create`, `openMoment`, `settleCollecting`, `settlePhase`, `fizzle`, `respond`, `toggleReaction`, `addCandidate`).
- Modify `apps/api/src/routers/events-create.test.ts` (and add focused assertions in a new `apps/api/src/routers/events-analytics.test.ts`) - assert choke points emit the right events.

**Layer 2 - client (`apps/mobile`):**
- Create `apps/mobile/src/lib/analytics.ts` - cross-platform wrapper (`identify`, `capture`, `screen`), platform-branched, env-gated no-op.
- Create `apps/mobile/src/lib/__tests__/analytics.test.ts` - unit tests for the no-op gate and platform routing shape.
- Modify `apps/mobile/App.tsx` - `onStateChange` screen tracking on `NavigationContainer`; identify the user inside `Gate`.
- Modify `apps/mobile/src/screens/CreateWizard.tsx` - emit the "send a plan" funnel events.

**Docs / config:**
- Modify `docs/runbook-deploy.md`, `apps/api/.env.example`, `apps/mobile/.env.example` (create the example files if absent).
- Modify `docs/m4/quantitative-evaluation.md` - add an events->metrics mapping note.

---

## Task 1: Server analytics module (the no-op gate)

**Files:**
- Create: `apps/api/src/analytics.ts`
- Test: `apps/api/src/analytics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/analytics.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { __setTestClient, capture, type AnalyticsClient } from "./analytics.js";

afterEach(() => {
  __setTestClient(null);
  delete process.env.POSTHOG_KEY;
});

describe("analytics.capture", () => {
  it("no-ops (no throw, no client) when POSTHOG_KEY is unset", () => {
    // No test client injected and no key -> capture must do nothing and must not throw.
    expect(() => capture("u_1", "plan_created", { groupId: "g_1" })).not.toThrow();
  });

  it("forwards distinctId, event and properties to the injected client", () => {
    const calls: Array<{ distinctId: string; event: string; properties?: Record<string, unknown> }> =
      [];
    const fake: AnalyticsClient = { capture: (args) => calls.push(args) };
    __setTestClient(fake);

    capture("u_1", "plan_created", { groupId: "g_1", opensMoment: false });

    expect(calls).toEqual([
      { distinctId: "u_1", event: "plan_created", properties: { groupId: "g_1", opensMoment: false } },
    ]);
  });

  it("swallows a client error instead of throwing into the caller", () => {
    const fake: AnalyticsClient = {
      capture: () => {
        throw new Error("network down");
      },
    };
    __setTestClient(fake);
    expect(() => capture("u_1", "plan_cleared", {})).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/api test analytics`
Expected: FAIL - `Cannot find module './analytics.js'` (or `capture is not exported`).

- [ ] **Step 3: Add the dependency**

Run: `pnpm --filter @bethere/api add posthog-node`
Expected: `posthog-node` added to `apps/api/package.json` dependencies.

- [ ] **Step 4: Write the module**

```ts
// apps/api/src/analytics.ts
import { PostHog } from "posthog-node";
import { logger, scoped } from "./logger.js";

// Property values we allow on an event. Deliberately scalar - never an object that could smuggle a
// display name or voter identity into PostHog (anonymity is a product invariant; see the spec).
export type CaptureProps = Record<string, string | number | boolean | null>;

// The minimal surface capture() needs. PostHog (posthog-node) satisfies it; tests inject a fake.
export type AnalyticsClient = {
  capture(args: { distinctId: string; event: string; properties?: CaptureProps }): void;
};

let client: AnalyticsClient | null = null;
let initialized = false;

// Lazily construct the real client from env, once. When POSTHOG_KEY is absent (local dev, CI, the
// test harness) this returns null forever, making capture() a pure no-op with no network and no
// flush. Host defaults to PostHog Cloud EU.
function getClient(): AnalyticsClient | null {
  if (initialized) return client;
  initialized = true;
  const key = process.env.POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.POSTHOG_HOST ?? "https://eu.i.posthog.com";
  client = new PostHog(key, { host });
  return client;
}

// Fire-and-forget. distinctId is the pseudonymous internal userId (never PII). Never throws into the
// request path: an analytics failure must not break a tRPC call, so we log at warn and move on.
export function capture(distinctId: string, event: string, properties: CaptureProps = {}): void {
  const c = getClient();
  if (!c) return;
  try {
    c.capture({ distinctId, event, properties });
  } catch (err) {
    logger.warn({ ...scoped("analytics"), err, event }, "posthog capture failed (ignored)");
  }
}

// Flush the batched buffer on graceful shutdown (wired to fastify.onClose). No-op when never inited.
export async function shutdown(): Promise<void> {
  if (client && "shutdown" in client && typeof (client as PostHog).shutdown === "function") {
    await (client as PostHog).shutdown();
  }
  client = null;
  initialized = false;
}

// Test-only seam: inject a fake client (or null to reset to the no-op default). Not used in prod.
export function __setTestClient(c: AnalyticsClient | null): void {
  client = c;
  initialized = true;
}
```

Note on the test runner: `apps/api` uses its existing test runner. If it is `vitest`, the import above is correct. If it is `node:test`, replace the `vitest` import with `import { afterEach, describe, it } from "node:test"; import assert from "node:assert/strict";` and the matchers accordingly. Check an existing file (e.g. `apps/api/src/routers/events-create.test.ts`) for the project's import style and mirror it before writing the test.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bethere/api test analytics`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/analytics.ts apps/api/src/analytics.test.ts pnpm-lock.yaml
git commit -m "feat(api): add env-gated posthog-node analytics module (DRP-57)"
```

---

## Task 2: Flush analytics on server shutdown

**Files:**
- Modify: `apps/api/src/index.ts:39` (add an `onClose` hook near the other hooks)

- [ ] **Step 1: Add the import**

At the top of `apps/api/src/index.ts`, alongside the other local imports (after line 8's `import { isAuthorizedReset }`):

```ts
import { shutdown as shutdownAnalytics } from "./analytics.js";
```

- [ ] **Step 2: Register the onClose hook**

Immediately after the `onResponse` hook block (after line 46, the `});` that closes it), add:

```ts
// Flush any buffered PostHog events when the server shuts down gracefully. No-op when analytics is
// unconfigured. App Runner sends SIGTERM on deploy, which Fastify turns into onClose.
server.addHook("onClose", async () => {
  await shutdownAnalytics();
});
```

- [ ] **Step 3: Verify it typechecks and the server still boots**

Run: `pnpm --filter @bethere/api typecheck`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): flush posthog buffer on fastify onClose (DRP-57)"
```

---

## Task 3: Instrument plan creation and moment-open events

This captures `plan_created` (every create) and `moment_opened` (every collecting->moment transition, fired exactly once per transition). A moment opens at three sites: the concrete shortcut inside `create`, manual `lock`, and lazy `settleCollecting`. We pass a `trigger` into `openMoment` and fire inside it only when it wins the transition race; `create`'s shortcut fires its own.

**Files:**
- Modify: `apps/api/src/routers/events.ts` - `create` (~514), `openMoment` (~266), `lock` (~768), `settleCollecting` (~332)
- Test: `apps/api/src/routers/events-analytics.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routers/events-analytics.test.ts
// Mirror the import style of the sibling events-*.test.ts files (caller factory + db reset helpers).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setTestClient, type AnalyticsClient, type CaptureProps } from "../analytics.js";
import { makeCaller, resetDb, seedGroupWithMember } from "../test/harness.js"; // match the real harness path/exports

type Captured = { distinctId: string; event: string; properties?: CaptureProps };

let captured: Captured[];

beforeEach(async () => {
  await resetDb();
  captured = [];
  const fake: AnalyticsClient = { capture: (a) => captured.push(a) };
  __setTestClient(fake);
});
afterEach(() => __setTestClient(null));

describe("analytics: plan creation", () => {
  it("emits plan_created with the lock flags and candidate counts on a collecting plan", async () => {
    const { groupId, userId } = await seedGroupWithMember();
    const caller = makeCaller(userId);

    await caller.events.create({
      groupId,
      timeCandidates: [{ startsAt: new Date(Date.now() + 86_400_000).toISOString() }],
      activityCandidates: ["Bowling", "Dinner"],
    });

    const created = captured.find((c) => c.event === "plan_created");
    expect(created?.distinctId).toBe(userId);
    expect(created?.properties).toMatchObject({
      groupId,
      lockTimes: false,
      lockActivity: false,
      opensMoment: false,
      timeCandidateCount: 1,
      activityCandidateCount: 2,
    });
    // A collecting plan does NOT open a moment yet.
    expect(captured.some((c) => c.event === "moment_opened")).toBe(false);
  });

  it("emits moment_opened with trigger=concrete_shortcut when both axes are pinned", async () => {
    const { groupId, userId } = await seedGroupWithMember();
    const caller = makeCaller(userId);

    await caller.events.create({
      groupId,
      timeCandidates: [{ startsAt: new Date(Date.now() + 86_400_000).toISOString() }],
      activityCandidates: ["Bowling"],
      lockTimes: true,
      lockActivity: true,
    });

    const opened = captured.find((c) => c.event === "moment_opened");
    expect(opened?.distinctId).toBe(userId);
    expect(opened?.properties).toMatchObject({ trigger: "concrete_shortcut" });
  });
});
```

The exact harness import (`makeCaller`, `resetDb`, `seedGroupWithMember`) must match what the existing `events-create.test.ts` uses - open that file first and copy its setup verbatim; the names above are placeholders for whatever it actually exports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/api test events-analytics`
Expected: FAIL - no `plan_created` event is captured (array is empty).

- [ ] **Step 3: Add the import to events.ts**

At the top of `apps/api/src/routers/events.ts`, add (next to the existing local imports):

```ts
import { capture } from "../analytics.js";
```

- [ ] **Step 4: Emit plan_created in `create`**

In `create`, immediately before `return { id };` (currently ~605, after `insertCandidates`), add:

```ts
    capture(ctx.userId, "plan_created", {
      groupId: input.groupId,
      lockTimes: input.lockTimes,
      lockActivity: input.lockActivity,
      opensMoment,
      timeCandidateCount: timeCands.length,
      activityCandidateCount: activityCands.length,
    });
    if (opensMoment) {
      // Concrete shortcut: create opened a moment directly (it does not go through openMoment).
      capture(ctx.userId, "moment_opened", {
        planId: id,
        trigger: "concrete_shortcut",
        contingent: false,
      });
    }
```

- [ ] **Step 5: Add a `trigger` parameter to `openMoment` and emit on a won transition**

Change the `openMoment` signature (currently ~266) to accept a trailing `trigger`:

```ts
async function openMoment(
  e: EventRow,
  chosen: { startsAt: Date | null },
  chosenId: string,
  cands: (typeof eventCandidates.$inferSelect)[],
  reactions: CandidateReaction[],
  trigger: "auto_lock" | "manual_lock",
): Promise<boolean> {
```

Then, inside `openMoment`, just before the final `return true;` (currently ~312, after the `e.* =` mirror assignments), add:

```ts
  // Fire once, only for the call that actually performed the transition (lost-race callers returned
  // false above). distinctId is the plan's creator so create -> moment_opened -> cleared is one funnel.
  capture(e.createdByUserId, "moment_opened", {
    planId: e.id,
    trigger,
    contingent: e.contingent,
  });
```

- [ ] **Step 6: Pass the trigger at both `openMoment` call sites**

In `lock` (currently ~768) change:

```ts
    await openMoment(e, chosen, chosenId, cands, reactions);
```
to:
```ts
    await openMoment(e, chosen, chosenId, cands, reactions, "manual_lock");
```

In `settleCollecting` (currently ~332) change:

```ts
  await openMoment(e, chosen, chosenId, cands, reactions);
```
to:
```ts
  await openMoment(e, chosen, chosenId, cands, reactions, "auto_lock");
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @bethere/api test events-analytics`
Expected: PASS (2 tests).

- [ ] **Step 8: Run the full api suite to confirm no regressions from the signature change**

Run: `pnpm --filter @bethere/api test`
Expected: PASS (all existing tests, including `events-lock` and `events-settle`, still green).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routers/events.ts apps/api/src/routers/events-analytics.test.ts
git commit -m "feat(api): emit plan_created + moment_opened analytics events (DRP-57)"
```

---

## Task 4: Instrument plan terminal events (cleared / fizzled)

`settlePhase` (~250) is the only place a moment resolves to `cleared` or `fizzled`; `fizzle` (~173) is the only place a collecting plan fizzles. Emit at both. distinctId is the plan's creator (lifecycle owner).

**Files:**
- Modify: `apps/api/src/routers/events.ts` - `settlePhase` (~250), `fizzle` (~173)
- Test: `apps/api/src/routers/events-analytics.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to events-analytics.test.ts)**

```ts
describe("analytics: plan terminal transitions", () => {
  it("emits plan_cleared when a contingent moment settles with quorum met", async () => {
    // Build a plan that is in a moment, has a met quorum, and whose moment window has ended, then
    // trigger a lazy settle via a read (events.get / events.resolve). Reuse the exact setup the
    // sibling events-settle.test.ts uses to fast-forward the moment clock.
    const { groupId, userId } = await seedGroupWithMember();
    const caller = makeCaller(userId);
    const planId = await makeSettledClearedPlan(caller, groupId); // mirror events-settle.test.ts helpers

    const cleared = captured.find((c) => c.event === "plan_cleared");
    expect(cleared?.properties).toMatchObject({ planId });
    expect(cleared?.distinctId).toBe(userId);
  });

  it("emits plan_fizzled when a collecting plan auto-locks with no reactions", async () => {
    const { groupId, userId } = await seedGroupWithMember();
    const caller = makeCaller(userId);
    const planId = await makeFizzledPlan(caller, groupId); // mirror events-settle.test.ts helpers

    const fizzled = captured.find((c) => c.event === "plan_fizzled");
    expect(fizzled?.properties).toMatchObject({ planId });
  });
});
```

Use the real fizzle/clear-construction helpers from `events-settle.test.ts`; the `makeSettledClearedPlan` / `makeFizzledPlan` names are placeholders for that file's actual approach (it manipulates `decidesBy` / `momentEndsAt` to be in the past, then reads to force the lazy settle).

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/api test events-analytics`
Expected: FAIL - no `plan_cleared` / `plan_fizzled` captured.

- [ ] **Step 3: Emit in `settlePhase`**

Replace the body of `settlePhase` (currently ~250-256) so it captures the terminal transition it just performed:

```ts
async function settlePhase(e: EventRow): Promise<void> {
  if (e.phase !== "moment" || !e.momentEndsAt || Date.now() <= e.momentEndsAt.getTime()) return;
  const resp = await responsesFor(e.id);
  const next = clears(resp, e.quorum) || !e.contingent ? "cleared" : "fizzled";
  await db.update(events).set({ phase: next, status: "resolved" }).where(eq(events.id, e.id));
  e.phase = next;
  capture(e.createdByUserId, next === "cleared" ? "plan_cleared" : "plan_fizzled", {
    planId: e.id,
    contingent: e.contingent,
  });
}
```

- [ ] **Step 4: Emit in `fizzle`**

Replace the body of `fizzle` (currently ~173-176) with:

```ts
async function fizzle(e: EventRow): Promise<void> {
  await db.update(events).set({ phase: "fizzled", status: "resolved" }).where(eq(events.id, e.id));
  e.phase = "fizzled";
  capture(e.createdByUserId, "plan_fizzled", { planId: e.id, contingent: e.contingent });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bethere/api test events-analytics`
Expected: PASS.

- [ ] **Step 6: Run the full api suite**

Run: `pnpm --filter @bethere/api test`
Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routers/events.ts apps/api/src/routers/events-analytics.test.ts
git commit -m "feat(api): emit plan_cleared + plan_fizzled analytics events (DRP-57)"
```

---

## Task 5: Instrument participation events (RSVP, votes, candidate adds)

`rsvp_submitted` in `respond`, `candidate_voted` in `toggleReaction`, `candidate_added` in `addCandidate`. distinctId is the acting user (`ctx.userId`).

**Files:**
- Modify: `apps/api/src/routers/events.ts` - `respond` (~1058), `toggleReaction` (~610), `addCandidate` (~665)
- Test: `apps/api/src/routers/events-analytics.test.ts` (append)

- [ ] **Step 1: Write the failing test (append)**

```ts
describe("analytics: participation", () => {
  it("emits candidate_voted with kind and added on a fresh +1, and added=false on un-vote", async () => {
    const { groupId, userId } = await seedGroupWithMember();
    const caller = makeCaller(userId);
    const { id: planId } = await caller.events.create({
      groupId,
      timeCandidates: [{ startsAt: new Date(Date.now() + 86_400_000).toISOString() }],
      activityCandidates: ["Bowling"],
    });
    const plan = await caller.events.get({ eventId: planId });
    const timeCandidateId = plan.candidates.find((c) => c.kind === "time")!.id; // match real shape

    captured.length = 0; // ignore the create-time events
    await caller.events.toggleReaction({ eventId: planId, candidateId: timeCandidateId });

    const voted = captured.find((c) => c.event === "candidate_voted");
    expect(voted?.distinctId).toBe(userId);
    expect(voted?.properties).toMatchObject({ planId, kind: "time", added: false });
    // (added=false here because the creator already +1'd their own time candidate at create; a second
    // toggle removes it. Adjust the assertion to your seed: assert added=true if voting a NEW candidate.)
  });

  it("emits rsvp_submitted with the kind on a moment answer", async () => {
    const { groupId, userId } = await seedGroupWithMember();
    const caller = makeCaller(userId);
    const planId = await makeMomentPlan(caller, groupId); // a plan in the moment phase (mirror events-respond.test.ts)

    captured.length = 0;
    await caller.events.respond({ eventId: planId, kind: "yes" });

    const rsvp = captured.find((c) => c.event === "rsvp_submitted");
    expect(rsvp?.distinctId).toBe(userId);
    expect(rsvp?.properties).toMatchObject({ planId, kind: "yes" });
  });
});
```

Use the real candidate shape returned by `events.get` (open `events-get.test.ts` to confirm the field is `candidates` with `.kind`/`.id`) and the real moment-plan construction from `events-respond.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/api test events-analytics`
Expected: FAIL - participation events not captured.

- [ ] **Step 3: Emit `candidate_voted` in `toggleReaction`**

In `toggleReaction`, the un-vote branch (currently ~627-630) becomes:

```ts
    if (mine.length > 0) {
      await db.delete(candidateReactions).where(mineWhere);
      capture(ctx.userId, "candidate_voted", {
        planId: input.eventId,
        kind: cand.kind,
        added: false,
      });
      return { reacted: false as const };
    }
```

And just before the `return { reacted: true as const };` (currently ~641, after the transaction), add:

```ts
    capture(ctx.userId, "candidate_voted", { planId: input.eventId, kind: cand.kind, added: true });
```

- [ ] **Step 4: Emit `candidate_added` in `addCandidate`**

`addCandidate` has several return points (two dedupe early-returns plus the final create). We only want to log a genuinely NEW candidate, so add the capture immediately before the final `return { id: newId };` (currently ~738, right after `await ensureReaction(input.eventId, newId, ctx.userId);`):

```ts
    capture(ctx.userId, "candidate_added", { planId: input.eventId, kind: input.kind });
```

(The dedupe early-returns at ~714 and ~730 intentionally do not emit `candidate_added` - they +1 an existing row, which `ensureReaction` records but is not a new candidate. They are vote-like, not add-like; counting them as adds would inflate the momentum signal.)

- [ ] **Step 5: Emit `rsvp_submitted` in `respond`**

Replace the `respond` body's insert region (currently ~1061-1071) so it computes whether this replaces a prior answer and emits the event:

```ts
    const [prior] = await db
      .select({ kind: responses.kind })
      .from(responses)
      .where(and(eq(responses.eventId, input.eventId), eq(responses.userId, ctx.userId)))
      .limit(1);
    await clearMyResponse(input.eventId, ctx.userId);
    await db.insert(responses).values({
      id: randomUUID(),
      eventId: input.eventId,
      userId: ctx.userId,
      kind: input.kind,
      cond: input.cond ?? null,
    });
    // An explicit moment answer supersedes any earlier opt-out (the escape hatch back in).
    await clearOptOut(input.eventId, ctx.userId);
    capture(ctx.userId, "rsvp_submitted", {
      planId: input.eventId,
      kind: input.kind,
      isChange: Boolean(prior),
    });
    return { recorded: true as const };
```

Confirm `responses` and `and`/`eq` are already imported in this file (they are - used elsewhere in `respond` and `clearMyResponse`).

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @bethere/api test events-analytics`
Expected: PASS.

- [ ] **Step 7: Run the full api suite**

Run: `pnpm --filter @bethere/api test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routers/events.ts apps/api/src/routers/events-analytics.test.ts
git commit -m "feat(api): emit rsvp_submitted, candidate_voted, candidate_added events (DRP-57)"
```

---

## Task 6: Client analytics wrapper (web-first, cross-platform, no-op gate)

**Files:**
- Create: `apps/mobile/src/lib/analytics.ts`
- Test: `apps/mobile/src/lib/__tests__/analytics.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/mobile/src/lib/__tests__/analytics.test.ts
import { capture, identify, screen } from "../analytics";

describe("client analytics no-op gate", () => {
  it("no-ops without EXPO_PUBLIC_POSTHOG_KEY (no throw)", () => {
    // jest-expo sets no posthog key, so the wrapper must be a silent no-op on every call.
    expect(() => identify("u_1")).not.toThrow();
    expect(() => capture("plan_create_started", { groupId: "g_1" })).not.toThrow();
    expect(() => screen("Dashboard")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @bethere/mobile test analytics`
Expected: FAIL - `Cannot find module '../analytics'`.

- [ ] **Step 3: Add the dependencies**

PostHog's RN SDK and its Expo-aligned peers must be installed with `expo install` so versions match SDK 54 (per CLAUDE.md). `posthog-js` is a plain web dep.

Run:
```bash
pnpm --filter @bethere/mobile add posthog-js
cd apps/mobile && npx expo install posthog-react-native @react-native-async-storage/async-storage expo-file-system expo-application expo-device expo-localization && cd ../..
```
Expected: all packages added; `npx expo install` picks SDK-54-compatible versions. (`posthog-react-native` uses these peers for persistence/context; without them it warns but still runs.)

- [ ] **Step 4: Write the wrapper**

```ts
// apps/mobile/src/lib/analytics.ts
// One uniform analytics surface for the app. Web (the priority target) uses posthog-js; native uses
// posthog-react-native. Env-gated: with no EXPO_PUBLIC_POSTHOG_KEY every call is a pure no-op, so dev
// builds and the jest-expo suite never touch the network. Autocapture and session replay are OFF on
// both SDKs (privacy: anonymity is a product invariant; the backend is the metric source of truth).
import { Platform } from "react-native";

type Props = Record<string, string | number | boolean | null | undefined>;

type Backend = {
  identify(id: string): void;
  capture(event: string, props?: Props): void;
  screen(name: string): void;
};

let backend: Backend | null = null;
let initialized = false;

function makeBackend(): Backend | null {
  const key = process.env.EXPO_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

  if (Platform.OS === "web") {
    // require (not import) so native bundles never evaluate posthog-js, which touches window/document.
    const posthog = require("posthog-js").default as typeof import("posthog-js").default;
    posthog.init(key, {
      api_host: host,
      autocapture: false,
      capture_pageview: false,
      disable_session_recording: true,
    });
    return {
      identify: (id) => posthog.identify(id),
      capture: (event, props) => posthog.capture(event, props),
      screen: (name) => posthog.capture("$screen", { $screen_name: name }),
    };
  }

  const PostHog = require("posthog-react-native").default as typeof import("posthog-react-native").default;
  const ph = new PostHog(key, { host });
  return {
    identify: (id) => ph.identify(id),
    capture: (event, props) => ph.capture(event, props),
    screen: (name) => ph.screen(name),
  };
}

function get(): Backend | null {
  if (initialized) return backend;
  initialized = true;
  backend = makeBackend();
  return backend;
}

export function identify(id: string): void {
  get()?.identify(id);
}

export function capture(event: string, props?: Props): void {
  get()?.capture(event, props);
}

export function screen(name: string): void {
  get()?.screen(name);
}
```

Note: `require(...)` inside `makeBackend` keeps the unused SDK out of the runtime path per platform. If the project's biome config flags `require`, prefer platform-specific files instead: split into `analytics.web.ts` (posthog-js) and `analytics.native.ts` (posthog-react-native), each exporting the same `identify/capture/screen`, and let Metro resolve by extension. Keep the no-op key gate in both. Decide based on whether `pnpm --filter @bethere/mobile lint` complains about `require`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @bethere/mobile test analytics`
Expected: PASS.

- [ ] **Step 6: Run the full mobile suite (catch import/bundle issues early)**

Run: `pnpm --filter @bethere/mobile test`
Expected: PASS (no regressions; jest-expo can resolve the new modules).

- [ ] **Step 7: Commit**

```bash
git add apps/mobile/package.json apps/mobile/src/lib/analytics.ts apps/mobile/src/lib/__tests__/analytics.test.ts pnpm-lock.yaml
git commit -m "feat(mobile): add web-first cross-platform analytics wrapper (DRP-57)"
```

---

## Task 7: Wire identify + screen tracking + create-flow funnel into the app

**Files:**
- Modify: `apps/mobile/App.tsx` - `NavigationContainer onStateChange` (~213) and `Gate` (~184)
- Modify: `apps/mobile/src/lib/auth.ts` - export the resolved analytics identity (small helper)
- Modify: `apps/mobile/src/screens/CreateWizard.tsx` - funnel events

- [ ] **Step 1: Add an identity hook to auth.ts**

In `apps/mobile/src/lib/auth.ts`, add a hook that resolves the same id the server uses as `distinct_id` (dev: the stub id; clerk: `user.id`) and calls `identify` once it is known:

```ts
import { identify } from "./analytics";

// Identify the signed-in user to analytics with the SAME id the API uses as distinct_id (dev stub id,
// or the Clerk user id). Called from Gate; safe to call repeatedly (PostHog dedupes identify).
export function useAnalyticsIdentity(): void {
  const { user } = useUser();
  const { devUser } = useDevAuth();
  useEffect(() => {
    const id = devUser ?? user?.id ?? null;
    if (id) identify(id);
  }, [devUser, user?.id]);
}
```

(`useUser`, `useDevAuth`, `useEffect` are already imported in this file.)

- [ ] **Step 2: Call identify and add screen tracking in App.tsx**

In `apps/mobile/App.tsx`, add the imports near the other lib imports (~17-20):

```ts
import { useAnalyticsIdentity } from "./src/lib/auth";
import { capture as captureAnalytics, screen as trackScreen } from "./src/lib/analytics";
```

(Add `useAnalyticsIdentity` to the existing `./src/lib/auth` import line rather than duplicating it.)

In `Gate` (currently ~184), call the identity hook near the top of the component body, after `const authed = useAuthBridge();`:

```ts
  useAnalyticsIdentity();
```

On the `NavigationContainer` (currently ~213), add an `onStateChange` that logs the active route name:

```tsx
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      onStateChange={() => {
        const name = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : undefined;
        if (name) trackScreen(name);
      }}
    >
```

- [ ] **Step 3: Add the create-flow funnel events in CreateWizard.tsx**

Open `apps/mobile/src/screens/CreateWizard.tsx`. Add the import:

```ts
import { capture } from "../lib/analytics";
```

Emit three events to approximate the "send a plan" task funnel (T1):

- `plan_create_started` - in a mount effect when the wizard opens:
  ```ts
  useEffect(() => {
    capture("plan_create_started");
  }, []);
  ```
  (If `useEffect` is not already imported, add it to the existing `react` import.)
- `plan_create_submitted` - in the submit handler, right after the `events.create` call resolves successfully. Include whether it was a redo (the client-only concept), e.g.:
  ```ts
  capture("plan_create_submitted", {
    lockTimes,
    lockActivity,
    isRedo: Boolean(sourceEventId),
  });
  ```
  Use the wizard's actual local variable names for the lock flags and the redo source (inspect the component to find them - the redo source is the `source` step state described in CLAUDE.md). If there is no redo state variable in scope, omit `isRedo`.

- [ ] **Step 4: Run the mobile suite**

Run: `pnpm --filter @bethere/mobile test`
Expected: PASS. If a screen test renders `App`/`Gate`/`CreateWizard`, the no-op analytics gate keeps them green (no key in test env).

- [ ] **Step 5: Typecheck the mobile package**

Run: `pnpm --filter @bethere/mobile typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/App.tsx apps/mobile/src/lib/auth.ts apps/mobile/src/screens/CreateWizard.tsx
git commit -m "feat(mobile): identify users, track screens, log create-flow funnel (DRP-57)"
```

---

## Task 8: Config, docs, and the M4 events->metrics mapping

**Files:**
- Modify/Create: `apps/api/.env.example`, `apps/mobile/.env.example`
- Modify: `docs/runbook-deploy.md`
- Modify: `docs/m4/quantitative-evaluation.md`

- [ ] **Step 1: Document the env vars in the example files**

Append to `apps/api/.env.example` (create it if it does not exist; check first with `ls apps/api/.env*`):

```bash
# PostHog product analytics (Family-D telemetry). Leave unset to disable (capture becomes a no-op).
# Use a PostHog Cloud EU project key. Host defaults to https://eu.i.posthog.com when unset.
POSTHOG_KEY=
POSTHOG_HOST=https://eu.i.posthog.com
```

Append to `apps/mobile/.env.example` (same caveat):

```bash
# PostHog client analytics. Leave unset to disable (the wrapper is a no-op on every platform).
EXPO_PUBLIC_POSTHOG_KEY=
EXPO_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com
```

- [ ] **Step 2: Document deployment in the runbook**

In `docs/runbook-deploy.md`, add a short "PostHog analytics" subsection: set `POSTHOG_KEY` (+ optional `POSTHOG_HOST`) on both App Runner stacks (`bethere-api` prod and `bethere-api-dev`), and `EXPO_PUBLIC_POSTHOG_KEY` for the Vercel web build. State that omitting the key disables analytics cleanly (no-op), so CI and local dev need no key.

- [ ] **Step 3: Add the events->metrics mapping note to the M4 doc**

In `docs/m4/quantitative-evaluation.md`, at the end of section 3.4 (Family-D), add a short note (no em dashes) mapping each Family-D metric to its source event so a grader can trace each figure:

```markdown
> **Instrumentation (DRP-57).** Family-D metrics are now sourced from PostHog server events,
> emitted at single-source lifecycle choke points in the API and keyed on a pseudonymous internal
> user id (never PII; in-app anonymity is untouched). Mapping: plan clear rate / fizzle rate <-
> `plan_cleared` and `plan_fizzled`; RSVP completion + conditional-RSVP usage <- `rsvp_submitted`
> (property `kind`); time-to-lock <- `moment_opened.ts - plan_created.ts`; votes per collecting plan
> <- count of `candidate_voted` per plan; anonymous-creation share <- `plan_created` (all plans are
> anonymous). No event carries a name, email, or voter-to-candidate linkage.
```

- [ ] **Step 4: Run the full repo gate**

Run: `pnpm check`
Expected: PASS - lint + typecheck + test + quality all green. (The `quality` step must pass: confirm no `as any` / `@ts-ignore` / `biome-ignore` were introduced. The single `as PostHog` narrowing in `shutdown` and the `require` casts use concrete types, not `any`, so they pass; if `quality` flags the `require` casts, switch Task 6 to the platform-file split noted there.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/.env.example apps/mobile/.env.example docs/runbook-deploy.md docs/m4/quantitative-evaluation.md
git commit -m "docs(posthog): document analytics env vars and M4 metric mapping (DRP-57)"
```

- [ ] **Step 6: Mark DRP-57 Done in Linear and reference the commits.**

---

## Self-review notes

- **Spec coverage:** server module (Task 1) + shutdown (Task 2); all seven server events (Tasks 3-5); web-first cross-platform client with autocapture/replay off (Task 6); identify + screen + funnel (Task 7); EU host default, env-gated no-op, privacy guardrails, config/docs/tests (across all tasks). The full Family-D table maps to Tasks 3-5.
- **Deviation from the spec table:** `isRedo` was listed as a `plan_created` property, but `CreateEventInput` carries no redo/source flag server-side (verified) - redo is a client-flow concept, so `isRedo` is captured on the client `plan_create_submitted` event instead (Task 7). This is the only deviation.
- **Type consistency:** `capture(distinctId, event, props)` (server) and `capture(event, props)` / `identify(id)` / `screen(name)` (client) are used consistently across tasks. `AnalyticsClient` / `CaptureProps` are defined in Task 1 and reused by the tests in Tasks 3-5. `openMoment`'s new `trigger` param (Task 3) is threaded to both call sites in the same task.
- **Line numbers** are approximate (the `feat/meetup-link` branch shifted some): always locate by function name, not by line.
- **Test harness imports** (`makeCaller`, `resetDb`, seed helpers, candidate shape) are placeholders - copy the exact setup from the sibling `events-*.test.ts` files before writing each test.
