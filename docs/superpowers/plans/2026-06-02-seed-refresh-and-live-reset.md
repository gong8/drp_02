# Seed refresh + live reset - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the seeded demo to an iteration-matched set (exact + options only) and add a token-gated, instant `POST /admin/reseed` so the live backend can be wiped back to a clean demo without a redeploy.

**Architecture:** Split the pure demo data + a referential-integrity validator out of `seed.ts` into a DB-free `seed-data.ts` (so it is unit-testable without Postgres). Replace the plan set. Add a small `isAuthorizedReset` token-guard module and wire a raw Fastify route in `index.ts` that calls the existing `reseedDemo()`. Add a one-command live-reset script + runbook docs. Finally (ops) set `ADMIN_RESET_TOKEN` on the App Runner service and reseed live.

**Tech Stack:** Fastify, tRPC, Drizzle ORM + Postgres, Zod, TypeScript (ESM, `.js` import specifiers), node:test + tsx for API tests, Biome, pnpm workspaces. Branch: `dev`.

**Spec:** `docs/superpowers/specs/2026-06-02-seed-refresh-and-live-reset-design.md`

---

## File Structure

- `apps/api/src/db/seed-data.ts` (**new**) - pure demo data: `Kind`/`Cand`/`Resp`/`Plan` types, `DEMO_USERS`, `GROUPS`, `PLANS`, `HOUR`, `dayAt`, `candId`, and `seedIntegrityErrors()`. No DB import.
- `apps/api/src/db/seed.ts` (**modify**) - keep DB-touching `insertDemoData`/`reseedDemo`/`seedDemoIfEmpty`; import the data from `seed-data.ts`.
- `apps/api/src/db/seed-data.test.ts` (**new**) - node:test for `seedIntegrityErrors()`.
- `apps/api/src/admin/reset-auth.ts` (**new**) - `isAuthorizedReset(provided, expected)` token guard.
- `apps/api/src/admin/reset-auth.test.ts` (**new**) - node:test for the guard.
- `apps/api/src/index.ts` (**modify**) - register `POST /admin/reseed`.
- `infra/reseed-live.sh` (**new**) - one-command live reset wrapper.
- `package.json` (root, **modify**) - add `reseed:live` script.
- `docs/runbook-deploy.md` (**modify**) - add "Reset live demo data" section.
- App Runner service env (**infra, Task 8**) - add `ADMIN_RESET_TOKEN`.

Run from repo root unless noted. Verification commands: `pnpm typecheck`, `pnpm lint` (auto-fix with `pnpm format`), `pnpm --filter @bethere/api test`.

---

### Task 1: Extract pure demo data into `seed-data.ts` (refactor, no behavior change)

**Files:**
- Create: `apps/api/src/db/seed-data.ts`
- Modify: `apps/api/src/db/seed.ts`

- [ ] **Step 1: Create `apps/api/src/db/seed-data.ts`** with the types, constants, and helpers moved verbatim out of `seed.ts` (everything that does NOT touch `db`/`schema`):

```ts
import type { PartOfDay, PlanPhase, WhenMode } from "@bethere/shared";

export type Kind = "yes" | "no" | "conditional";

export const DEMO_USERS = [
  { id: "u_dev", name: "You", avatarColor: "#5F9472" },
  { id: "u_adi", name: "Adi", avatarColor: "#C77D54" },
  { id: "u_lily", name: "Lily", avatarColor: "#5B7DB1" },
  { id: "u_joe", name: "Joe", avatarColor: "#7E6BB0" },
  { id: "u_nathan", name: "Nathan", avatarColor: "#B0654F" },
  { id: "u_bethan", name: "Bethan", avatarColor: "#3F7BA8" },
  { id: "u_noah", name: "Noah", avatarColor: "#A8743F" },
  { id: "u_vasanth", name: "Vasanth", avatarColor: "#557A6B" },
  { id: "u_imogen", name: "Imogen", avatarColor: "#B05F86" },
  { id: "u_graham", name: "Graham", avatarColor: "#6B8E5A" },
  { id: "u_zara", name: "Zara", avatarColor: "#C28A3D" },
];

export const GROUPS = [
  { id: "g_boys", name: "The Boys", members: ["u_dev", "u_adi", "u_lily", "u_joe", "u_nathan", "u_bethan"] },
  { id: "g_climb", name: "Climbing Group", members: ["u_dev", "u_adi", "u_joe"] },
  { id: "g_knit", name: "Glitter Natters", members: ["u_dev", "u_lily", "u_bethan", "u_noah"] },
  { id: "g_church", name: "Church Group", members: ["u_dev", "u_joe", "u_noah"] },
  { id: "g_hs", name: "High School Reunion", members: ["u_dev", "u_vasanth", "u_imogen", "u_graham", "u_zara"] },
];

export const HOUR = 60 * 60 * 1000;

// A day relative to "now" at a fixed local hour, for legible demo candidate slots.
export function dayAt(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export interface Cand {
  suffix: string;
  startsAt: Date;
  partOfDay?: PartOfDay;
  label?: string;
  reactedBy?: string[];
}
export interface Resp {
  userId: string;
  kind: Kind;
  cond?: { mode: "all" | "any"; targetIds: string[] };
}
export interface Plan {
  id: string;
  groupId: string;
  createdBy: string;
  title: string;
  location?: string;
  whenMode: WhenMode;
  contingent: boolean;
  quorum: number;
  phase: PlanPhase;
  candidates: Cand[];
  chosenSuffix?: string;
  momentStartsAt?: Date;
  momentEndsAt?: Date;
  responses?: Resp[];
}

// Demo plans cover the (whenMode x phase) states the dashboard renders. Iteration-matched: only
// exact + options while fuzzy is hidden in the create UI (fuzzy plans return in iteration 3).
export const PLANS: Plan[] = [
  {
    id: "e_movie",
    groupId: "g_boys",
    createdBy: "u_dev",
    title: "Dune: Part Two",
    location: "Cineworld Bexleyheath",
    whenMode: "options",
    contingent: true,
    quorum: 3,
    phase: "collecting",
    candidates: [
      { suffix: "c1", startsAt: dayAt(2, 18), reactedBy: ["u_dev", "u_adi", "u_lily", "u_joe"] },
      { suffix: "c2", startsAt: dayAt(2, 20), reactedBy: ["u_dev", "u_nathan", "u_bethan"] },
      { suffix: "c3", startsAt: dayAt(3, 14), reactedBy: ["u_lily"] },
    ],
  },
  {
    id: "e_pub",
    groupId: "g_climb",
    createdBy: "u_adi",
    title: "Pub night",
    location: "The Lighthouse",
    whenMode: "options",
    contingent: true,
    quorum: 2,
    phase: "collecting",
    candidates: [
      { suffix: "c1", startsAt: dayAt(1, 19), reactedBy: ["u_adi", "u_joe"] },
      { suffix: "c2", startsAt: dayAt(2, 19), reactedBy: ["u_adi"] },
      { suffix: "c3", startsAt: dayAt(3, 20), reactedBy: ["u_joe"] },
    ],
  },
  {
    id: "e_bowling",
    groupId: "g_boys",
    createdBy: "u_adi",
    title: "Bowling",
    location: "TenPin Bowling, Bexleyheath",
    whenMode: "exact",
    contingent: false,
    quorum: 1,
    phase: "moment",
    candidates: [{ suffix: "c1", startsAt: dayAt(0, 19) }],
    chosenSuffix: "c1",
    momentStartsAt: new Date(Date.now() - HOUR),
    momentEndsAt: new Date(Date.now() + 8 * HOUR),
    responses: [
      { userId: "u_adi", kind: "yes" },
      { userId: "u_lily", kind: "yes" },
      { userId: "u_joe", kind: "yes" },
      { userId: "u_nathan", kind: "no" },
      { userId: "u_bethan", kind: "no" },
    ],
  },
  {
    id: "e_dinner",
    groupId: "g_hs",
    createdBy: "u_vasanth",
    title: "Dinner",
    location: "La Palombe",
    whenMode: "options",
    contingent: true,
    quorum: 2,
    phase: "cleared",
    candidates: [
      { suffix: "c1", startsAt: dayAt(-3, 20) },
      { suffix: "c2", startsAt: dayAt(-2, 20) },
    ],
    chosenSuffix: "c2",
    momentStartsAt: new Date(Date.now() - 50 * HOUR),
    momentEndsAt: new Date(Date.now() - 48 * HOUR),
    responses: [
      { userId: "u_dev", kind: "yes" },
      { userId: "u_vasanth", kind: "yes" },
      { userId: "u_imogen", kind: "yes" },
    ],
  },
  {
    id: "e_football",
    groupId: "g_boys",
    createdBy: "u_joe",
    title: "Football",
    location: "Goals Wembley",
    whenMode: "exact",
    contingent: false,
    quorum: 1,
    phase: "cleared",
    candidates: [{ suffix: "c1", startsAt: dayAt(-1, 10) }],
    chosenSuffix: "c1",
    momentStartsAt: new Date(Date.now() - 26 * HOUR),
    momentEndsAt: new Date(Date.now() - 24 * HOUR),
    responses: [
      { userId: "u_dev", kind: "no" },
      { userId: "u_joe", kind: "yes" },
    ],
  },
];

export function candId(planId: string, suffix: string): string {
  return `${planId}_${suffix}`;
}
```

> NOTE: this already contains the NEW iteration-matched `PLANS` (Task 3 is just verification of it). The old fuzzy plans (`e_pub` as fuzzy, `e_climbing`, `e_baking`) and `partOfDay` candidates are intentionally gone.

- [ ] **Step 2: Rewrite `apps/api/src/db/seed.ts`** to import from `seed-data.ts` and keep only the DB-touching parts. Full new file:

```ts
import { db } from "./client.js";
import {
  candidateReactions,
  eventCandidates,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "./schema.js";
import { candId, DEMO_USERS, GROUPS, PLANS } from "./seed-data.js";

async function insertDemoData(): Promise<void> {
  for (const u of DEMO_USERS) {
    await db
      .insert(users)
      .values(u)
      .onConflictDoUpdate({ target: users.id, set: { name: u.name, avatarColor: u.avatarColor } });
  }
  for (const g of GROUPS) {
    await db.insert(groups).values({ id: g.id, name: g.name }).onConflictDoNothing();
    for (const userId of g.members) {
      await db.insert(groupMembers).values({ groupId: g.id, userId }).onConflictDoNothing();
    }
  }
  for (const p of PLANS) {
    const sorted = [...p.candidates].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const chosen = p.chosenSuffix
      ? p.candidates.find((c) => c.suffix === p.chosenSuffix)
      : undefined;
    const startsAt = chosen?.startsAt ?? sorted[0].startsAt;
    const respondByAt = p.momentEndsAt ?? sorted[sorted.length - 1].startsAt;

    await db.insert(events).values({
      id: p.id,
      groupId: p.groupId,
      createdByUserId: p.createdBy,
      title: p.title,
      description: null,
      location: p.location ?? "",
      startsAt,
      respondByAt,
      status: p.phase === "cleared" || p.phase === "fizzled" ? "resolved" : "open",
      whenMode: p.whenMode,
      contingent: p.contingent,
      quorum: p.quorum,
      phase: p.phase,
      chosenCandidateId: chosen ? candId(p.id, chosen.suffix) : null,
      momentStartsAt: p.momentStartsAt ?? null,
      momentEndsAt: p.momentEndsAt ?? null,
    });

    for (const c of p.candidates) {
      await db.insert(eventCandidates).values({
        id: candId(p.id, c.suffix),
        eventId: p.id,
        startsAt: c.startsAt,
        partOfDay: c.partOfDay ?? null,
        label: c.label ?? null,
      });
      for (const userId of c.reactedBy ?? []) {
        await db
          .insert(candidateReactions)
          .values({ eventId: p.id, candidateId: candId(p.id, c.suffix), userId });
      }
    }

    for (const r of p.responses ?? []) {
      await db.insert(responses).values({
        id: `r_${p.id}_${r.userId}`,
        eventId: p.id,
        userId: r.userId,
        kind: r.kind,
        cond: r.cond ?? null,
      });
    }
  }
}

// Wipe + re-insert the clean demo (local dev: SEED_ON_BOOT defaults to "reset").
export async function reseedDemo(): Promise<void> {
  await db.delete(responses);
  await db.delete(candidateReactions);
  await db.delete(eventCandidates);
  await db.delete(events);
  await db.delete(groupMembers);
  await db.delete(groups);
  await db.delete(users);
  await insertDemoData();
}

// Seed only when there are no events yet (live backend: redeploys never wipe real data).
export async function seedDemoIfEmpty(): Promise<void> {
  const existing = await db.select({ id: events.id }).from(events).limit(1);
  if (existing.length > 0) return;
  await insertDemoData();
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both `Done` / "No fixes applied" (run `pnpm format` if lint flags formatting, then re-run `pnpm lint`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/db/seed-data.ts apps/api/src/db/seed.ts
git commit -m "refactor(api): split pure demo data into seed-data.ts + iteration-matched plan set"
```

---

### Task 2: Add `seedIntegrityErrors()` + tests (TDD)

**Files:**
- Modify: `apps/api/src/db/seed-data.ts`
- Test: `apps/api/src/db/seed-data.test.ts`

- [ ] **Step 1: Write the failing test** at `apps/api/src/db/seed-data.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Plan, seedIntegrityErrors } from "./seed-data.js";

test("the committed demo seed is referentially sound", () => {
  assert.deepEqual(seedIntegrityErrors(), []);
});

test("flags a reaction by someone not in the group", () => {
  const users = [{ id: "u_a" }, { id: "u_b" }];
  const groups = [{ id: "g1", members: ["u_a"] }];
  const plans: Plan[] = [
    {
      id: "p1", groupId: "g1", createdBy: "u_a", title: "T",
      whenMode: "options", contingent: true, quorum: 2, phase: "collecting",
      candidates: [{ suffix: "c1", startsAt: new Date(), reactedBy: ["u_b"] }],
    },
  ];
  const errs = seedIntegrityErrors(users, groups, plans);
  assert.ok(errs.some((e) => e.includes("u_b")), `expected a u_b error, got ${JSON.stringify(errs)}`);
});

test("flags a chosenSuffix that matches no candidate", () => {
  const users = [{ id: "u_a" }];
  const groups = [{ id: "g1", members: ["u_a"] }];
  const plans: Plan[] = [
    {
      id: "p1", groupId: "g1", createdBy: "u_a", title: "T",
      whenMode: "exact", contingent: false, quorum: 1, phase: "cleared",
      candidates: [{ suffix: "c1", startsAt: new Date() }],
      chosenSuffix: "c9",
    },
  ];
  const errs = seedIntegrityErrors(users, groups, plans);
  assert.ok(errs.some((e) => e.includes("chosenSuffix")), `expected a chosenSuffix error, got ${JSON.stringify(errs)}`);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bethere/api test`
Expected: FAIL - `seedIntegrityErrors` is not exported (import error / "not a function").

- [ ] **Step 3: Implement `seedIntegrityErrors()`** - append to `apps/api/src/db/seed-data.ts`:

```ts
// Pure structural checks on the demo data: referential integrity + model coherence. Runs without a
// DB so unit tests (and a quick local sanity check) catch a stale reference the moment it appears.
export function seedIntegrityErrors(
  users: { id: string }[] = DEMO_USERS,
  groups: { id: string; members: string[] }[] = GROUPS,
  plans: Plan[] = PLANS,
): string[] {
  const errors: string[] = [];
  const userIds = new Set(users.map((u) => u.id));
  const groupById = new Map(groups.map((g) => [g.id, g]));

  for (const g of groups) {
    for (const m of g.members) {
      if (!userIds.has(m)) errors.push(`group ${g.id}: member ${m} is not a known user`);
    }
  }

  for (const p of plans) {
    const g = groupById.get(p.groupId);
    if (!g) {
      errors.push(`plan ${p.id}: unknown group ${p.groupId}`);
      continue;
    }
    const members = new Set(g.members);
    if (!userIds.has(p.createdBy)) errors.push(`plan ${p.id}: creator ${p.createdBy} is not a known user`);
    if (!members.has(p.createdBy)) errors.push(`plan ${p.id}: creator ${p.createdBy} is not in group ${p.groupId}`);

    if (p.candidates.length === 0) errors.push(`plan ${p.id}: has no candidates`);
    if (p.whenMode === "exact" && p.candidates.length !== 1) {
      errors.push(`plan ${p.id}: exact plan must have exactly 1 candidate, has ${p.candidates.length}`);
    }

    const suffixes = new Set<string>();
    for (const c of p.candidates) {
      if (suffixes.has(c.suffix)) errors.push(`plan ${p.id}: duplicate candidate suffix ${c.suffix}`);
      suffixes.add(c.suffix);
      for (const u of c.reactedBy ?? []) {
        if (!members.has(u)) errors.push(`plan ${p.id}: reaction by ${u} who is not in group ${p.groupId}`);
      }
    }

    if (p.chosenSuffix && !suffixes.has(p.chosenSuffix)) {
      errors.push(`plan ${p.id}: chosenSuffix ${p.chosenSuffix} matches no candidate`);
    }
    const needsChosen = p.phase === "moment" || p.phase === "cleared" || p.phase === "fizzled";
    if (needsChosen && !p.chosenSuffix) errors.push(`plan ${p.id}: phase ${p.phase} requires a chosenSuffix`);
    if (p.phase === "collecting" && p.chosenSuffix) {
      errors.push(`plan ${p.id}: collecting plan should not have a chosenSuffix`);
    }

    for (const r of p.responses ?? []) {
      if (!members.has(r.userId)) errors.push(`plan ${p.id}: response by ${r.userId} who is not in group ${p.groupId}`);
    }
  }
  return errors;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @bethere/api test`
Expected: PASS - all three new tests green (the committed seed returns `[]`; the two broken fixtures each surface an error). Existing auth tests still pass.

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/db/seed-data.ts apps/api/src/db/seed-data.test.ts
git commit -m "test(api): add seed integrity validator + tests"
```

---

### Task 3: Verify the new demo against the schema (local boot)

> The new `PLANS` already landed in Task 1. This task proves it actually inserts cleanly (catches any NOT-NULL/enum drift the type system can't) and renders the intended dashboard.

**Files:** none (verification only).

- [ ] **Step 1: Start a clean local DB + API**

Run: `pnpm db:up` then (in another shell) `pnpm dev:api`
Expected: boot logs show `migrations applied` then `seeded demo data (reset)` with NO error (the boot calls `reseedDemo()` because local `SEED_ON_BOOT` defaults to `reset`). If it throws (e.g. a column the seed does not set), fix `seed-data.ts` and reboot.

- [ ] **Step 2: Sanity-check the dashboard data** (dev bypass user `u_dev`):

Run: `curl -fsS http://localhost:3000/trpc/events.mine -H 'x-user-id: u_dev' | head -c 600`
Expected: JSON listing the 5 plans; `e_movie` shows `isCreator:true` and `readyToLock:true`, `e_pub` shows `iReacted:false`, `e_bowling` is `phase:"moment"`, plus the cleared `e_dinner`/`e_football`. No `fuzzy` plans.

- [ ] **Step 3: Stop the dev server.** No commit (verification only). If Step 1/2 forced a `seed-data.ts` fix, commit it:

```bash
git add apps/api/src/db/seed-data.ts
git commit -m "fix(api): align demo seed with current schema"
```

---

### Task 4: Reset token guard `isAuthorizedReset` + tests (TDD)

**Files:**
- Create: `apps/api/src/admin/reset-auth.ts`
- Test: `apps/api/src/admin/reset-auth.test.ts`

- [ ] **Step 1: Write the failing test** at `apps/api/src/admin/reset-auth.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isAuthorizedReset } from "./reset-auth.js";

test("disabled when no token is configured", () => {
  assert.equal(isAuthorizedReset("anything", undefined), false);
  assert.equal(isAuthorizedReset("anything", ""), false);
});

test("rejects a missing or wrong token", () => {
  assert.equal(isAuthorizedReset(undefined, "secret"), false);
  assert.equal(isAuthorizedReset("secres", "secret"), false); // same length, wrong value
  assert.equal(isAuthorizedReset("no", "secret"), false); // different length
});

test("accepts the exact token", () => {
  assert.equal(isAuthorizedReset("secret", "secret"), true);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bethere/api test`
Expected: FAIL - module `./reset-auth.js` not found.

- [ ] **Step 3: Implement** `apps/api/src/admin/reset-auth.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @bethere/api test`
Expected: PASS - all reset-auth tests green; seed + auth tests still green.

- [ ] **Step 5: Typecheck + lint, then commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/admin/reset-auth.ts apps/api/src/admin/reset-auth.test.ts
git commit -m "feat(api): add constant-time reseed token guard"
```

---

### Task 5: Wire the `POST /admin/reseed` route

**Files:**
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add the import.** In `apps/api/src/index.ts`, the seed import already reads `import { reseedDemo, seedDemoIfEmpty } from "./db/seed.js";`. Add directly below it:

```ts
import { isAuthorizedReset } from "./admin/reset-auth.js";
```

- [ ] **Step 2: Register the route** immediately AFTER the `await server.register(fastifyTRPCPlugin, { ... })` block and BEFORE the `if (process.env.DB_RESET_ON_BOOT === "true")` block:

```ts
// Ops-only: wipe + reinstall the demo seed without a redeploy. Disabled (403) unless
// ADMIN_RESET_TOKEN is set; the secret is checked in constant time. Destructive, so it logs loudly.
// Deliberately a raw route, NOT a tRPC procedure, so it stays out of the mobile client's typed surface.
server.post("/admin/reseed", async (req, reply) => {
  const header = req.headers["x-admin-token"];
  const provided = typeof header === "string" ? header : undefined;
  if (!isAuthorizedReset(provided, process.env.ADMIN_RESET_TOKEN)) {
    return reply.code(403).send({ error: "forbidden" });
  }
  req.log.warn({ scope: "admin" }, "admin reseed invoked");
  await reseedDemo();
  req.log.warn({ scope: "admin" }, "admin reseed completed");
  return { ok: true as const };
});
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: both clean (`pnpm format` if needed).

- [ ] **Step 4: Manual guard check against local API.** With `pnpm db:up` + `pnpm dev:api` running (note: locally `ADMIN_RESET_TOKEN` is unset):

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/admin/reseed
```
Expected: `403` (disabled - no token configured locally). Then test the enabled path:
```bash
ADMIN_RESET_TOKEN=testtoken pnpm dev:api   # restart with a token
# in another shell:
curl -s -X POST http://localhost:3000/admin/reseed -H 'x-admin-token: wrong'      # -> {"error":"forbidden"}, 403
curl -s -X POST http://localhost:3000/admin/reseed -H 'x-admin-token: testtoken'  # -> {"ok":true}, and the API log shows "admin reseed invoked/completed"
```
Expected: wrong/absent token -> 403; correct token -> `{"ok":true}`. Stop the server afterward.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(api): token-gated POST /admin/reseed route"
```

---

### Task 6: Live reset script + pnpm command

**Files:**
- Create: `infra/reseed-live.sh`
- Modify: `package.json` (root)

- [ ] **Step 1: Create `infra/reseed-live.sh`:**

```bash
#!/usr/bin/env bash
# Wipe + reinstall the demo seed on a deployed BeThere API (no redeploy). Requires ADMIN_RESET_TOKEN
# in the environment (kept out of git); override the target with BETHERE_API_URL.
set -euo pipefail
BASE="${BETHERE_API_URL:-https://96mgvmgcbj.us-east-1.awsapprunner.com}"
: "${ADMIN_RESET_TOKEN:?Set ADMIN_RESET_TOKEN in your environment (it is not committed).}"
echo "Reseeding ${BASE} ..."
curl -fsS -X POST "${BASE}/admin/reseed" -H "x-admin-token: ${ADMIN_RESET_TOKEN}"
echo
echo "Done."
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x infra/reseed-live.sh`

- [ ] **Step 3: Add the root pnpm script.** In the root `package.json`, add to the `scripts` object:

```json
"reseed:live": "bash infra/reseed-live.sh"
```

- [ ] **Step 4: Lint (Biome ignores .sh; confirm package.json formats)**

Run: `pnpm lint`
Expected: clean (`pnpm format` if package.json reflow flagged).

- [ ] **Step 5: Commit**

```bash
git add infra/reseed-live.sh package.json
git commit -m "chore: add reseed:live one-command live reset"
```

---

### Task 7: Document the reset in the runbook

**Files:**
- Modify: `docs/runbook-deploy.md`

- [ ] **Step 1: Append a new section** to the end of `docs/runbook-deploy.md`:

```markdown
## Reset live demo data

Wipe + reinstall the demo seed on the live API WITHOUT a redeploy. Gated by the
`ADMIN_RESET_TOKEN` env var on the App Runner service - the endpoint returns 403 if the var is
unset, so it is inert anywhere the secret is not configured (e.g. local dev, which already
reseeds on every boot).

```bash
ADMIN_RESET_TOKEN=<the secret> pnpm reseed:live
# or directly:
ADMIN_RESET_TOKEN=<the secret> curl -fsS -X POST \
  https://96mgvmgcbj.us-east-1.awsapprunner.com/admin/reseed -H "x-admin-token: $ADMIN_RESET_TOKEN"
# -> {"ok":true}
```

The token lives only in the App Runner service env (and the team password manager) - never in git.
It wipes ALL data and restores `apps/api/src/db/seed.ts`'s demo, so give the team a heads-up first.
To rotate, update `ADMIN_RESET_TOKEN` in the App Runner console (one deploy).
```
````

> NOTE for the implementer: in the file, use a normal triple-backtick fence for the bash block above (it is shown nested here only to embed it in this plan).

- [ ] **Step 2: Commit**

```bash
git add docs/runbook-deploy.md
git commit -m "docs: runbook section for resetting live demo data"
```

---

### Task 8: Provision `ADMIN_RESET_TOKEN` on App Runner + reseed live (OPS - destructive)

> Run by the operator with AWS creds (account 208569836255). **This wipes the live DB.** Confirm with the team first. Do this only AFTER Tasks 1-7 are merged/deployed (the route must exist in the running image; auto-deploy on `:latest` ships it on push to `main`).

**Files:** none (mutates App Runner service env).

- [ ] **Step 1: Generate a token and add it to the service env** (preserving all existing vars via `jq`):

```bash
ARN=arn:aws:apprunner:us-east-1:208569836255:service/bethere-api/260292b3564d41d6b60e9e2129a0263b
TOKEN=$(openssl rand -hex 24)
echo "ADMIN_RESET_TOKEN=$TOKEN   # store this in the team password manager"
aws apprunner describe-service --region us-east-1 --service-arn "$ARN" \
  --query 'Service.SourceConfiguration' --output json > /tmp/srccfg.json
jq --arg t "$TOKEN" \
  '.ImageRepository.ImageConfiguration.RuntimeEnvironmentVariables.ADMIN_RESET_TOKEN = $t' \
  /tmp/srccfg.json > /tmp/srccfg.new.json
aws apprunner update-service --region us-east-1 --service-arn "$ARN" \
  --source-configuration "file:///tmp/srccfg.new.json"
```
Expected: the call returns an `OperationId` and the service enters `OPERATION_IN_PROGRESS`.

- [ ] **Step 2: Wait for the deploy to settle**

```bash
aws apprunner list-operations --region us-east-1 --service-arn "$ARN" --max-results 1 \
  --query 'OperationSummaryList[0].[Type,Status]' --output text
```
Expected: eventually `UPDATE_SERVICE  SUCCEEDED` and `describe-service ... Service.Status` -> `RUNNING`.

- [ ] **Step 3: Confirm health, then reseed**

```bash
curl -fsS https://96mgvmgcbj.us-east-1.awsapprunner.com/trpc/health   # {"result":{"data":{"ok":true}}}
ADMIN_RESET_TOKEN=$TOKEN pnpm reseed:live                              # {"ok":true}
```

- [ ] **Step 4: Verify the live data** is the fresh demo (open the app, or):

```bash
curl -fsS https://96mgvmgcbj.us-east-1.awsapprunner.com/trpc/events.mine -H 'x-user-id: u_dev' | head -c 600
```
Expected: the 5-plan demo (no fuzzy), `e_movie` ready-to-lock for `u_dev`, `e_pub` not-yet-reacted.

- [ ] **Step 5: Record the token** in the team password manager. (No git commit; this is infra state.)

---

## Self-Review

**Spec coverage:**
- Iteration-matched seed (exact + options, drop fuzzy) -> Tasks 1 & 3. ✓
- Token-gated `POST /admin/reseed`, disabled-without-env, constant-time, loud logging, raw (non-tRPC) -> Tasks 4 & 5. ✓
- One-command live reset + runbook docs -> Tasks 6 & 7. ✓
- Sync guardrails (typecheck + reseed-on-boot + integrity validator) -> Task 2 (validator) + Task 3 (boot) + the existing typecheck. ✓
- One-time `ADMIN_RESET_TOKEN` setup on App Runner (jq-preserve env) -> Task 8. ✓
- Files-to-change list -> covered; refinement: `seed.ts` split into `seed-data.ts` for DB-free testing (noted in File Structure).

**Placeholder scan:** No TBD/TODO; every code/file/command step shows full content. The runbook nested-fence note is an instruction, not a placeholder.

**Type/name consistency:** `seedIntegrityErrors(users, groups, plans)` and `Plan`/`Cand`/`Resp`/`candId`/`DEMO_USERS`/`GROUPS`/`PLANS` are defined in Task 1 and used consistently in Tasks 2-3; `isAuthorizedReset(provided, expected)` defined in Task 4, used in Task 5; route header `x-admin-token` and env `ADMIN_RESET_TOKEN` consistent across Tasks 5-8; `reseedDemo` reused as-is.

**Risks:** destructive prod endpoint (gated + logged + rate-limited); reseed wipes teammates' test data (heads-up); `aws apprunner update-service` must round-trip the full `SourceConfiguration` (incl. ECR `AuthenticationConfiguration`) - Task 8 uses `describe-service`'s own output to avoid drift; if `--source-configuration file://` is rejected, pass the JSON inline instead.
