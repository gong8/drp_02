# Refactor report - 2026-06-08

**Branch:** `refactor/simplify-pass` | **Mode:** `apply + aggressive` (whole repo) | **Tracking:** [DRP-52](https://linear.app/drp-02/issue/DRP-52) (parent)

## Executive summary

A massively-parallel, multi-lens code-quality pass (`/simplify-refactor`) reviewed every in-scope source file in the monorepo through abstraction, duplication, component-reuse, naming, complexity, dead-code and consistency lenses, then adversarially verified each candidate. This is a **behavior-preserving cleanup** only: no feature, API, DB-schema or UX changes.

- **28 verified refactor clusters** survived from 188 raw findings (96 file reviewers + 6 cross-cutting sweeps), 55 candidate clusters, and a per-cluster adversarial refutation pass (28/55 survived).
- Every surviving cluster is **low risk** and **behavior-preserving**; most are size **S**, a few **M**. None require API/DB/UX changes.
- The mess concentrates in two hotspots: `apps/api/src/routers/events.ts` (1117 lines, ~9 clusters - duplicated read/mapper/guard logic between its single-event and bulk readers) and the mobile screens (`EventDetail.tsx`, `CreateWizard.tsx`) plus `lib/format.ts`.
- Highest-value wins: fixing the **N+1 member-card query** in `groups.get`, **unifying the event row mappers** so the single-event and dashboard-bundle read paths can no longer silently drift, and extracting the repeated **settle+phase-guard** and **candidate selector/comparator** logic in `events.ts`.
- The intentional cross-package mirrors (mobile `lib/lock.ts` / `lib/invite.ts` vs `packages/shared`, kept because mobile must import `@bethere/shared` type-only) were respected: no cluster collapses them; one cluster instead **adds the missing drift-guard test** for the invite mirror.

### Stats

| Stage | Count |
|---|---|
| File reviewers (Phase 1) | 96 |
| Raw findings | 142 |
| After cross-cut (Phase 2) | 188 |
| Candidate clusters (Phase 3) | 55 |
| Survived adversarial verify (Phase 4) | 28 |
| Synthesized epics | 28 |
| Total agents | 186 |

## Prioritized roadmap

_Priority = (impact x reach) / effort, ties to lower risk. "Apply #" is the safe sequential apply order (same-file clusters contiguous, renames/naming last)._

| Pri | Apply # | Cluster | Effort | Risk | Impact | Files |
|---|---|---|---|---|---|---|
| 1 | 4 | Unify the per-event vs bulk row mappers in events.ts (responses, reactions, candidate sort) | S | low | med | 1 |
| 2 | 3 | Extract a time-candidate selector + readyToLock derivation in events.ts | S | low | med | 1 |
| 3 | 22 | Add an invite-mirror drift test and re-sync the lock.ts mobile mirror structure | S | low | med | 2 |
| 4 | 12 | Refresh stale schema.ts comments and document the frozen legacy columns (status, isAnonymous) | S | low | med | 2 |
| 5 | 17 | Route DateTimeField's time label through lib/format and tokenize the web shadow | S | low | low | 4 |
| 6 | 26 | Have PersonRow own the trailing 'right' slot alignment instead of caller marginLeft:auto | S | low | low | 3 |
| 7 | 5 | Extract the settle+phase-gate preamble shared by 5 gated mutations in events.ts | M | low | med | 1 |
| 8 | 11 | Use batched getUserCards in groups.get (drop the N+1 per-member roster query) | S | low | low | 1 |
| 9 | 7 | Name the UserCard shape and centralize the row-to-card projection in db/users.ts | S | low | low | 2 |
| 10 | 9 | Fix shared/schemas.ts naming and doc drift (ResolveInput/ByGroupInput comments, NOTES_MAX) | S | low | low | 2 |
| 11 | 27 | Introduce an uppercase-overline text primitive/variant and route the inline copies through it | S | low | low | 2 |
| 12 | 1 | Extract the shared candidate-sort comparator (startsAt asc, activities last) in events.ts | S | low | low | 1 |
| 13 | 2 | Extract the activity-candidate {id,label} projection feeding resolveActivity/displayActivity | S | low | low | 1 |
| 14 | 8 | Tighten events.ts exports and local naming (loadEvent export, 'now' alias, 'existing' var) | S | low | low | 1 |
| 15 | 6 | Consolidate repeated error-message literals and the caller opt-out clear in events.ts | S | low | low | 1 |
| 16 | 23 | Remove the dead add-time partOfDay parameter and the redundant CollectingView optedOut prop | S | low | low | 1 |
| 17 | 21 | Adopt useBusyAction in GroupDetail and fix its now-stale doc comment | S | low | low | 2 |
| 18 | 28 | Simplify CreateWizard derived state (replyShown fallback, activity count/list, canAdvance, STEPS) | S | low | low | 1 |
| 19 | 25 | Replace EventDetail's StatusHeading raw Text with AppText variant="rowLabel" | S | low | low | 1 |
| 20 | 16 | Remove the orphaned formatCountdown vocabulary (and its dead SEC_MS const) | S | low | low | 2 |
| 21 | 10 | Extract the resolve-group-by-invite-code preamble in groups.ts | S | low | low | 1 |
| 22 | 14 | Remove the dead shared formatInviteCode helper | S | low | low | 1 |
| 23 | 24 | Make saveEdit's field descriptors the single source for the conflict-adopt mapping | M | low | low | 1 |
| 24 | 18 | Single-source the wizard step list in lib/redo.ts | S | low | low | 1 |
| 25 | 15 | Single-source the weekday/day/month label in lib/format (dayUpper kept as-is) | S | low | low | 1 |
| 26 | 19 | Dedupe the "Who's in?" moment-open notification content in syncReminders | S | low | low | 1 |
| 27 | 20 | Remove the dead VERB_VOTE / VERB_VOTED copy constants | S | low | low | 1 |
| 28 | 13 | Single-source the harness table list and derive its insert-override unions from the schema | M | low | low | 1 |

## Clusters (detail)

### 1. Unify the per-event vs bulk row mappers in events.ts (responses, reactions, candidate sort)

`unify-event-row-mappers` - **effort** S | **risk** low | **impact** med | **apply #4** (`api/events`)

**Problem.** In apps/api/src/routers/events.ts the bulk reader loadEventBundle re-implements three row->domain mappings that the single-event readers already own, so the two paths can silently drift. The response mapping is duplicated (responsesFor:54 vs loadEventBundle:353), the reaction mapping is duplicated (reactionsFor:62 vs loadEventBundle:373), and the candidate startsAt-asc/nulls-last sort is duplicated (candidatesFor:67-71 vs loadEventBundle:363-368). Extract three module-level pure helpers (toMomentResponse, toReaction, byStartsAt) and reuse them on both sides. All changes are inside one file, behavior-preserving: no API shape, DB, or UX change, and no mobile/shared cross-package import. The plan-time-field ISO projection in events.mine (911-917) vs events.get (1044-1053) is deliberately left as-is - the blocks differ (mine has createdAt; get layers replyBy/chosenStartsAt/activityRaw) and the calls are trivial .toISOString()/msLeft, so a helper there earns little and risks obscuring the difference.

**Why it matters.** Three byte-identical row->domain mappings live in two places each in the hottest reader file (events.ts). Because the single-event and bulk-card paths feed the same client shapes, any future edit to one mapping (e.g. adding a field to MomentResponse, changing cond null-handling, or the candidate ordering) must be mirrored by hand or the two paths drift, producing per-card vs per-screen inconsistencies that are hard to spot. Extracting three tiny pure helpers makes drift impossible by construction at near-zero cost and no behavioral risk - top priority because impact x reach (every event read) over a trivial effort is the best ratio in the cluster, and risk is minimal (pure, single-file, type-checked).

**Change steps.**
1. Add a pure mapper `const toMomentResponse = (r: typeof responses.$inferSelect): MomentResponse => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined });` near the top-of-file helpers (just above responsesFor at line 52). MomentResponse is already imported (line 14).
2. In responsesFor (line 54) replace the inline `.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined }))` with `.map(toMomentResponse)`.
3. In loadEventBundle's response loop (line 353) replace the inline `list.push({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined })` with `list.push(toMomentResponse(r))`.
4. Add a pure mapper `const toReaction = (r: typeof candidateReactions.$inferSelect) => ({ candidateId: r.candidateId, userId: r.userId });` next to toMomentResponse.
5. In reactionsFor (line 62) replace `.map((r) => ({ candidateId: r.candidateId, userId: r.userId }))` with `.map(toReaction)`.
6. In loadEventBundle's reaction loop (line 373) replace `list.push({ candidateId: r.candidateId, userId: r.userId })` with `list.push(toReaction(r))`.
7. Add a shared comparator `const byStartsAt = (a: typeof eventCandidates.$inferSelect, b: typeof eventCandidates.$inferSelect) => (a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY);` near the other helpers.
8. In candidatesFor (lines 67-71) replace the inline `.sort((a, b) => { ... })` with `.sort(byStartsAt)`.
9. In loadEventBundle's candidate sort (lines 363-368) replace the inline `list.sort((a, b) => { ... })` with `list.sort(byStartsAt)`, and keep/trim the `// Preserve candidatesFor's order: startsAt asc, nulls (activities) last.` comment so intent stays documented.
10. Do NOT touch the events.mine (911-917) vs events.get (1044-1053) time-field ISO projection - leave both inline (out of scope, low value).
11. Run pnpm lint && pnpm typecheck && pnpm test, then commit to dev as a single behavior-preserving cleanup commit.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (two definitions per mapping):
  // responsesFor (line 52-55)
  async function responsesFor(eventId) {
    const rows = await db.select().from(responses).where(eq(responses.eventId, eventId));
    return rows.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined }));
  }
  // loadEventBundle (line 350-355)
  for (const r of respRows) {
    const list = respMap.get(r.eventId) ?? [];
    list.push({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined });
    respMap.set(r.eventId, list);
  }
  // reactionsFor (line 62)  .map((r) => ({ candidateId: r.candidateId, userId: r.userId }))
  // loadEventBundle (line 373)  list.push({ candidateId: r.candidateId, userId: r.userId });
  // candidatesFor (67-71) and loadEventBundle (364-368): identical inline startsAt-asc sort

AFTER (one definition, reused):
  const toMomentResponse = (r: typeof responses.$inferSelect): MomentResponse =>
    ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined });
  const toReaction = (r: typeof candidateReactions.$inferSelect) =>
    ({ candidateId: r.candidateId, userId: r.userId });
  const byStartsAt = (a, b: typeof eventCandidates.$inferSelect) =>
    (a.startsAt?.getTime() ?? Infinity) - (b.startsAt?.getTime() ?? Infinity);

  responsesFor:   rows.map(toMomentResponse)
  loadEventBundle: list.push(toMomentResponse(r))   // responses loop
  reactionsFor:   rows.map(toReaction)
  loadEventBundle: list.push(toReaction(r))          // reaction loop
  candidatesFor:  rows.sort(byStartsAt)
  loadEventBundle: list.sort(byStartsAt)             // per-event candidate list
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 2. Extract a time-candidate selector + readyToLock derivation in events.ts

`extract-time-candidate-selector-and-readytolock-events` - **effort** S | **risk** low | **impact** med | **apply #3** (`api/events`)

**Problem.** In apps/api/src/routers/events.ts the "usable time candidate" predicate (kind === "time" && startsAt != null) is open-coded at five sites (settleCollecting :214, addCandidate :707, lock :784, mine :900, get :989; three of them immediately .map to ids), and the creator readyToLock rule (timeIds -> pickWinningCandidate(...) !== null) is duplicated between mine (:901) and get (:1008-1011). Introduce two local, behavior-preserving helpers: a predicate `isTimeCand` and a small `isReadyToLock` derivation, naming each rule once. This is a pure consolidation - no API shape, DB, or behavior change. The existing `as Date` casts after each filter stay valid because the predicate still narrows startsAt to non-null at the value level.

**Why it matters.** Five copies of the same predicate and two copies of the lock-readiness rule mean any future change to what counts as a usable time candidate (e.g. a third kind, or stricter startsAt handling) or to the quorum/winner rule has to be made in lockstep across the hottest router in the codebase, where a missed site is a silent correctness bug. Naming each rule once removes that drift surface, makes the lock lifecycle self-documenting, and is verifiably behavior-preserving (typecheck + tests cover the cast-narrowing dependency). Ranked priority 1: highest reach (5+2 sites in the core events router) at S effort and low risk.

**Change steps.**
1. Add a module-local predicate near the candidate helpers (around the candidatesFor definition at :65): `const isTimeCand = (c: typeof eventCandidates.$inferSelect) => c.kind === "time" && c.startsAt != null;`
2. Replace the inline filter at settleCollecting :214 (`cands.filter((c) => c.kind === "time" && c.startsAt)`) with `cands.filter(isTimeCand)`.
3. Replace the inline filter at addCandidate :707 (`existing.filter((c) => c.kind === "time" && c.startsAt)`) with `existing.filter(isTimeCand)`, keeping the following `.map((c) => (c.startsAt as Date).getTime())`.
4. Replace the inline filter at lock :784 (`cands.filter((c) => c.kind === "time" && c.startsAt)`) with `cands.filter(isTimeCand)`.
5. Replace the inline filter at mine :900 (`cands.filter((c) => c.kind === "time" && c.startsAt).map((c) => c.id)`) with `cands.filter(isTimeCand).map((c) => c.id)`.
6. Replace the inline filter at get :989 (`cands.filter((c) => c.kind === "time" && c.startsAt)`) with `cands.filter(isTimeCand)`, keeping the following `.map((c) => ({ id: c.id, startsAt: (c.startsAt as Date).toISOString(), ... }))`.
7. Add a module-local derivation: `function isReadyToLock(timeIds: string[], reactions: { candidateId: string; userId: string }[], quorum: number): boolean { return pickWinningCandidate(timeIds, reactions, quorum) !== null; }`.
8. In mine, replace :901 `readyToLock = pickWinningCandidate(timeIds, reactions, e.quorum) !== null;` with `readyToLock = isReadyToLock(timeIds, reactions, e.quorum);` (keep the surrounding `if (isCreator)` gate at :899).
9. In get, replace the `pickWinningCandidate(timeIds, reactions, e.quorum) !== null` term at :1008-1011 with `isReadyToLock(timeIds, reactions, e.quorum)`, keeping the `isCreator && e.phase === "collecting" &&` gate and the existing `const timeIds = timeCandidates.map((c) => c.id);` (do NOT introduce a timeIdsOf helper here - get derives timeIds from the already-mapped DTO array, not a fresh filter+map).
10. Run pnpm typecheck and pnpm test (and pnpm lint) - the casts depend on isTimeCand keeping value-level narrowing, so typecheck is the guard against a regression.

<details><summary>Before / after sketch</summary>

```ts
Before (5 filter sites, all open-coding the same predicate):
  // :214
  const timeCands = cands.filter((c) => c.kind === "time" && c.startsAt);
  // :707
  const times = existing.filter((c) => c.kind === "time" && c.startsAt).map((c) => (c.startsAt as Date).getTime());
  // :784
  const timeCands = cands.filter((c) => c.kind === "time" && c.startsAt);
  // :900
  const timeIds = cands.filter((c) => c.kind === "time" && c.startsAt).map((c) => c.id);
  // :989
  const timeCandidates = cands.filter((c) => c.kind === "time" && c.startsAt).map((c) => ({ ... }));

Before (readyToLock duplicated):
  // mine :901
  readyToLock = pickWinningCandidate(timeIds, reactions, e.quorum) !== null;
  // get :1008-1011
  const readyToLock = isCreator && e.phase === "collecting" && pickWinningCandidate(timeIds, reactions, e.quorum) !== null;

After (helpers named once, near candidatesFor):
  const isTimeCand = (c: typeof eventCandidates.$inferSelect) => c.kind === "time" && c.startsAt != null;
  function isReadyToLock(timeIds: string[], reactions: { candidateId: string; userId: string }[], quorum: number): boolean {
    return pickWinningCandidate(timeIds, reactions, quorum) !== null;
  }
  // :214/784/989: cands.filter(isTimeCand)
  // :707: existing.filter(isTimeCand).map((c) => (c.startsAt as Date).getTime())
  // :900: cands.filter(isTimeCand).map((c) => c.id)
  // mine :901: readyToLock = isReadyToLock(timeIds, reactions, e.quorum);
  // get :1008-1011: isCreator && e.phase === "collecting" && isReadyToLock(timeIds, reactions, e.quorum)

The isCreator/phase gates stay at each call site (they differ structurally); only the lock-readiness rule and the time-candidate predicate get named.
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 3. Add an invite-mirror drift test and re-sync the lock.ts mobile mirror structure

`invite-mirror-drift-test-and-lock-resync` - **effort** S | **risk** low | **impact** med | **apply #22** (`mobile`)

**Problem.** The two intentional cross-package mirrors are unevenly protected. apps/mobile/src/lib/lock.ts has a drift-guard test (lock-mirror.test.ts) that pins it against packages/shared/src/logic/lock.ts; apps/mobile/src/lib/invite.ts has no equivalent, even though it likewise duplicates packages/shared/src/logic/invite.ts. The invite mirror is also harder to spot because the names diverge (CODE_LENGTH vs INVITE_CODE_LENGTH, formatCode vs formatInviteCode, normalizeCode vs normalizeInviteCode), so a grep on one will not surface the other. Separately, the lock mirror itself has drifted structurally from its source: function order differs (mobile is defaultDecidesByForCandidates -> addCandidateHorizon -> defaultReplyByMs; shared is defaultDecidesByForCandidates -> defaultReplyByMs -> addCandidateHorizon) and the JSDoc on the shared functions has been stripped from the mobile copy, so a side-by-side diff shows noise. This epic adds the missing invite drift test and re-aligns the lock mirror's structure/comments. All work is test-only or pure comment/ordering: no runtime behavior, API shape, DB schema, or UX changes.

**Why it matters.** The invite mirror is currently a silent-drift hazard: it duplicates shared invite logic that a typed code must round-trip through groups.joinByCode, yet nothing fails if one copy edits and the other does not - and the divergent names mean a grep won't even reveal the pair. lock.ts already proved the drift-guard pattern works, so cloning it for invite is cheap (one test file, no new harness, exact existing relative-import idiom) and directly buys the same protection on a join-flow-critical primitive. The lock re-sync is a lower-value polish that makes the canonical-vs-mirror diff trivially readable. Both are S-effort, low-risk, and touch nothing user-visible, so the test (the load-bearing half) ranks first.

**Change steps.**
1. 1. Create apps/mobile/src/lib/__tests__/invite-mirror.test.ts modeled on lock-mirror.test.ts. Import the shared source by relative path `import * as sharedInvite from "../../../../../packages/shared/src/logic/invite"` (NOT the @bethere/shared barrel - the relative path keeps the type-only rule intact, exactly as lock-mirror.test.ts does) and `import * as mobileInvite from "../invite"`.
2. 2. In that test, assert constant agreement: `expect(mobileInvite.CODE_LENGTH).toBe(8)` and `expect(mobileInvite.CODE_LENGTH).toBe(sharedInvite.INVITE_CODE_LENGTH)` (the spec value, plus equality with the canonical copy - mirroring how lock-mirror.test.ts pins MOMENT_MS to both the spec and the shared constant).
3. 3. Assert formatCode agreement across a sweep: for inputs `["", "AB", "ABCD", "ABCDEF12", "abcdef12", "ABCD-EF12", " abcd ef12 ", "23456789"]`, `expect(mobileInvite.formatCode(x)).toBe(sharedInvite.formatInviteCode(x))`. Both uppercase and group as ABCD-EF12 for length > 4, return as-is for <= 4 - the sweep must cover the <=4 (bare/short), >4 (grouped), already-grouped, and spaced/lowercased cases.
4. 4. Assert normalizeCode agreement on the SHARED contract domain only: for inputs WITHOUT a '/join/' URL and at or under CODE_LENGTH characters of payload (e.g. `["", "abcdef12", "ABCD-EF12", " abcd ef12 ", "ab cd"]`), `expect(mobileInvite.normalizeCode(x)).toBe(sharedInvite.normalizeInviteCode(x))`. This is restricted because the mobile copy is a documented superset (see invite.ts lines 22-25): it ALSO extracts from a '/join/CODE' URL and caps at .slice(0, CODE_LENGTH), which shared deliberately does not - so a blind whole-input equality would (correctly) fail on those.
5. 5. Assert the documented mobile-only superset behavior explicitly so the divergence is a tested contract, not an accident: (a) URL extraction - `expect(mobileInvite.normalizeCode("https://bethere.app/join/ABCD-EF12")).toBe("ABCDEF12")` and confirm shared does NOT extract (`expect(sharedInvite.normalizeInviteCode("https://bethere.app/join/ABCDEF12")).not.toBe("ABCDEF12")` because it keeps the host chars); (b) length cap - feed an over-length payload like `"ABCDEF1234567"` and assert `mobileInvite.normalizeCode(...).length === mobileInvite.CODE_LENGTH` while shared returns the full uppercased run uncapped. This mirrors how lock-mirror.test.ts asserts the documented contract (e.g. DAY_MS staying private on mobile) rather than blindly equating the two modules.
6. 6. Optionally add a small export-parity guard like lock-mirror.test.ts's final block: assert the mobile mirror exposes its contracted public API (CODE_LENGTH, formatCode, normalizeCode) - documenting that the name divergence from shared (INVITE_CODE_LENGTH/formatInviteCode/normalizeInviteCode) is intentional, not drift.
7. 7. Run `pnpm --filter @bethere/mobile test` (jest-expo) to confirm the new test passes alongside lock-mirror.test.ts and format.test.ts; run `pnpm typecheck` and `pnpm lint`.
8. 8. (Optional, lower value, separate commit) Re-align apps/mobile/src/lib/lock.ts to the shared file's layout: reorder the exported functions to defaultDecidesByForCandidates -> defaultReplyByMs -> addCandidateHorizon (mobile currently has addCandidateHorizon before defaultReplyByMs), and copy the shared JSDoc blocks verbatim onto each of the three functions. Keep the mobile-only import-trap header comment (lines 1-7) and keep DAY_MS as a private const (shared exports it; the mirror deliberately does not, as lock-mirror.test.ts already documents). Pure ordering + comment move, zero code change; lock-mirror.test.ts must stay green.
9. 9. (Explicitly OUT of scope for this epic - maintainer's call) Renaming the mobile-local invite exports to match shared (normalizeCode->normalizeInviteCode, formatCode->formatInviteCode, CODE_LENGTH->INVITE_CODE_LENGTH) for grep-ability would touch the JoinGroup.tsx, GroupsList.tsx, and GroupDetail.tsx call sites (intra-package, behavior-preserving) but is churny and changes export names the team may treat as stable. Do NOT bundle it here.
10. 10. (Exclusion) Do NOT collapse the cross-package duplication into a shared runtime import - a value import of the @bethere/shared barrel from mobile reintroduces the documented Metro/jest resolution trap. The duplication is intentional; this epic only guards and aligns it.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (apps/mobile/src/lib/__tests__/):
  format.test.ts
  lock-mirror.test.ts   <- pins lock.ts against packages/shared/src/logic/lock.ts
  (no invite guard - invite.ts can silently drift from shared/logic/invite.ts)

  // mobile lock.ts order:        defaultDecidesByForCandidates, addCandidateHorizon, defaultReplyByMs   (no JSDoc)
  // shared logic/lock.ts order:  defaultDecidesByForCandidates, defaultReplyByMs, addCandidateHorizon   (full JSDoc)

AFTER:
  format.test.ts
  lock-mirror.test.ts
  invite-mirror.test.ts <- NEW, modeled on lock-mirror.test.ts
    import * as sharedInvite from "../../../../../packages/shared/src/logic/invite"; // relative, NOT the barrel
    import * as mobileInvite from "../invite";
    // CODE_LENGTH === INVITE_CODE_LENGTH === 8
    // formatCode agrees with formatInviteCode across bare/short/grouped/spaced-lowercased
    // normalizeCode agrees with normalizeInviteCode for non-URL, <=len inputs
    // PLUS documented mobile-only superset: '/join/CODE' extraction + .slice(0, CODE_LENGTH) cap

  // mobile lock.ts re-aligned to shared order with shared's JSDoc copied verbatim;
  // import-trap header kept, DAY_MS stays private -> diff vs shared shows only the unavoidable deltas
```

</details>

**Files.** `apps/mobile/src/lib/__tests__/invite-mirror.test.ts (new)`, `apps/mobile/src/lib/lock.ts (optional re-sync; comments/order only)`

---

### 4. Refresh stale schema.ts comments and document the frozen legacy columns (status, isAnonymous)

`schema-comments-frozen-legacy-columns` - **effort** S | **risk** low | **impact** med | **apply #12** (`api/db`)

**Problem.** schema.ts comments still describe the retired three-mode whenMode vocabulary (eventCandidates "exact/options/fuzzy plans", partOfDay "fuzzy candidate") and frame startsAt/respondByAt as M2 placeholders even though they are live, required columns. Separately, events.status (+ eventStatusEnum) and events.isAnonymous are written on every insert but never read - status is a frozen duplicate of phase and isAnonymous is an always-true invariant. This is a comment-only pass: rewrite the stale comments to the unified-suggest model, add a one-line "frozen legacy" note to status and isAnonymous (columns untouched), and drop the leftover "float" word from api/format.ts. Retiring the two frozen columns is a DB migration and is explicitly out of scope - filed as a follow-up.

**Why it matters.** Comments are the first thing a reader trusts; these actively mislead by describing a model (three-mode whenMode: exact/options/fuzzy) that was retired in M3, which slows every future change to the events/candidates schema. Explicitly tagging status and isAnonymous as frozen-and-never-read prevents a future contributor from "wiring them up" by mistake and seeds the cleanup migration. Zero runtime, type, or DB-shape risk since it is comments only.

**Change steps.**
1. 1. apps/api/src/db/schema.ts:91-92 (eventCandidates header) - rewrite the 'Exact plans / options plans / fuzzy plans' comment in unified vocabulary: 'A candidate on a plan's TIME or ACTIVITY list that members react to during `collecting`. TIME candidates set startsAt (with an optional partOfDay hint); ACTIVITY candidates set `label`.' Leave the inline comment on line 98 as-is (it already matches).
2. 2. apps/api/src/db/schema.ts:19 (partOfDayEnum) - replace 'Rough time-of-day band a fuzzy candidate sits in.' with 'Rough time-of-day band hint for a TIME candidate.'
3. 3. apps/api/src/db/schema.ts:53-56 (events table header) - tighten to current lifecycle terms and remove the 'retained from M2 ... placeholder' framing from the header. e.g. 'A plan. It collects per-candidate reactions across the TIME and ACTIVITY lists; the creator (or the decidesBy deadline) locks the winning candidates to open the blind moment, and it clears or silently fizzles.'
4. 4. apps/api/src/db/schema.ts:68-69 (startsAt / respondByAt columns) - move the placeholder explanation to inline comments mirroring the decidesBy/replyBy style on lines 79-84: state plainly these are required columns seeded from the leading/trailing candidate and superseded by the moment window (momentStartsAt/momentEndsAt) once `lock` sets chosenCandidateId.
5. 5. apps/api/src/db/schema.ts:13-14 (eventStatusEnum) and :70 (status column) - DO NOT drop or change the enum/column. Replace/keep a one-line comment marking it frozen: 'Frozen legacy column: written on every plan but never read - phase is the live lifecycle source of truth. Slated for removal in a dedicated migration.' Add a matching short note inline on the status column at line 70.
6. 6. apps/api/src/db/schema.ts:73-75 (isAnonymous) - keep the column; reword the existing comment to make the frozen invariant explicit: 'Frozen legacy flag: always true. Anonymity is a global invariant (createdByUserId is stored for accountability but never surfaced; isCreator is always false), not a per-plan toggle. Slated for removal in a dedicated migration.'
7. 7. apps/api/src/format.ts:2 - drop the retired 'float' word from the msLeft comment: change 'the countdown fields the event/float reads project' to 'the countdown fields the plan reads project.'
8. 8. Run pnpm lint, pnpm typecheck, pnpm test to confirm the comment-only edits are clean (no behavior, type, or test impact).

<details><summary>Before / after sketch</summary>

```ts
schema.ts:91-92 (eventCandidates)
- // A candidate time people react to during `collecting`. Exact plans have exactly one; options
- // plans have the creator's menu; fuzzy plans have day candidates expanded from the window.
+ // A candidate on a plan's TIME or ACTIVITY list that members react to during `collecting`.
+ // TIME candidates set startsAt (with an optional partOfDay hint); ACTIVITY candidates set `label`.

schema.ts:19 (partOfDayEnum)
- // Rough time-of-day band a fuzzy candidate sits in.
+ // Rough time-of-day band hint for a TIME candidate.

schema.ts:53-56 (events header) + 68-69 (columns)
- // A plan. It collects per-candidate reactions across the TIME and ACTIVITY lists, the creator
- // locks the winning candidates to open the blind moment, and it clears or silently fizzles.
- // `startsAt`/`respondByAt` are retained from M2; they hold the first/last candidate as a
- // placeholder until `lock` sets `chosenCandidateId` + the moment window.
+ // A plan. It collects per-candidate reactions across the TIME and ACTIVITY lists; the creator
+ // (or the decidesBy deadline) locks the winning candidates to open the blind moment, then it
+ // clears or silently fizzles.
  ...
- startsAt: timestamp("starts_at").notNull(),
- respondByAt: timestamp("respond_by_at").notNull(),
+ // Required. Seeded from the leading/trailing candidate; superseded by the moment window
+ // (momentStartsAt/momentEndsAt) once `lock` sets chosenCandidateId.
+ startsAt: timestamp("starts_at").notNull(),
+ respondByAt: timestamp("respond_by_at").notNull(),

schema.ts:13-14 (status) + 73-75 (isAnonymous) - comment only, columns untouched
- // Legacy M2 lifecycle, kept so the change stays additive (the new flow uses `phase`).
+ // Frozen legacy: written on every plan but never read; `phase` is the live lifecycle source of
+ // truth. Slated for removal in a dedicated migration.
  export const eventStatusEnum = pgEnum("event_status", ["open", "resolved"]);
  ...
- // Plans are always anonymous: createdByUserId is stored for accountability but never surfaced,
- // so isCreator is forced false whenever this is set.
+ // Frozen legacy flag: always true. Anonymity is a global invariant (createdByUserId is stored
+ // for accountability but never surfaced; isCreator is always false), not a per-plan toggle.
+ // Slated for removal in a dedicated migration.

format.ts:2
- // absent one as null). Single source for the countdown fields the event/float reads project.
+ // absent one as null). Single source for the countdown fields the plan reads project.
```

</details>

**Files.** `apps/api/src/db/schema.ts`, `apps/api/src/format.ts`

---

### 5. Route DateTimeField's time label through lib/format and tokenize the web shadow

`datetimefield-format-and-shadow-token` - **effort** S | **risk** low | **impact** low | **apply #17** (`mobile/ui`)

**Problem.** DateTimeField inlines `toLocaleTimeString` for its 12-hour time label - the only such call in the app - while its date branch already delegates to `lib/format.shortDayLabel`. lib/format is the designated home for date/time formatting, so add a `shortTimeLabel(d: Date)` sibling and route the time branch through it. Separately, DateTimeField.web.tsx hardcodes `boxShadow: '3px 3px 0 0'` instead of the `ui.shadowInput` token (=3) that its native siblings use via `HardShadow offset={ui.shadowInput}`. Both edits are pure refactors with byte-identical rendered output. The clock12 collapse is explicitly out of scope: clock12 takes an ISO string and returns a split { time, ampm } object, while displayValue holds a Date and needs one joined string - incompatible shapes, not a drop-in. Other inline numbers in the web style block (fontSize 13, padding "10px 11px"/"12px") have no matching token and mirror the native sibling - leave them.

**Why it matters.** lib/format is the single designated home for date/time formatting; routing the time label through a `shortTimeLabel` sibling removes the app's only stray inline toLocaleTimeString and makes the recipe unit-testable next to shortDayLabel and clock12. Tokenizing the web shadow with ui.shadowInput aligns the web fallback with its native siblings (which use HardShadow offset={ui.shadowInput}) and the design-token convention, so a future shadow tweak is single-sourced. Both are zero-behavior-change consistency wins.

**Change steps.**
1. 1. In apps/mobile/src/lib/format.ts, add a `shortTimeLabel` helper directly after `shortDayLabel` (after line 64): `export function shortTimeLabel(d: Date): string { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }` with a one-line comment mirroring shortDayLabel's (e.g. // Date -> "4:00 PM" short time label (used by DateTimeField).).
2. 2. In apps/mobile/src/ui/DateTimeField.tsx, add `shortTimeLabel` to the existing `../lib/format` named import (the block on lines 7-13, alongside shortDayLabel and timeStringFrom).
3. 3. In apps/mobile/src/ui/DateTimeField.tsx, replace line 73's `return t ? t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : value;` with `return t ? shortTimeLabel(t) : value;`.
4. 4. In apps/mobile/src/ui/DateTimeField.web.tsx line 49, replace `boxShadow: bare ? "none" : `3px 3px 0 0 ${ui.ink}`,` with `boxShadow: bare ? "none" : `${ui.shadowInput}px ${ui.shadowInput}px 0 0 ${ui.ink}`,`. Leave fontSize 13, padding "10px 11px"/"12px", and every other inline number untouched (no matching token).
5. 5. (Optional) In apps/mobile/src/lib/__tests__/format.test.ts, add a `describe("shortTimeLabel", ...)` block asserting it returns a non-empty hour:minute string for a known Date (locale-tolerant assertion, e.g. matches /\d/ and contains a colon) so the recipe is covered alongside its date sibling.
6. 6. Run pnpm lint, pnpm typecheck, and pnpm --filter @bethere/mobile test to confirm no behavior or type regressions.

<details><summary>Before / after sketch</summary>

```ts
// format.ts - new sibling next to shortDayLabel (line 62-64)
  export function shortDayLabel(d: Date): string { ... }            // existing
+ // Date -> "4:00 PM" short time label (used by DateTimeField).
+ export function shortTimeLabel(d: Date): string {
+   return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
+ }

// DateTimeField.tsx - import + displayValue time branch (line 7-13, 73)
- import { dateStringFrom, parseLocalDate, parseLocalTime, shortDayLabel, timeStringFrom } from "../lib/format";
+ import { dateStringFrom, parseLocalDate, parseLocalTime, shortDayLabel, shortTimeLabel, timeStringFrom } from "../lib/format";
  ...
- return t ? t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : value;
+ return t ? shortTimeLabel(t) : value;

// DateTimeField.web.tsx - tokenize input shadow (line 49)
- boxShadow: bare ? "none" : `3px 3px 0 0 ${ui.ink}`,
+ boxShadow: bare ? "none" : `${ui.shadowInput}px ${ui.shadowInput}px 0 0 ${ui.ink}`,
```

</details>

**Files.** `apps/mobile/src/lib/format.ts`, `apps/mobile/src/ui/DateTimeField.tsx`, `apps/mobile/src/ui/DateTimeField.web.tsx`, `apps/mobile/src/lib/__tests__/format.test.ts`

---

### 6. Have PersonRow own the trailing 'right' slot alignment instead of caller marginLeft:auto

`personrow-right-slot-alignment` - **effort** S | **risk** low | **impact** low | **apply #26** (`mobile/ui`)

**Problem.** All three PersonRow call sites repeat the same `marginLeft: "auto"` idiom to push their `right` slot to the trailing edge: GroupDetail.tsx:213 (wraps a TextButton), EventDetail.tsx:358 (wraps a SelectCheck), and EventDetail.tsx:874 (inline on a Text). PersonRow renders `{right}` bare (PersonRow.tsx:44) and never pushes it. Move the trailing-slot alignment into the primitive - exactly as ScreenHeader.tsx:60 already does for its own `right` slot - by wrapping `{right}` in a `<View style={{ marginLeft: "auto" }}>` when defined, gated by an optional `rightAlign` prop defaulting to true so the existing flush-left escape hatch is preserved. Then strip the now-redundant wrappers from the three callers. For the three current consumers the rendered layout is identical, so this is behavior-preserving. Verified: exactly three callers exist; the `View` import remains needed in both screen files (4 and 13 other uses), so no orphaned imports.

**Why it matters.** Three call sites repeat the identical trailing-slot push idiom, scattering layout responsibility that belongs in the shared primitive. ScreenHeader already owns this exact alignment for its own `right` slot, so centralizing it in PersonRow makes the two ui/ primitives consistent and lets every current and future PersonRow caller pass a bare trailing node. The change is small, contained to mobile UI, and renders identically for all existing consumers.

**Change steps.**
1. PersonRow.tsx: add an optional `rightAlign?: boolean` prop (default true) to the props type.
2. PersonRow.tsx: in `inner`, replace bare `{right}` (line 44) with `{right != null ? (rightAlign ? <View style={{ marginLeft: "auto" }}>{right}</View> : right) : null}` - View is already imported (line 2).
3. GroupDetail.tsx: at the members-list PersonRow (line 206), change `right={<View style={{ marginLeft: "auto" }}><TextButton .../></View>}` to pass the bare `<TextButton .../>` (remove lines 213 + 222 wrapper).
4. EventDetail.tsx: at the conditional-picker PersonRow (line 347), change `right={<View style={{ marginLeft: "auto" }}><SelectCheck selected={on} /></View>}` to `right={<SelectCheck selected={on} />}` (remove the View wrapper at lines 358-360).
5. EventDetail.tsx: at the RevealView PersonRow (line 869), change `right={<Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>}` to `right={<Text style={{ color: ui.going }}>{"✓"}</Text>}` - drop ONLY marginLeft:"auto", KEEP color: ui.going.
6. Confirm the `View` import stays in both screen files (still used elsewhere) and run `pnpm typecheck`.

<details><summary>Before / after sketch</summary>

```ts
PersonRow.tsx (primitive)
  // before
  {right}
  // after  (rightAlign?: boolean = true; View already imported)
  {right != null
    ? rightAlign
      ? <View style={{ marginLeft: "auto" }}>{right}</View>
      : right
    : null}

GroupDetail.tsx:213 / EventDetail.tsx:358
  // before
  right={<View style={{ marginLeft: "auto" }}><TextButton .../></View>}
  right={<View style={{ marginLeft: "auto" }}><SelectCheck selected={on} /></View>}
  // after
  right={<TextButton .../>}
  right={<SelectCheck selected={on} />}

EventDetail.tsx:874  (drop marginLeft only, keep color)
  // before
  right={<Text style={{ marginLeft: "auto", color: ui.going }}>{"✓"}</Text>}
  // after
  right={<Text style={{ color: ui.going }}>{"✓"}</Text>}
```

</details>

**Files.** `apps/mobile/src/ui/PersonRow.tsx`, `apps/mobile/src/screens/GroupDetail.tsx`, `apps/mobile/src/screens/EventDetail.tsx`

---

### 7. Extract the settle+phase-gate preamble shared by 5 gated mutations in events.ts

`events-settle-require-phase-helper` - **effort** M | **risk** low | **impact** med | **apply #5** (`api/events`)

**Problem.** Five mutations in apps/api/src/routers/events.ts (toggleReaction, setOptOut, addCandidate, lock, respond, unrespond) open with the identical "await settleLifecycle(e); if (e.phase !== X) throw BAD_REQUEST" block, each re-stating the same multi-line "settle first because loadEvent never settles" rationale in prose. Factor that load-bearing invariant into one helper, settleAndRequirePhase(e, phase, message), so the rule lives in code (documented once) and each call site shrinks to a single line that passes its own message. Pure refactor, apps/api only - no shared/mobile, API-shape, or DB changes; phase gating, error codes, and per-procedure messages are all preserved.

**Why it matters.** The "settle before gating because loadEvent never settles" invariant is currently encoded only as prose duplicated across five mutations - a comment can drift from the code it describes, and a new mutation can easily forget the settle step and gate on a stale phase (a real correctness bug: accepting a late +1/RSVP/lock). Moving it into settleAndRequirePhase makes the contract a single callable unit that is hard to get wrong, deletes ~5 near-identical comment blocks plus their if-throw boilerplate, and keeps every observable behavior (phase gate, BAD_REQUEST code, exact per-procedure messages) identical by passing the message in.

**Change steps.**
1. Add a module-level helper near loadEvent/settleLifecycle (after line 270 in apps/api/src/routers/events.ts): `async function settleAndRequirePhase(e: EventRow, phase: EventRow["phase"], message: string): Promise<void> { await settleLifecycle(e); if (e.phase !== phase) throw new TRPCError({ code: "BAD_REQUEST", message }); }`. Give it ONE comment documenting the settle-first rule (loadEvent never settles; a collecting/moment plan past its deadline has already auto-locked/cleared/fizzled, so a late write must gate against the SETTLED phase) - this replaces the five duplicated comment blocks.
2. toggleReaction (events.ts 585-591): keep `const e = await loadEvent(...)`; replace lines 586-591 (comment + settleLifecycle + if-throw) with `await settleAndRequirePhase(e, "collecting", "plan is not collecting reactions");`.
3. setOptOut (events.ts 639-645): keep the loadEvent line; replace lines 640-645 with `await settleAndRequirePhase(e, "collecting", "plan is not collecting");`.
4. addCandidate (events.ts 671-677): keep the loadEvent line; replace lines 672-677 with `await settleAndRequirePhase(e, "collecting", "plan is not collecting");`. Leave the subsequent lockTimes/lockActivity FORBIDDEN gates (678-683) untouched - they run after the phase gate as before.
5. lock (events.ts 772-782): keep loadEvent (773) AND the pre-settle creator-only check (774-776) exactly where they are - do NOT reorder the creator check after settle, since that would change an observable DB side effect (settleLifecycle writes) for unauthorized callers. Replace only lines 777-782 with `await settleAndRequirePhase(e, "collecting", "plan is not collecting");`.
6. respond (events.ts 1069-1076): keep the loadEvent line; replace lines 1070-1076 with `await settleAndRequirePhase(e, "moment", "the moment is not open");`.
7. unrespond (events.ts 1097-1103): keep the loadEvent line; replace lines 1098-1103 with `await settleAndRequirePhase(e, "moment", "the moment is not open");`.
8. Leave resolve (events.ts 1113-1114) as a bare `await settleLifecycle(e)` with no gate - it intentionally has no phase requirement. Do NOT introduce a loadSettledEvent wrapper for lock or anywhere else.
9. Verify: run `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @bethere/api test` (needs `pnpm db:up`). The events router tests cover late +1/candidate/RSVP rejection and lock authorization, so the gate behavior and error messages are exercised.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (repeated in 5 mutations, e.g. toggleReaction 585-591):
  const e = await loadEvent(input.eventId, ctx.userId);
  // Settle first (loadEvent never settles): a collecting plan past its decides-by deadline has
  // already auto-locked/fizzled, so a late +1 must be rejected against the SETTLED phase.
  await settleLifecycle(e);
  if (e.phase !== "collecting") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "plan is not collecting reactions" });
  }

AFTER (one helper, documented once, near loadEvent ~270):
  // Settle first (loadEvent never settles): a plan past its deadline has already
  // auto-locked/cleared/fizzled, so a late write must gate on the SETTLED phase.
  async function settleAndRequirePhase(
    e: EventRow, phase: EventRow["phase"], message: string,
  ): Promise<void> {
    await settleLifecycle(e);
    if (e.phase !== phase) throw new TRPCError({ code: "BAD_REQUEST", message });
  }
  // ...then each call site:
  const e = await loadEvent(input.eventId, ctx.userId);
  await settleAndRequirePhase(e, "collecting", "plan is not collecting reactions");

lock keeps its creator check BEFORE the settle call (do not reorder):
  const e = await loadEvent(input.eventId, ctx.userId);
  if (e.createdByUserId !== ctx.userId) throw new TRPCError({ code: "FORBIDDEN", ... });
  await settleAndRequirePhase(e, "collecting", "plan is not collecting");

resolve stays a bare settle, no gate:
  await settleLifecycle(e);
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 8. Use batched getUserCards in groups.get (drop the N+1 per-member roster query)

`groups-get-batched-getusercards` - **effort** S | **risk** low | **impact** low | **apply #11** (`api/groups`)

**Problem.** groups.get resolves its member roster with Promise.all(ids.map(getUserCard)) - one SELECT per member (N+1). The codebase already ships a batched getUserCards(ids) helper (db/users.ts) that resolves every card in ONE inArray query and returns a Map, exactly as events.ts's loadEventBundle uses it. Swap the N+1 loop for getUserCards and map ids back to cards in order, filling any missing row with the same FALLBACK_USER_NAME / FALLBACK_AVATAR_COLOR sentinels getUserCard uses. Output shape and order are identical; N queries collapse to 1. Behavior-preserving, no API or DB change.

Scope note (verified): two related ideas from the original cluster were investigated and DROPPED as out of scope because they are not cleanly behavior-preserving. (1) Extracting a shared groupIdsForUser helper across events.mine and groups.mine: groups.mine selects the FULL membership row (`.select()`) and reuses it later (line 59) to build its result, whereas events.mine projects a single groupId column - so a string[] helper fits only one call site and the shared-helper premise is wrong. (2) Sharing memberIdsOf into events.get and groups.removeMember: removeMember reads members INSIDE a transaction by design (the count-inside-tx invariant guarding against emptying a group - see the comment at groups.ts:171), so a plain db-based helper would change concurrency behavior; and events.get reuses its member rows as objects twice (bundle uids + the members list), so a bare string[] helper is a poor fit. Both are flagged as separate ideas, not part of this epic.

**Why it matters.** groups.get fires one SELECT per member to build a roster the codebase already has a batched helper for (getUserCards), the same one events.ts's loadEventBundle uses. Adopting it removes a textbook N+1, keeps the per-row fallback sentinels identical, and the output shape/order is unchanged - a clean, low-risk efficiency cleanup with no behavior, API, or DB change.

**Change steps.**
1. In /Users/gong/Programming/drp_02/apps/api/src/routers/groups.ts line 24, change the import from `import { getUserCard, userCardFromRow } from "../db/users.js";` to `import { FALLBACK_AVATAR_COLOR, FALLBACK_USER_NAME, getUserCards, userCardFromRow } from "../db/users.js";` (drop getUserCard, add getUserCards + the two fallback sentinels; keep userCardFromRow - it is still used by addableUsers at line 81).
2. In groups.get (line 72), replace `const members = await Promise.all(ids.map(getUserCard));` with two lines: `const cardMap = await getUserCards(ids);` then `const members = ids.map((id) => cardMap.get(id) ?? { id, name: FALLBACK_USER_NAME, color: FALLBACK_AVATAR_COLOR });`. Leave line 71 (`const ids = await memberIdsOf(input.id);`) and the return on line 73 unchanged - mapping over `ids` preserves member order.
3. Run `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @bethere/api test` (the groups roster test at groups.test.ts:313 covers the shape; it needs `pnpm db:up`). Confirm the get-roster test still passes - it asserts each member carries id/name/color and that the id set matches, which the new mapping satisfies.
4. DO NOT touch events.mine / groups.mine (no shared groupIdsForUser helper) or events.get / groups.removeMember (no shared memberIdsOf helper) - both were verified as not cleanly behavior-preserving and are out of scope for this epic.

<details><summary>Before / after sketch</summary>

```ts
// apps/api/src/routers/groups.ts line 24 (import)
- import { getUserCard, userCardFromRow } from "../db/users.js";
+ import {
+   FALLBACK_AVATAR_COLOR,
+   FALLBACK_USER_NAME,
+   getUserCards,
+   userCardFromRow,
+ } from "../db/users.js";

// groups.get (lines 71-72)
  const ids = await memberIdsOf(input.id);
- const members = await Promise.all(ids.map(getUserCard)); // N SELECTs
+ const cardMap = await getUserCards(ids);                 // 1 SELECT (inArray)
+ const members = ids.map(
+   (id) => cardMap.get(id) ?? { id, name: FALLBACK_USER_NAME, color: FALLBACK_AVATAR_COLOR },
+ );
  return { id: group.id, name: group.name, members };
```

</details>

**Files.** `apps/api/src/routers/groups.ts`

---

### 9. Name the UserCard shape and centralize the row-to-card projection in db/users.ts

`usercard-name-and-centralize-projection` - **effort** S | **risk** low | **impact** low | **apply #7** (`api/events`)

**Problem.** The avatar-card shape `{ id: string; name: string; color: string }` is re-inlined five times in apps/api/src/db/users.ts (getUserCard return, getUserCards return + Map type + new Map() generic, userCardFromRow return) and once more as the `userCard` callback type in apps/api/src/routers/events.ts:330. Separately, the row-to-card projection (id, name, avatarColor -> color) is open-coded in three places in users.ts instead of getUserCards delegating to userCardFromRow. Two behavior-preserving, api-package-local edits fix both: declare one named `UserCard` type alias and route the no-fallback projection through userCardFromRow. The third finding (a cardOf fallback helper) is intentionally out of scope: pre-applying fallbacks in getUserCards would break bundle.hasUser (events.ts:402) and flip the going-preview missing-user avatar from "?" to "S" (events.ts:877-878), a visible UX change.

**Why it matters.** The card shape and its row projection are duplicated 6 places (5 in users.ts + 1 in events.ts) with no single name, so a future field add/rename to the avatar card means hunting down and editing every copy and risks them drifting out of sync. Naming the type once and routing both no-fallback projections through userCardFromRow makes that change touch one place each. Both edits are structurally identical and stay inside apps/api, so they carry the documented Metro/jest @bethere/shared trap is irrelevant here and risk is minimal.

**Change steps.**
1. Add `export type UserCard = { id: string; name: string; color: string };` near the top of apps/api/src/db/users.ts (e.g. just above getUserCard, after the FALLBACK constants).
2. Replace getUserCard's inline return type `Promise<{ id: string; name: string; color: string }>` with `Promise<UserCard>`.
3. Replace getUserCards' return type `Promise<Map<string, { id: string; name: string; color: string }>>` with `Promise<Map<string, UserCard>>` and the `new Map<string, { id: string; name: string; color: string }>()` initializer with `new Map<string, UserCard>()`.
4. Replace userCardFromRow's inline return type `{ id: string; name: string; color: string }` with `UserCard`.
5. In getUserCards' row loop, replace `for (const u of rows) out.set(u.id, { id: u.id, name: u.name, color: u.avatarColor });` with `for (const u of rows) out.set(u.id, userCardFromRow(u));` so the no-fallback projection lives only in userCardFromRow.
6. Import `UserCard` in apps/api/src/routers/events.ts and change loadEventBundle's `userCard: (id: string) => { id: string; name: string; color: string }` member to `userCard: (id: string) => UserCard`.
7. Run `pnpm typecheck` and `pnpm test` to confirm no behavior change (the structural type is identical; the loop output is byte-for-byte the same).

<details><summary>Before / after sketch</summary>

```ts
Before (apps/api/src/db/users.ts):
  export async function getUserCard(id: string): Promise<{ id: string; name: string; color: string }> { ... }
  export async function getUserCards(ids: string[]): Promise<Map<string, { id: string; name: string; color: string }>> {
    const out = new Map<string, { id: string; name: string; color: string }>();
    ...
    for (const u of rows) out.set(u.id, { id: u.id, name: u.name, color: u.avatarColor });
    return out;
  }
  export function userCardFromRow(u: {...}): { id: string; name: string; color: string } {
    return { id: u.id, name: u.name, color: u.avatarColor };
  }
Before (apps/api/src/routers/events.ts:330):
  userCard: (id: string) => { id: string; name: string; color: string };

After (apps/api/src/db/users.ts):
  export type UserCard = { id: string; name: string; color: string };
  export async function getUserCard(id: string): Promise<UserCard> { ... }   // 2-line sentinel fallback kept as-is
  export async function getUserCards(ids: string[]): Promise<Map<string, UserCard>> {
    const out = new Map<string, UserCard>();
    ...
    for (const u of rows) out.set(u.id, userCardFromRow(u));
    return out;
  }
  export function userCardFromRow(u: {...}): UserCard {
    return { id: u.id, name: u.name, color: u.avatarColor };
  }
After (apps/api/src/routers/events.ts:330, with `import type { UserCard } from "../db/users.js";`):
  userCard: (id: string) => UserCard;

Untouched on purpose: getUserCard's `u?.name ?? FALLBACK_USER_NAME` / `u?.avatarColor ?? FALLBACK_AVATAR_COLOR` fallback, loadEventBundle's `userCardMap.get(id) ?? { id, name: FALLBACK_USER_NAME, color: FALLBACK_AVATAR_COLOR }` at events.ts:401, and bundle.hasUser at events.ts:402 (which the going-preview "?" fallback at events.ts:877-878 depends on).
```

</details>

**Files.** `apps/api/src/db/users.ts`, `apps/api/src/routers/events.ts`

---

### 10. Fix shared/schemas.ts naming and doc drift (ResolveInput/ByGroupInput comments, NOTES_MAX)

`schemas-naming-doc-drift` - **effort** S | **risk** low | **impact** low | **apply #9** (`shared`)

**Problem.** Three behavior-preserving naming/comment fixes in packages/shared/src/schemas.ts (plus one import line in apps/api/src/routers/events.ts) that remove misleading identifiers and stale docs without touching any wire shape or DB schema. (1) ResolveInput is just an alias of ByEvent but is named per the `resolve` procedure, yet `unrespond` reuses it - delete the alias and point both procedures at ByEvent directly (matches the ByIdInput bare-envelope convention the ByEvent comment already documents). (2) The ByGroupInput comment names only one of its three consumers - make it list all three (or non-exhaustive). (3) The module-private constant NOTES_MAX caps a field named `description`, breaking the convention its siblings ACTIVITY_MAX/LOCATION_MAX follow - rename it to DESCRIPTION_MAX. The user-facing "notes are too long" error string and the `description` wire/DB field are intentionally left unchanged. Item 4 from the source cluster (replyBy vs momentEndsAt) is intentionally dropped: those are distinct DB columns and distinct output fields (creator-requested vs resolved/clamped), not one deadline named twice, and schema.ts:83 already documents the relationship - nothing actionable without an out-of-scope wire/DB change.

**Why it matters.** Pure readability/consistency win with a tiny, fully-verified surface (4 edit sites in schemas.ts + 3 in events.ts, all confirmed by grep) and zero behavior change. ResolveInput === ByEvent is an exact Zod-shape and inferred-type identity so swapping it is a no-op at runtime and at the type level; the constant rename is module-private so it has no external blast radius; the comment fix is doc-only. The compiler (pnpm typecheck) fully proves the rename/alias removal because events.ts is the sole consumer of both ResolveInput and the type. Risk is low and reach is repo-internal-only, which is why this is the single, easy-to-land item in the cluster.

**Change steps.**
1. Step 1 (ResolveInput alias removal): In packages/shared/src/schemas.ts delete the two lines at 153-154 (`export const ResolveInput = ByEvent;` and `export type ResolveInput = z.infer<typeof ResolveInput>;`). Keep the explanatory comment at 151-152 but reword it for ByEvent reuse, e.g. `// events.resolve and events.unrespond are bare { eventId } envelopes, so both reuse the shared ByEvent base directly.`
2. Step 2 (repoint procedures): In apps/api/src/routers/events.ts change the import at line 18 from `ResolveInput,` to `ByEvent,` (placed to keep the alphabetised import block ordered - ByEvent goes near the top of the named imports). Then change `.input(ResolveInput)` to `.input(ByEvent)` at line 1096 (unrespond) and line 1112 (resolve). ByEvent is not currently imported in events.ts, so this is a rename within the import list, not an addition.
3. Step 3 (ByGroupInput comment): In packages/shared/src/schemas.ts replace the comment at line 171 with a non-exhaustive / full-list version, e.g. `// Shared { groupId } envelope for the group-scoped queries (groups.addableUsers, groups.inviteByGroup, events.pastForGroup).`
4. Step 4 (NOTES_MAX rename): In packages/shared/src/schemas.ts rename the private constant `NOTES_MAX` -> `DESCRIPTION_MAX` at the declaration (line 49) and both use sites (line 69 in CreateEventInput.description, line 136 in UpdateEventInput.description). Leave the error message string at line 137 (`message: "notes are too long"`) as-is - it is user-facing copy - and do NOT rename the `description` field.
5. Step 5 (verify): run `pnpm lint`, `pnpm typecheck`, and `pnpm test` from the repo root. Typecheck is the key gate: if any other module still imported the deleted ResolveInput type it would fail to compile (grep already confirms events.ts is the only consumer, so this should pass clean).

<details><summary>Before / after sketch</summary>

```ts
// --- packages/shared/src/schemas.ts ---
// BEFORE
const NOTES_MAX = 500;
// ...
  description: z.string().max(NOTES_MAX).optional(),
// ...
  description: FieldEdit.refine((f) => f.to.length <= NOTES_MAX, {
    message: "notes are too long",
  }).optional(),
// ...
// Network boundary for events.resolve - resolve the moment at (or after) its deadline. Just an
// `{ eventId }` envelope, so it aliases the shared ByEvent base.
export const ResolveInput = ByEvent;
export type ResolveInput = z.infer<typeof ResolveInput>;
// ...
// Shared `{ groupId }` envelope (groups.addableUsers).
export const ByGroupInput = z.object({ groupId: z.string() });

// AFTER
const DESCRIPTION_MAX = 500;
// ...
  description: z.string().max(DESCRIPTION_MAX).optional(),
// ...
  description: FieldEdit.refine((f) => f.to.length <= DESCRIPTION_MAX, {
    message: "notes are too long", // user-facing copy, unchanged
  }).optional(),
// ...
// events.resolve and events.unrespond are bare { eventId } envelopes, so both reuse ByEvent directly.
// (ResolveInput alias deleted)
// ...
// Shared `{ groupId }` envelope for the group-scoped queries (groups.addableUsers, groups.inviteByGroup, events.pastForGroup).
export const ByGroupInput = z.object({ groupId: z.string() });

// --- apps/api/src/routers/events.ts ---
// BEFORE: import { ..., ResolveInput, ... }  ->  AFTER: import { ByEvent, ... }
  unrespond: protectedProcedure.input(ByEvent).mutation(...)  // was ResolveInput
  resolve:   protectedProcedure.input(ByEvent).mutation(...)  // was ResolveInput
```

</details>

**Files.** `packages/shared/src/schemas.ts`, `apps/api/src/routers/events.ts`

---

### 11. Introduce an uppercase-overline text primitive/variant and route the inline copies through it

`overline-text-primitive` - **effort** S | **risk** low | **impact** low | **apply #27** (`mobile/ui`)

**Problem.** The uppercase-tracked "overline/eyebrow" recipe (a bold/black font + letterSpacing:1 + textTransform:"uppercase") is re-inlined as raw <Text> in several mobile places instead of going through a shared primitive. AppText is documented as "the single typographic vocabulary" but has no overline variant, so FieldLabel exists as a parallel unregistered recipe and other sites just hand-roll the same styles. This epic covers ONLY the byte-equivalent, behavior-preserving subset: (1) route Countdown's small uppercase label through the existing FieldLabel primitive (its defaults match exactly: font.bold/9/letterSpacing:1/uppercase), and (2) factor Dashboard's two inline eyebrow labels (HistoryDivider + ACTION REQUIRED band header) into ONE in-file local helper. The larger ambition of adding an AppText 'overline' variant, reworking Field's "optional" caption, the TabBar nav label, or Pill's magic font sizes is explicitly OUT OF SCOPE here because those use different weights/sizes/letterSpacing and changing them would alter pixels across unrelated screens (visible behavior change). Verified by reading apps/mobile/src/ui/Countdown.tsx, apps/mobile/src/ui/FieldLabel.tsx, and apps/mobile/src/screens/Dashboard.tsx.

**Why it matters.** High confidence, byte-equivalent, behavior-preserving dedup of a small repeated styling recipe. Removes one parallel inline copy in a shared UI primitive (Countdown -> FieldLabel) and collapses two duplicated eyebrow blocks in Dashboard into one local source of truth. Low effort, low risk, no API/DB/behavior change. Reach is modest (a handful of call sites), hence low impact, but the change is essentially free and improves the "single typographic vocabulary" story incrementally. Ranked 1 because it is the only item in this cluster that is fully verified as safe to ship.

**Change steps.**
1. Countdown.tsx: add `import { FieldLabel } from "./FieldLabel";` near the top (sibling within ui/).
2. Countdown.tsx (lines 25-39): replace the inline label `<Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1, textTransform: "uppercase", color: c, opacity: 0.8, marginBottom: 1 }}>{label}</Text>` with `<FieldLabel style={{ color: c, opacity: 0.8, marginBottom: 1 }}>{label}</FieldLabel>`, keeping the same `label ? ( ... ) : null` guard so it still renders only when label is truthy. FieldLabel's default style (font.bold/9/letterSpacing:1/uppercase/color:ui.ink) plus the style override (color:c wins, adds opacity+marginBottom) is byte-identical to today's output.
3. Countdown.tsx: `font` may still be needed (the duration `<Text>` below uses font.black), so leave the `font` import in place; only the label block changes.
4. Dashboard.tsx: add a small local helper near the other in-file components, e.g. `function Eyebrow({ size, color, children }: { size: number; color: string; children: string }) { return <Text style={{ fontFamily: font.black, fontSize: size, letterSpacing: 1, textTransform: "uppercase", color }}>{children}</Text>; }`.
5. Dashboard.tsx (HistoryDivider, lines ~173-183): replace the inline `<Text>` with `<Eyebrow size={11} color={ui.muted}>Done</Eyebrow>` (exact size 11 / color ui.muted preserved).
6. Dashboard.tsx (ACTION REQUIRED band header, lines ~305-315): replace the inline `<Text>` with `<Eyebrow size={13} color={ui.onInk}>{actionsRequiredLabel(actionCount)}</Eyebrow>` (exact size 13 / color ui.onInk preserved).
7. Run `pnpm typecheck` (and `pnpm lint`) to confirm no regressions; the rendered output must be unchanged.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (Countdown.tsx 25-39):
  {label ? (
    <Text style={{ fontFamily: font.bold, fontSize: 9, letterSpacing: 1,
      textTransform: "uppercase", color: c, opacity: 0.8, marginBottom: 1 }}>
      {label}
    </Text>
  ) : null}
AFTER:
  {label ? (
    <FieldLabel style={{ color: c, opacity: 0.8, marginBottom: 1 }}>{label}</FieldLabel>
  ) : null}

BEFORE (Dashboard.tsx, two sites):
  // HistoryDivider
  <Text style={{ fontFamily: font.black, fontSize: 11, letterSpacing: 1,
    textTransform: "uppercase", color: ui.muted }}>Done</Text>
  // band header
  <Text style={{ fontFamily: font.black, fontSize: 13, letterSpacing: 1,
    textTransform: "uppercase", color: ui.onInk }}>{actionsRequiredLabel(actionCount)}</Text>
AFTER (one helper, two calls):
  function Eyebrow({ size, color, children }: { size: number; color: string; children: string }) {
    return <Text style={{ fontFamily: font.black, fontSize: size, letterSpacing: 1,
      textTransform: "uppercase", color }}>{children}</Text>;
  }
  <Eyebrow size={11} color={ui.muted}>Done</Eyebrow>
  <Eyebrow size={13} color={ui.onInk}>{actionsRequiredLabel(actionCount)}</Eyebrow>
```

</details>

**Files.** `apps/mobile/src/ui/Countdown.tsx`, `apps/mobile/src/screens/Dashboard.tsx`

---

### 12. Extract the shared candidate-sort comparator (startsAt asc, activities last) in events.ts

`extract-candidate-sort-comparator-events` - **effort** S | **risk** low | **impact** low | **apply #1** (`api/events`)

**Problem.** The startsAt-ascending / nulls-last candidate ordering comparator is hand-copied in two places in apps/api/src/routers/events.ts: candidatesFor (the per-event reader, lines 67-71) and the candMap loop in loadEventBundle (the bulk reader, lines 364-368). A comment at line 362 explicitly admits the bulk reader must match the per-event reader by hand ("Preserve candidatesFor's order: startsAt asc, nulls (activities) last."). Both copies are byte-identical: (a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY). Extract one named module-level comparator and have both call sites use it via .sort(...). Pure refactor, identical output ordering, removes the keep-in-sync-by-hand hazard.

**Why it matters.** The comparator is duplicated verbatim across the per-event reader (candidatesFor) and the bulk reader (loadEventBundle), and the codebase already carries a comment acknowledging the two must be kept in sync by hand. Any future change to candidate ordering (e.g. tie-breaking by label) would have to be made in both spots or the two read paths would silently diverge - the single-event detail view and the dashboard bundle would order candidates differently. One named comparator makes the intent self-documenting and eliminates the drift hazard at zero behavioral cost.

**Change steps.**
1. Add a module-level comparator constant near the top of apps/api/src/routers/events.ts (alongside the other helper functions, e.g. just above candidatesFor at line 65): const byStartsAtThenNullsLast = (a: { startsAt: Date | null }, b: { startsAt: Date | null }) => (a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) - (b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY);
2. In candidatesFor (lines 66-71), replace the inline rows.sort((a, b) => { ... }) block with return rows.sort(byStartsAtThenNullsLast);
3. In loadEventBundle's candMap loop (lines 363-369), replace the inline list.sort((a, b) => { ... }) block with list.sort(byStartsAtThenNullsLast);
4. Keep the explanatory comment at line 362 (or trim it to a short note) since the named comparator now documents the 'startsAt asc, activities last' intent; the 'must match candidatesFor by hand' framing is no longer accurate once both share one comparator.
5. Do NOT touch line 430 (sorts non-nullable startsAt time-inputs, no nulls-last branch), line 1005 (sorts by count desc), or anything in packages/shared. Keep Number.POSITIVE_INFINITY (matches existing code; do not switch to bare Infinity).
6. Run pnpm typecheck and pnpm test (and pnpm lint) to confirm no behavior or type change.

<details><summary>Before / after sketch</summary>

```ts
Before (apps/api/src/routers/events.ts):

  // candidatesFor, lines 66-71
  const rows = await db.select().from(eventCandidates).where(eq(eventCandidates.eventId, eventId));
  return rows.sort((a, b) => {
    const at = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    const bt = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
    return at - bt;
  });

  // loadEventBundle candMap loop, lines 362-369
  // Preserve candidatesFor's order: startsAt asc, nulls (activities) last.
  for (const list of candMap.values()) {
    list.sort((a, b) => {
      const at = a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      const bt = b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY;
      return at - bt;
    });
  }

After:

  // module-level, once
  // Candidate display order: startsAt ascending, nulls (activities) last.
  const byStartsAtThenNullsLast = (
    a: { startsAt: Date | null },
    b: { startsAt: Date | null },
  ) =>
    (a.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) -
    (b.startsAt?.getTime() ?? Number.POSITIVE_INFINITY);

  // candidatesFor
  return rows.sort(byStartsAtThenNullsLast);

  // loadEventBundle candMap loop
  for (const list of candMap.values()) {
    list.sort(byStartsAtThenNullsLast);
  }
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 13. Extract the activity-candidate {id,label} projection feeding resolveActivity/displayActivity

`extract-activity-candidate-projection` - **effort** S | **risk** low | **impact** low | **apply #2** (`api/events`)

**Problem.** The projection `cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label }))` is rewritten verbatim at three call sites in apps/api/src/routers/events.ts to adapt mixed eventCandidates rows into the {id,label} shape that resolveActivity/displayActivity expect: openMoment (line 163), mine (line 896), and get (line 1031). Add one module-local helper and call it at those three sites. Behavior-identical. NOTE: the create site (line 495) is NOT part of this cluster - its `activityCands` are locally-built activity-only literals of a different type with no kind filter, so it must be left alone. Line 998's activity projection produces a different shape ({id,text,count,mine}) and is also out of scope.

**Why it matters.** High-confidence, fully-verified, behavior-preserving dedup: three byte-identical copies of the same filter+map collapse into one named helper, giving a single point of truth for the activity-candidate projection. Tiny diff, no API/DB/shared-package surface touched, and pnpm typecheck/test gate it. Ranked 1 because impact x reach over effort is favorable at the lowest risk tier - it is a clean, isolated server-side change.

**Change steps.**
1. Add a module-local helper in apps/api/src/routers/events.ts (near the top, alongside candidatesFor at line 65, or just above openMoment at line 153): function activityCandidateInputs(cands: (typeof eventCandidates.$inferSelect)[]) { return cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })); }
2. Replace line 163 (openMoment) - the inline `cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label }))` argument to resolveActivity - with `activityCandidateInputs(cands)`.
3. Replace line 896 (mine) - the inline projection argument to displayActivity - with `activityCandidateInputs(cands)`.
4. Replace line 1031 (get) - the inline projection argument to displayActivity - with `activityCandidateInputs(cands)`.
5. Do NOT touch line 495 (create): `activityCands` there are locally-built activity-only literals (shape {id, kind:'activity', startsAt:null, partOfDay:null, label}), not eventCandidates.$inferSelect rows, and have no kind filter - the helper does not type-match and is not needed.
6. Do NOT touch line 998 (get's activityCandidates list): it projects to {id,text,count,mine}, a different shape sorted by count - unrelated to the resolve/display projection.
7. Pick a helper name that does NOT collide with the existing create-flow `activityCands` (line 453) or `activityInputs` (line 415); `activityCandidateInputs` is collision-free.
8. Keep the helper local to apps/api/src/routers/events.ts - do NOT push it into @bethere/shared.
9. Run pnpm typecheck and pnpm test after the change.

<details><summary>Before / after sketch</summary>

```ts
Before (repeated at lines 163, 896, 1031):
  resolveActivity(
    e.activity,
    cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label })),
    reactions,
  );
  // ...and the displayActivity(...) variants at 896 and 1031

After (one helper, three call sites):
  function activityCandidateInputs(cands: (typeof eventCandidates.$inferSelect)[]) {
    return cands.filter((c) => c.kind === "activity").map((c) => ({ id: c.id, label: c.label }));
  }
  // 163: resolveActivity(e.activity, activityCandidateInputs(cands), reactions)
  // 896: displayActivity(e.activity, activityCandidateInputs(cands), reactions)
  // 1031: displayActivity(e.activity, activityCandidateInputs(cands), reactions)

Untouched: line 495 (create - activity-only literals, different type) and line 998 ({id,text,count,mine} projection).
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 14. Tighten events.ts exports and local naming (loadEvent export, 'now' alias, 'existing' var)

`events-ts-exports-and-naming` - **effort** S | **risk** low | **impact** low | **apply #8** (`api/events`)

**Problem.** Three pure, behavior-preserving cleanups confined to apps/api/src/routers/events.ts: (1) drop the unused `export` on `loadEvent` (no out-of-file importer; only `requireMember` is consumed by groups.ts), narrowing the module surface; (2) delete the `const now = nowMs` alias and use the established ms-typed name `nowMs` at its value uses, removing the name collision with the Date-typed `now` convention used elsewhere; (3) rename the candidate-slate var `existing` to `cands` in addCandidate to match the file-wide name for a candidatesFor() result. No API/DB/schema/UX/test changes; verified line numbers and usage repo-wide.

**Why it matters.** These are the lowest-cost wins in the cluster: each is a verbatim, single-file rename/visibility change with zero behavioral surface, so the (impact x reach)/effort ratio is high and risk is minimal. Tightening loadEvent's visibility prevents accidental cross-module coupling; dropping the `now` alias removes a genuine readability hazard (a ms number bound to a name that elsewhere holds a Date); the `existing` -> `cands` rename makes addCandidate read like the other six candidatesFor sites in the file. Ranked priority 1 because it is fully verified, safe to apply as-is, and unblocks a clean diff with no dependencies.

**Change steps.**
1. Step 1 - drop loadEvent export: in apps/api/src/routers/events.ts line 258, change `export async function loadEvent(` to `async function loadEvent(`. No call-site edits needed (every caller - lines 585, 639, 671, 773, 1069, 1097, 1113 - is in-file). Leave `requireMember` (line 246) exported: groups.ts:26 imports it.
2. Step 2 - remove the 'now' alias: in the same file, delete the line `const now = nowMs;` (line 502). Replace the value uses of `now` with `nowMs` at lines 504, 519, 527, 537, and 551. Leave the prose comments at 512/513, 522, 532/533, 548, and the unrelated CAS comment at 808 untouched (they read fine and do not reference the variable).
3. Step 3 - rename 'existing' to 'cands' in addCandidate: rename the declaration at line 684 (`const existing = await candidatesFor(input.eventId);` -> `const cands = await candidatesFor(input.eventId);`) and the three value uses at lines 706 (`existing.filter`), 721 (`existing.find`), and 747 (`existing.find`). Leave the comment prose at 699 ('existing time spread') and 719 ('existing row') as-is; they describe prior candidates, not the variable.
4. Step 4 - verify: run `pnpm --filter @bethere/api typecheck` and `pnpm --filter @bethere/api test`; both must pass with no behavior change.

<details><summary>Before / after sketch</summary>

```ts
// 1) module surface (line 258)
- export async function loadEvent(eventId: string, userId: string): Promise<EventRow> {
+ async function loadEvent(eventId: string, userId: string): Promise<EventRow> {
//    (requireMember stays exported - groups.ts:26 imports it)

// 2) ms-typed name, drop the alias (line 502 and its value uses)
- const now = nowMs;
  const earliestMs =
-   timeCands.length > 0 ? timeCands[0].startsAt.getTime() : now + DEFAULT_HORIZON_MS;
+   timeCands.length > 0 ? timeCands[0].startsAt.getTime() : nowMs + DEFAULT_HORIZON_MS;
  ...
- const tooLate = timeCands.length > 0 && t.getTime() > earliestMs - MOMENT_MS;
- if (Number.isNaN(t.getTime()) || t.getTime() <= now || tooLate) { ... }   // line 519
+ if (Number.isNaN(t.getTime()) || t.getTime() <= nowMs || tooLate) { ... }
- decidesBy = new Date(defaultDecidesByForCandidates(earliestMs, now));     // line 527
+ decidesBy = new Date(defaultDecidesByForCandidates(earliestMs, nowMs));
- const floorMs = decidesBy ? decidesBy.getTime() : now;                    // line 537
+ const floorMs = decidesBy ? decidesBy.getTime() : nowMs;
- ? resolveMomentEnd(now, earliestMs, replyBy?.getTime() ?? null)           // line 551
+ ? resolveMomentEnd(nowMs, earliestMs, replyBy?.getTime() ?? null)

// 3) consistent slate name in addCandidate (line 684 + uses 706/721/747)
- const existing = await candidatesFor(input.eventId);
+ const cands = await candidatesFor(input.eventId);
  ...
- const times = existing.filter((c) => c.kind === "time" && c.startsAt)...
+ const times = cands.filter((c) => c.kind === "time" && c.startsAt)...
- const dup = existing.find((c) => c.kind === "time" && ...);   // line 721
+ const dup = cands.find((c) => c.kind === "time" && ...);
- const dup = existing.find((c) => c.kind === "activity" && ...); // line 747
+ const dup = cands.find((c) => c.kind === "activity" && ...);
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 15. Consolidate repeated error-message literals and the caller opt-out clear in events.ts

`consolidate-events-error-literals-and-clearoptout` - **effort** S | **risk** low | **impact** low | **apply #6** (`api/events`)

**Problem.** apps/api/src/routers/events.ts repeats the exact opt-out delete (delete eventOptOuts where eventId & userId) verbatim at three mutation sites (toggleReaction line 629 inside a tx, setOptOut line 661, respond line 1089), and types several user-facing TRPCError messages at multiple sites: "plan is not collecting" at 644/676/781, "the moment is not open" at 1075/1102, and "an activity needs a name" at 742/745. The high-value, clearly behavior-preserving change is a single clearOptOut(eventId, userId, handle = db) helper placed next to ensureReaction (~line 127). The error-literal hoist is optional and lower-value; if done, hoist only the genuinely multi-site strings as plain message-string consts and keep thrown text byte-for-byte identical. No API shapes, codes, or DB schema change.

**Why it matters.** Removes a three-way verbatim duplication of the opt-out delete so the mutual-exclusion-with-opt-out rule lives in one place, and (optionally) gives each multi-site error phrase a single definition. Pure cleanup: no behavior, API shape, code, or schema change.

**Change steps.**
1. Add helper clearOptOut(eventId: string, userId: string, handle: typeof db = db): Promise<void> next to ensureReaction (~apps/api/src/routers/events.ts:127). Body issues the one delete: await handle.delete(eventOptOuts).where(and(eq(eventOptOuts.eventId, eventId), eq(eventOptOuts.userId, userId))). The default db lets setOptOut/respond call it bare; passing the tx handle covers toggleReaction's wrapped case. The transaction handle returned by db.transaction's callback is structurally compatible with the `typeof db` delete/where surface, so no extra Drizzle tx type import is needed.
2. toggleReaction (events.ts ~623-631): inside the existing db.transaction(async (tx) => {...}) block, replace the inline tx.delete(eventOptOuts).where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId))) (line ~628-630) with await clearOptOut(input.eventId, ctx.userId, tx). Keep it inside the same transaction so the +1 and opt-out clear remain one unit.
3. setOptOut (events.ts ~659-663, the else branch): replace the inline db.delete(eventOptOuts).where(...) at line ~660-662 with await clearOptOut(input.eventId, ctx.userId).
4. respond (events.ts ~1087-1090): replace the inline db.delete(eventOptOuts).where(...) at line ~1088-1090 with await clearOptOut(input.eventId, ctx.userId). Preserve the surrounding comment about superseding an earlier opt-out.
5. OPTIONAL error-literal hoist (lower value - the messages are short and self-documenting at the throw site; consider leaving inline). If done: declare plain message-string consts near the top of events.ts, e.g. const ERR_NOT_COLLECTING = "plan is not collecting"; const ERR_MOMENT_NOT_OPEN = "the moment is not open"; const ERR_ACTIVITY_NEEDS_NAME = "an activity needs a name"; then reference them only at the truly multi-site throws: "plan is not collecting" at lines 644/676/781, "the moment is not open" at 1075/1102, "an activity needs a name" at 742/745. Do NOT touch line 590 ("plan is not collecting reactions" - a distinct string). Keep the const as just the message string, NOT the {code,message} object, so each throw keeps its own code at the call site. Verify thrown message text is byte-for-byte unchanged.
6. Verify: run pnpm db:up, then pnpm typecheck and pnpm test. Existing suites events-toggleReaction.test.ts, events-setOptOut.test.ts, and events-respond.test.ts cover all three opt-out paths.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (3 sites, verbatim delete):
  // toggleReaction (~629, inside db.transaction(tx))
  await tx.delete(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));
  // setOptOut (~661, else branch)  /  respond (~1089)  - same but on db
  await db.delete(eventOptOuts)
    .where(and(eq(eventOptOuts.eventId, input.eventId), eq(eventOptOuts.userId, ctx.userId)));

AFTER (one helper near ensureReaction ~127):
  // Drop the caller's opt-out row (a +1 / explicit RSVP rejoins them). Idempotent;
  // pass a tx handle to enlist in a wrapping transaction.
  async function clearOptOut(eventId: string, userId: string, handle: typeof db = db) {
    await handle.delete(eventOptOuts)
      .where(and(eq(eventOptOuts.eventId, eventId), eq(eventOptOuts.userId, userId)));
  }
  // call sites:
  await clearOptOut(input.eventId, ctx.userId, tx);   // toggleReaction (inside tx)
  await clearOptOut(input.eventId, ctx.userId);        // setOptOut
  await clearOptOut(input.eventId, ctx.userId);        // respond

OPTIONAL error consts (message-string only, code stays at the throw):
  const ERR_NOT_COLLECTING = "plan is not collecting";
  throw new TRPCError({ code: "BAD_REQUEST", message: ERR_NOT_COLLECTING });  // x3
```

</details>

**Files.** `apps/api/src/routers/events.ts`

---

### 16. Remove the dead add-time partOfDay parameter and the redundant CollectingView optedOut prop

`eventdetail-dead-addtime-partofday-and-redundant-optedout-prop` - **effort** S | **risk** low | **impact** low | **apply #23** (`mobile`)

**Problem.** Two behavior-preserving cleanups in apps/mobile/src/screens/EventDetail.tsx, both verified against the current file. (1) The client add-time flow carries a dead `partOfDay` parameter: `addTime(startsAt, partOfDay?)` has a truthy branch (sends `{ eventId, kind: "time", startsAt, partOfDay }`) that is unreachable because the sole caller - `AddTime`'s `onSubmit` at line 776 - calls `onAdd(newIso)` with only the ISO string. The parameter is threaded through three type sites (addTime body line 193, the onAddTime prop type line 614, AddTime's onAdd type line 751), all carrying the `PartOfDay` type from the line-1 `import type`. Collapsing the branch makes that `PartOfDay` import unused, so it must also be dropped from line 1 (keeping `UpdateEventInput`) or typecheck/lint will break - the original proposal omits this step. (2) CollectingView receives a redundant `optedOut={data.iOptedOut}` prop (call site line 517) that just re-passes a field already present on the `data` object it also receives; the prop is read once at line 652 (`on={optedOut}`). Drop the prop from the call site and signature/param list (lines 517, 600, 609) and read `on={data.iOptedOut}` directly at line 652. Neither change touches the server: the optional `partOfDay` on `events.addCandidate` (schemas.ts / events.ts) and the display path (timeRowLabel line 681 -> `c.partOfDay` + `partOfDayLabel`) are untouched, so there is zero observable change. Verified: the only `partOfDay` type references are lines 1, 193, 614, 751; the only CollectingView `optedOut` prop references are lines 517, 600, 609, 652 (lines 136-172 are an unrelated local var in the parent's optimistic opt-out logic).

**Why it matters.** Both are dead/redundant client surface that misleads readers into thinking the UI can add part-of-day times (it cannot - no caller supplies partOfDay) and that CollectingView's opt-out state is independent of its data prop (it is not). Removing them narrows the client to what is actually reachable, with zero observable change. Low impact but trivial effort and near-zero risk, and the file is touched frequently, so it is a clean quick win.

**Change steps.**
1. Line 1: change `import type { PartOfDay, UpdateEventInput } from "@bethere/shared";` to `import type { UpdateEventInput } from "@bethere/shared";` (PartOfDay becomes unused once the param is removed; UpdateEventInput stays).
2. Lines 193-201: simplify `addTime` - change the signature to `function addTime(startsAt: string) {` and collapse the body to `return runAction(() => trpc.events.addCandidate.mutate({ eventId, kind: "time", startsAt }));`, removing the `partOfDay ? ... : ...` ternary entirely.
3. Line 614: change the `onAddTime` prop type in CollectingView's type block from `onAddTime: (startsAt: string, partOfDay?: PartOfDay) => void;` to `onAddTime: (startsAt: string) => void;`.
4. Line 751: change `AddTime`'s `onAdd` type from `onAdd: (startsAt: string, partOfDay?: PartOfDay) => void;` to `onAdd: (startsAt: string) => void;` (the call site at line 776 already passes only `newIso`, so no change there).
5. Line 517: delete the `optedOut={data.iOptedOut}` line from the `<CollectingView ... />` call site (CollectingView already receives `data`).
6. Line 600: remove `optedOut,` from CollectingView's destructured params list.
7. Line 609: remove `optedOut: boolean;` from CollectingView's param type block.
8. Line 652: change `on={optedOut}` to `on={data.iOptedOut}` in the CheckOption for LABEL_CANT_MAKE_IT.
9. Do NOT touch: the server's optional `partOfDay` on events.addCandidate (packages/shared/src/schemas.ts, apps/api/src/routers/events.ts) or the display path (timeRowLabel line 681, `c.partOfDay`, and the `partOfDayLabel` import from lib/format on line 19). These are reachable and load-bearing.
10. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before opening the PR.

<details><summary>Before / after sketch</summary>

```ts
addTime (lines 193-201):
- BEFORE:
  function addTime(startsAt: string, partOfDay?: PartOfDay) {
    return runAction(() =>
      trpc.events.addCandidate.mutate(
        partOfDay
          ? { eventId, kind: "time", startsAt, partOfDay }
          : { eventId, kind: "time", startsAt },
      ),
    );
  }
- AFTER:
  function addTime(startsAt: string) {
    return runAction(() =>
      trpc.events.addCandidate.mutate({ eventId, kind: "time", startsAt }),
    );
  }

line 1:
- BEFORE: import type { PartOfDay, UpdateEventInput } from "@bethere/shared";
- AFTER:  import type { UpdateEventInput } from "@bethere/shared";

prop types:
- BEFORE (614): onAddTime: (startsAt: string, partOfDay?: PartOfDay) => void;
- AFTER  (614): onAddTime: (startsAt: string) => void;
- BEFORE (751): onAdd: (startsAt: string, partOfDay?: PartOfDay) => void;
- AFTER  (751): onAdd: (startsAt: string) => void;

CollectingView optedOut prop:
- BEFORE (517, in <CollectingView>): data={data}  /  optedOut={data.iOptedOut}  /  busy={busy} ...
- AFTER  (517): data={data}  /  busy={busy} ...   (optedOut line removed)
- BEFORE (600,609): function CollectingView({ data, optedOut, busy, ... }: { data: Detail; optedOut: boolean; busy: boolean; ... })
- AFTER  (600,609): function CollectingView({ data, busy, ... }: { data: Detail; busy: boolean; ... })
- BEFORE (652): on={optedOut}
- AFTER  (652): on={data.iOptedOut}
```

</details>

**Files.** `apps/mobile/src/screens/EventDetail.tsx`

---

### 17. Adopt useBusyAction in GroupDetail and fix its now-stale doc comment

`adopt-usebusyaction-groupdetail-fix-stale-comment` - **effort** S | **risk** low | **impact** low | **apply #21** (`mobile`)

**Problem.** useBusyAction was extracted from GroupDetail's run(fn) and is now used by EventDetail, but GroupDetail still open-codes the identical busy-guard/mutate/reload skeleton (GroupDetail.tsx:122-136). Its only deltas - an upfront setError(false) (line 125) and a Promise<boolean> return - are inert: the boolean is ignored at both call sites (lines 194, 219), and the eager error clear is unobservable because GroupDetail only renders a full-screen DetailError (when error is true the screen is the error screen and these buttons are unreachable), so error is always already false when these buttons can be pressed. The hook's doc comment (useBusyAction.ts:13-27) also has it backwards: it falsely claims GroupDetail "already factored it locally" and EventDetail "open-codes" the body, and reproduces the 5-line body verbatim. Adopt the hook (delete local run, rename call sites to runAction), then correct and trim the comment. apps/mobile only, one package, no shared runtime import. Behavior-preserving cleanup - no API, DB, or UX change.

**Why it matters.** Removes ~15 lines of duplicated control flow and routes both detail screens through one runner, while killing a doc comment that actively misinforms (it claims the opposite of reality about which screen adopted the hook). Dedup is within apps/mobile only - both files are in the same package - so there is no cross-package shared-runtime-import trap. Verified inert deltas mean the change is provably behavior-preserving: the boolean return is discarded at both call sites, and the eager setError(false) is unobservable since GroupDetail has no in-place error banner (error true => full-screen DetailError => buttons unreachable => error always false when buttons are pressed).

**Change steps.**
1. In GroupDetail.tsx, add import { useBusyAction } from "../lib/useBusyAction"; alongside the other lib imports (near line 25, by useFetchOnFocus).
2. Delete the local async function run (GroupDetail.tsx:122-136) and replace it with const runAction = useBusyAction({ busy, setBusy, setError, load }); placed after load/effects, before the flash helper (around line 137). The ignored Promise<boolean> return and the no-op eager setError(false) drop out with zero observable change.
3. Update the two call sites: line 194 (groups.rename) and line 219 (groups.removeMember) from run(...) to runAction(...). Both already use the call as the entire onPress arrow body, discarding any return.
4. Do NOT port the eager setError(false) into the shared hook - that would be a needless in-flight behavior change for EventDetail; GroupDetail does not need it (no in-place error banner, only full-screen DetailError).
5. Fix the stale comment in useBusyAction.ts:13-16: it has EventDetail/GroupDetail backwards. State plainly that the hook captures the busy/error/load skeleton and is adopted by both EventDetail and GroupDetail (after this change).
6. Trim the verbatim 5-line body reproduction in useBusyAction.ts:18-22 - the function body right below is the canonical source. Keep the load-bearing notes: it reuses the screen's own busy/error/load state (so a screen adopts it without moving where that state lives), and a handler that needs extra work in the same busy window passes an async fn that runs after the mutation, before load().
7. Verify with pnpm lint, pnpm typecheck, pnpm test. Existing GroupDetail coverage is apps/mobile/src/screens/__tests__/Groups.test.tsx; EventDetail coverage exercises the shared hook via EventDetail.test.tsx.

<details><summary>Before / after sketch</summary>

```ts
GroupDetail.tsx - before:
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(false);
    try { await fn(); await load(); return true; }
    catch { setError(true); return false; }
    finally { setBusy(false); }
  }
  ...
  onPress={() => run(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))}
  onPress={() => run(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))}

GroupDetail.tsx - after:
  import { useBusyAction } from "../lib/useBusyAction";
  const runAction = useBusyAction({ busy, setBusy, setError, load });
  ...
  onPress={() => runAction(() => trpc.groups.rename.mutate({ id: groupId, name: nameDraft.trim() }))}
  onPress={() => runAction(() => trpc.groups.removeMember.mutate({ groupId, userId: m.id }))}

useBusyAction.ts comment - before (backwards + verbatim body):
  // ... EventDetail (...) open-codes this body per handler; GroupDetail already factored it
  // locally as `run(fn)`. This is that body, byte-for-byte:
  //   if (busy) return; setBusy(true); try { await fn(); await load(); } catch ... finally ...

useBusyAction.ts comment - after (correct, trimmed):
  // The repeated "guard while busy -> set busy -> mutate -> reload -> clear busy (surfacing errors)"
  // skeleton, factored into one runner, adopted by both EventDetail and GroupDetail. It reuses the
  // screen's own busy/error/load state, so a screen adopts it without moving where that state lives.
  // A handler needing extra work in the same busy window passes an async fn that runs after the
  // mutation, before load() - preserving the original ordering. Returns a memoized runAction(fn).
```

</details>

**Files.** `apps/mobile/src/screens/GroupDetail.tsx`, `apps/mobile/src/lib/useBusyAction.ts`

---

### 18. Simplify CreateWizard derived state (replyShown fallback, activity count/list, canAdvance, STEPS)

`create-wizard-derived-state-cleanup` - **effort** S | **risk** low | **impact** low | **apply #28** (`mobile`)

**Problem.** Four small, behavior-preserving cleanups in apps/mobile/src/screens/CreateWizard.tsx, all VERIFIED against the live code. (1) replyShown's `?? autoReplyIso` fallback is dead - replyToSend already folds in the default, so the alternate branch can never fire (unlike decidesShown, whose fallback IS load-bearing). (2) activityCount and summaryActivities independently recompute the same "chips + trimmed draft" rule; derive the count from the list so they are provably in sync. (3) canAdvance(stepKey) is evaluated twice per render (Button disabled prop at line 584, goNext early-return at line 305) using the same function and arg; hoist to one canGoNext local. (4) STEPS is SCREAMING_CASE for a per-render-computed mutable local, against the repo's constant-casing convention; rename to camelCase steps (the ProgressDots prop is already named steps). No user-visible behavior, API shape, or DB change.

**Why it matters.** All four are in one ~50-line render-derivation block of a single file, share the same tiny risk profile, and are best applied together as one commit. The wins are readability and correctness-by-construction: removing a misleading dead fallback that falsely implies symmetry with decidesShown, guaranteeing activityCount == summaryActivities.length, collapsing a double evaluation to one, and fixing a casing-convention violation. No reach beyond this file; no behavior change; effort is trivial.

**Change steps.**
1. replyShown (line 226): replace `const replyShown = replyToSend ?? autoReplyIso;` with `const replyShown = replyToSend;`. replyToSend (lines 209-214) returns undefined only when autoReplyIso == null, and otherwise always a non-null string, so the `?? autoReplyIso` branch is unreachable. Leave decidesShown (line 225) unchanged - decidesToSend CAN be undefined while autoDecidesIso is non-null (e.g. decidesEdit=false), so its fallback is real. Optionally add a one-line comment: reply-by, unlike decides-by, already bakes its default into replyToSend, so no fallback is needed here.
2. activityCount + summaryActivities: hoist the summaryActivities block (currently lines 221-223) to sit just before the current activityCount line (158); it depends only on activityChips/activityDraft, both declared by line 70. Then replace `const activityCount = activityChips.length + (activityDraft.trim() ? 1 : 0);` with `const activityCount = summaryActivities.length;`. Remove the now-orphaned summaryActivities definition from its old spot near line 221. Both already apply the identical non-de-duping rule, so count == list length is preserved exactly (matches existing line-158 behavior).
3. canGoNext: after the loading guard and the nextLabel/stepCopy setup (around line 318, after `if (loading) return <ScreenLoading />;`), add `const canGoNext = canAdvance(stepKey);`. Then use it at the Button disabled prop (line 584): `disabled={!canGoNext || busy}`, and at the goNext early-return (line 305): `if (!canGoNext || busy) return;`. canAdvance is a hoisted function declaration and stepKey is in scope at both sites, so this is a pure single-source-of-truth move.
4. STEPS -> steps: rename the local at line 63 (`const steps = wizardSteps(pastMeetups.length > 0);`) and its three uses: line 64 (`const stepKey = steps[step];`), line 65 (`const isLastStep = step === steps.length - 1;`), line 322 (`<ProgressDots steps={steps} index={step} />`). Four occurrences total; pure rename. Aligns the call site with the already-camelCase ProgressDots `steps` prop.
5. Run pnpm typecheck, pnpm test, and pnpm lint to confirm a clean tree.

<details><summary>Before / after sketch</summary>

```ts
// (1) replyShown - drop the dead fallback
- const replyShown = replyToSend ?? autoReplyIso;
+ // reply-by (unlike decides-by) already bakes its default into replyToSend, so no fallback here
+ const replyShown = replyToSend;
  const decidesShown = !isConcrete ? (decidesToSend ?? autoDecidesIso) : null; // unchanged: fallback is real

// (2) derive count from list (hoist summaryActivities above the count)
+ const summaryActivities = activityChips.concat(activityDraft.trim() ? [activityDraft.trim()] : []);
- const activityCount = activityChips.length + (activityDraft.trim() ? 1 : 0);
+ const activityCount = summaryActivities.length;
  ... (remove the old summaryActivities defn near line 221)

// (3) single evaluation of the gate
  if (loading) return <ScreenLoading />;
  const nextLabel = isLastStep ? "Send to the group" : "Next";
  const stepCopy = STEP_COPY[stepKey];
+ const canGoNext = canAdvance(stepKey);
  ...
- if (!canAdvance(stepKey) || busy) return;   // goNext
+ if (!canGoNext || busy) return;
- disabled={!canAdvance(stepKey) || busy}      // Button
+ disabled={!canGoNext || busy}

// (4) constant-casing fix
- const STEPS = wizardSteps(pastMeetups.length > 0);
- const stepKey = STEPS[step];
- const isLastStep = step === STEPS.length - 1;
+ const steps = wizardSteps(pastMeetups.length > 0);
+ const stepKey = steps[step];
+ const isLastStep = step === steps.length - 1;
  ...
- <ProgressDots steps={STEPS} index={step} />
+ <ProgressDots steps={steps} index={step} />
```

</details>

**Files.** `apps/mobile/src/screens/CreateWizard.tsx`

---

### 19. Replace EventDetail's StatusHeading raw Text with AppText variant="rowLabel"

`replace-statusheading-with-apptext-rowlabel` - **effort** S | **risk** low | **impact** low | **apply #25** (`mobile`)

**Problem.** EventDetail's StatusHeading helper hand-rolls the exact `rowLabel` AppText recipe inline (`{ fontFamily: font.bold, fontSize: 14, color: ui.ink }`) even though AppText variant="rowLabel" is already used elsewhere in the same file. Swap the raw `<Text>` for `<AppText variant="rowLabel" style={{ marginBottom: 12 }}>`, keeping the marginBottom override via style. Pixel-identical, behavior-preserving. The five other proposed sub-items (Chip, Avatar, ScreenHeader, Section, SignIn) are dropped: none reuse an existing variant - they would require adding new variants or are geometric/bespoke recipes (Avatar's size*0.38, the 44px wordmark, the 15px compact title), so they are not behavior-preserving dedups.

**Why it matters.** Removes a hand-rolled duplicate of the named `rowLabel` typography recipe so the single AppText vocabulary stays the one source of truth - the same file already uses variant="rowLabel" (line 700), making the inline copy a pure inconsistency.

**Change steps.**
1. In /Users/gong/Programming/drp_02/apps/mobile/src/screens/EventDetail.tsx, locate the StatusHeading helper (lines 564-570).
2. Replace its body - the raw `<Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, marginBottom: 12 }}>{children}</Text>` - with `<AppText variant="rowLabel" style={{ marginBottom: 12 }}>{children}</AppText>`. AppText is already imported at line 29; the `rowLabel` variant (Text.tsx line 13) supplies font.bold/14/ink, so only the marginBottom carries in `style`.
3. Keep the StatusHeading wrapper function itself - it documents the shared moment locked-in / reveal heading and is called at lines 840 and 863. (Inlining at the two call sites is an equivalent alternative but not necessary.)
4. Leave the `font` import in EventDetail untouched - other inline blocks in the file still reference it.
5. Verify: run `pnpm lint`, `pnpm typecheck`, and `pnpm test`; confirm no remaining raw `<Text style={{ fontFamily: font.bold, fontSize: 14` in EventDetail. Do NOT touch Chip, Avatar, ScreenHeader, Section, or SignIn - those are out of scope (no existing matching variant).

<details><summary>Before / after sketch</summary>

```ts
Before (EventDetail.tsx, lines 564-570):
  function StatusHeading({ children }: { children: string }) {
    return (
      <Text style={{ fontFamily: font.bold, fontSize: 14, color: ui.ink, marginBottom: 12 }}>
        {children}
      </Text>
    );
  }

After:
  function StatusHeading({ children }: { children: string }) {
    return <AppText variant="rowLabel" style={{ marginBottom: 12 }}>{children}</AppText>;
  }

(rowLabel = { fontFamily: font.bold, fontSize: 14, color: ui.ink } - identical render; marginBottom preserved via style override.)
```

</details>

**Files.** `apps/mobile/src/screens/EventDetail.tsx`

---

### 20. Remove the orphaned formatCountdown vocabulary (and its dead SEC_MS const)

`remove-orphaned-formatcountdown` - **effort** S | **risk** low | **impact** low | **apply #16** (`mobile`)

**Problem.** apps/mobile/src/lib/format.ts carries a second, never-called countdown grammar: formatCountdown ("3:05" / "3h 04m" / "2d 3h") plus the SEC_MS const that only it consumes. No production surface imports it - every live countdown (ui/Countdown.tsx, screens/Dashboard.tsx) goes through formatTimeLeft -> countdownLabel. Deleting formatCountdown, SEC_MS, and its test block leaves a single countdown vocabulary for a reader to learn. Behavior-preserving: no screen output changes. Scope is PART 1 only; the proposed countLabel string-helper (PART 2) is dropped as trivial sugar below the cleanup bar (plural() already single-sources the suffix rule).

**Why it matters.** Removes a duplicate countdown grammar that no production code calls, so a reader learns one countdown path instead of two. Pure dead-code deletion - zero user-visible behavior change, and the SEC_MS const dies with its only consumer.

**Change steps.**
1. In /Users/gong/Programming/drp_02/apps/mobile/src/lib/format.ts, delete the formatCountdown function and its preceding doc comment (lines 124-135).
2. In the same file, delete the now-dead `const SEC_MS = 1000;` (line 8). KEEP MIN_MS/HOUR_MS/DAY_MS - they are still used by formatTimeLeft. Optionally tighten the line-7 comment from 'every countdown/duration surface' since seconds-granularity is gone, but this is not required.
3. In /Users/gong/Programming/drp_02/apps/mobile/src/lib/__tests__/format.test.ts, remove formatCountdown from the import list (line 16).
4. In the same test file, delete the entire describe('formatCountdown') block plus its preceding section-comment banner (lines 123-156).
5. Run `pnpm typecheck` and `pnpm --filter @bethere/mobile test` to confirm green (no other module imports formatCountdown/SEC_MS - verified via repo-wide grep, only the definition, its internal SEC_MS use, and the test referenced them).
6. Do NOT add a countLabel helper (PART 2 of the original cluster is intentionally dropped).

<details><summary>Before / after sketch</summary>

```ts
BEFORE (format.ts)
  const SEC_MS = 1000;          // line 8 - consumed only by formatCountdown
  const MIN_MS = 60_000;
  ...
  // A live moment countdown: "12:34" under an hour, "3h 04m" / "2d 3h" beyond...
  export function formatCountdown(ms: number): string {   // lines 124-135
    if (ms <= 0) return "0:00";
    const totalMins = Math.floor(ms / MIN_MS);
    if (totalMins < 60) {
      const secs = Math.floor((ms % MIN_MS) / SEC_MS);
      return `${totalMins}:${pad2(secs)}`;
    }
    const hours = Math.floor(totalMins / 60);
    if (hours < 24) return `${hours}h ${pad2(totalMins % 60)}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  }

AFTER (format.ts)
  const MIN_MS = 60_000;        // SEC_MS removed; MIN/HOUR/DAY kept for formatTimeLeft
  ...
  // formatCountdown gone. One countdown vocabulary remains:
  // formatTimeLeft(ms) -> bare "2 days" / "1 hour"; countdownLabel(ms) -> "<dur> left" / "Closing now".

format.test.ts: drop `formatCountdown,` from the import and delete the whole
describe("formatCountdown", ...) block + its banner comment (lines 123-156).
The formatTimeLeft / countdownLabel describe blocks stay untouched.
```

</details>

**Files.** `apps/mobile/src/lib/format.ts`, `apps/mobile/src/lib/__tests__/format.test.ts`

---

### 21. Extract the resolve-group-by-invite-code preamble in groups.ts

`extract-resolve-group-by-code-preamble` - **effort** S | **risk** low | **impact** low | **apply #10** (`api/groups`)

**Problem.** previewByCode and joinByCode in apps/api/src/routers/groups.ts repeat the identical normalize-code -> BAD_REQUEST "Enter an invite code" -> select-by-inviteCode -> NOT_FOUND "That code does not match a group" block verbatim (lines 108-113 and 128-133), including both error strings. Factor a single private local async helper (e.g. resolveGroupByCode) at the top of groups.ts next to memberIdsOf; both procedures call it and keep their distinct tails (previewByCode tallies members, joinByCode checks/inserts membership). Pure dedup: same inputs, same error codes/messages, same query - behavior-preserving. The helper stays in groups.ts (api package), NOT db/groups.ts, because it throws TRPCError. The by-id sub-proposal (getGroupById/getGroupByCode) is dropped: the by-id miss-handling is non-uniform (get returns null at line 69; inviteByGroup throws NOT_FOUND "group not found" at line 99) and the SELECT is a trivial one-liner already covered by getGroupName.

**Why it matters.** Two procedures carry a verbatim 6-line copy of the same code-resolution logic, including two hardcoded user-facing error strings. Single-sourcing the normalize/empty-check/select/miss-check guarantees preview and join stay in lockstep: if a message or query ever changes, it changes once and cannot drift between the read and write paths. Low impact (small file, two call sites) but trivially safe and removes the only real duplication in the file.

**Change steps.**
1. Open /Users/gong/Programming/drp_02/apps/api/src/routers/groups.ts. Confirm imports already present: normalizeInviteCode (line 8), TRPCError (line 11), eq (line 12), db (line 13), groups (line 23). No new imports needed.
2. Add a private async helper directly below memberIdsOf (after line 34, before `export const groupsRouter`). Signature: `async function resolveGroupByCode(rawCode: string)`. Body: `const code = normalizeInviteCode(rawCode);` then `if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an invite code" });` then `const [group] = await db.select().from(groups).where(eq(groups.inviteCode, code)).limit(1);` then `if (!group) { throw new TRPCError({ code: "NOT_FOUND", message: "That code does not match a group" }); }` then `return group;`. Copy the two message strings byte-for-byte from the existing code so they stay identical.
3. In previewByCode (currently lines 107-119): replace the three-line preamble (the `const code = normalizeInviteCode(...)`, the BAD_REQUEST `if`, the `const [group] = await db.select()...` line, and the NOT_FOUND `if` block - lines 108-113) with a single line `const group = await resolveGroupByCode(input.code);`. Leave the member-count tally (lines 114-118) and the return shape untouched.
4. In joinByCode (currently lines 127-147): replace the identical preamble (lines 128-133) with `const group = await resolveGroupByCode(input.code);`. Leave the existing-membership SELECT, the alreadyMember branch, the onConflictDoNothing insert, and the return shape (lines 134-146) untouched.
5. Run `pnpm --filter @bethere/api typecheck`, `pnpm lint`, and `pnpm --filter @bethere/api test` to confirm the API tests covering preview/join error paths and success paths still pass. Confirm no em dashes were introduced (use hyphens per repo convention).

<details><summary>Before / after sketch</summary>

```ts
BEFORE (groups.ts, the duplicated block appears verbatim in BOTH previewByCode and joinByCode):

  previewByCode: ...query(async ({ input }) => {
    const code = normalizeInviteCode(input.code);
    if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an invite code" });
    const [group] = await db.select().from(groups).where(eq(groups.inviteCode, code)).limit(1);
    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That code does not match a group" });
    }
    const [tally] = await db.select({ n: count() }).from(groupMembers)...
    return { groupId: group.id, name: group.name, memberCount: ... };
  }),

  joinByCode: ...mutation(async ({ ctx, input }) => {
    const code = normalizeInviteCode(input.code);                  // <- same 6 lines
    if (!code) throw new TRPCError({ code: "BAD_REQUEST", ... });
    const [group] = await db.select()...where(eq(groups.inviteCode, code)).limit(1);
    if (!group) { throw new TRPCError({ code: "NOT_FOUND", ... }); }
    const [existing] = await db.select()...                        // distinct tail
    return { groupId: group.id, name: group.name, alreadyMember };
  }),

AFTER (one helper next to memberIdsOf; both call it):

  async function resolveGroupByCode(rawCode: string) {
    const code = normalizeInviteCode(rawCode);
    if (!code) throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an invite code" });
    const [group] = await db.select().from(groups).where(eq(groups.inviteCode, code)).limit(1);
    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "That code does not match a group" });
    }
    return group;
  }

  previewByCode: ...query(async ({ input }) => {
    const group = await resolveGroupByCode(input.code);
    const [tally] = await db.select({ n: count() })...            // unchanged tail
    return { groupId: group.id, name: group.name, memberCount: ... };
  }),

  joinByCode: ...mutation(async ({ ctx, input }) => {
    const group = await resolveGroupByCode(input.code);
    const [existing] = await db.select()...                       // unchanged tail
    return { groupId: group.id, name: group.name, alreadyMember };
  }),
```

</details>

**Files.** `apps/api/src/routers/groups.ts`

---

### 22. Remove the dead shared formatInviteCode helper

`remove-dead-shared-formatinvitecode` - **effort** S | **risk** low | **impact** low | **apply #14** (`shared`)

**Problem.** packages/shared/src/logic/invite.ts exports formatInviteCode, but it has zero runtime consumers. A repo-wide grep finds only its own definition (line 21) plus a passing mention in a mobile comment - mobile consumes @bethere/shared type-only and formats codes with its own intentional local dup (lib/invite.ts formatCode); the API never displays codes, only generates and normalizes them. The other three exports from this file are all live: normalizeInviteCode is used by apps/api/src/routers/groups.ts (joinByCode/preview at lines 108, 128), and INVITE_ALPHABET + INVITE_CODE_LENGTH are used by apps/api/src/db/groups.ts (freshInviteCode generation, lines 14-15). Removing the unused formatter deletes a never-exercised helper that can silently drift from mobile's formatCode. Behavior-preserving: no runtime path changes, no API shape or DB change.

**Why it matters.** Removes a never-exercised public helper that is a standing maintenance liability: it duplicates the formatting rule mobile reimplements as formatCode, so the two can silently diverge with no test or call site to catch it. Deleting it shrinks the shared surface to only what is actually consumed, with no user-visible behavior, API, or DB change.

**Change steps.**
1. Open packages/shared/src/logic/invite.ts and delete lines 20-25: the 1-line doc comment ('// Group a code for display as two readable quads...') plus the entire formatInviteCode function body (export function formatInviteCode... through its closing brace).
2. Leave INVITE_ALPHABET (line 10), INVITE_CODE_LENGTH (line 11), and normalizeInviteCode (lines 13-18) untouched - all three have live API consumers.
3. Leave the barrel packages/shared/src/index.ts as-is: it uses `export * from "./logic/invite.js"`, so dropping one named export needs no edit.
4. Do NOT touch apps/mobile/src/lib/invite.ts - its formatCode is the intentional cross-package local dup (Metro/jest value-import trap). Optionally (not required) update the comment on line 16 there that says 'Mirrors formatInviteCode in @bethere/shared' to reference normalizeInviteCode instead, since the mirrored symbol no longer exists in shared.
5. Run pnpm typecheck, pnpm lint, and pnpm test to confirm nothing referenced the removed export.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (packages/shared/src/logic/invite.ts):
  export function normalizeInviteCode(raw: string): string {
    return raw.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  }

  // Group a code for display as two readable quads: "ABCD-EF12". Shorter codes are returned as-is.
  export function formatInviteCode(code: string): string {
    const c = code.toUpperCase();
    if (c.length <= 4) return c;
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  }

AFTER:
  export function normalizeInviteCode(raw: string): string {
    return raw.replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
  }
(formatInviteCode + its doc comment removed; INVITE_ALPHABET, INVITE_CODE_LENGTH, normalizeInviteCode unchanged; barrel unchanged.)
```

</details>

**Files.** `packages/shared/src/logic/invite.ts`

---

### 23. Make saveEdit's field descriptors the single source for the conflict-adopt mapping

`eventdetail-saveedit-conflict-adopt-descriptor` - **effort** M | **risk** low | **impact** low | **apply #24** (`mobile`)

**Problem.** saveEdit (apps/mobile/src/screens/EventDetail.tsx) builds a `fields` descriptor list (lines 251-270) billed as the single source of truth for the editable-field set. It already drives the per-field diff into `patch`. But the conflict-adopt path re-encodes the field-to-data mapping twice more: a loop at line 291 that calls `f.set(c.current)` for input state, and a hardcoded `if/else-if` switch at lines 295-299 inside the `setData` updater that maps each conflicted field name back onto the `data` object (activity -> activityRaw, location -> location, description -> description). Adding a future editable field would mean touching three places and risk drift. Fix: give each `fields` entry an `applyToData(d, v)` callback, then drive the adopt branch from the descriptor list in a single pass over res.conflicts. Behavior-preserving cleanup, single file, single package.

**Why it matters.** The `fields` list is explicitly documented as "the single source of truth for the editable-field set" (lines 248-250), yet the conflict-adopt path re-derives the same field-to-data mapping in a hardcoded if/else-if (lines 295-299). That is exactly the kind of duplicated mapping that drifts: a future editable field added to the descriptor would silently fail to adopt on conflict until someone also remembers the switch. Centralizing the mapping in the descriptor makes "add a field = touch one place" true, with zero change to API calls, patch diffing, reload behavior, or ordering.

**Change steps.**
1. Add an `applyToData: (d, v) => void` callback to each of the three entries in the `fields` descriptor (lines 251-270): activity -> `(d, v) => { d.activityRaw = v; }`, location -> `(d, v) => { d.location = v; }`, description -> `(d, v) => { d.description = v; }`. Note the data shape uses `activityRaw`, not `activity`, so the activity entry maps to `d.activityRaw`.
2. Type the `d` parameter of `applyToData` so it matches the non-null branch of the `setData` updater (the local `next` object, i.e. a non-undefined copy of `data`). Reuse the existing element type rather than introducing a new exported type.
3. Replace the standalone input-state adopt loop at line 291 and the hardcoded `if/else-if` switch at lines 295-299 with a single pass: iterate `res.conflicts`, and for each conflict look up its descriptor via `fields.find((f) => f.key === c.field)`. Call `descriptor.set(c.current)` for the input state, then call `descriptor.applyToData(next, c.current)` inside the one `setData` updater.
4. Keep the `setData` updater's early-return guard (`if (!d) return d;`) and the `const next = { ...d }` shallow copy exactly as-is; only the body that mutates `next` changes from the if/else-if switch to the descriptor-driven loop.
5. Guard the lookup the same way line 291 does today (optional-chain or skip when no descriptor matches) so an unknown conflict field is silently ignored rather than throwing.
6. Do NOT touch the three reload conditions (line 286 `return load()` on no conflicts, line 305 `if (res.applied.length > 0) return load()`, line 309 `return load()` in catch), the `trpc.events.update.mutate` call, the patch-building diff loop, or any ordering. Leave the `// Adopt the server's current value...` comment (or update its wording only to reflect the single pass).
7. Do NOT add the unrelated "untangle the three reload branches" sub-goal from the original proposal - it is unspecified and would risk behavior change. Scope is strictly the conflict-adopt consolidation.
8. Run `pnpm lint`, `pnpm typecheck`, and `pnpm --filter @bethere/mobile test` to confirm no behavior or type regressions.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (apps/mobile/src/screens/EventDetail.tsx, lines 251-301):

  const fields = [
    { key: "activity" as const,    loaded: data.activityRaw,        value: editActivity, set: setEditActivity },
    { key: "location" as const,    loaded: data.location,           value: editLocation, set: setEditLocation },
    { key: "description" as const, loaded: data.description ?? "",   value: editNotes,    set: setEditNotes },
  ];
  ...
  .then((res) => {
    if (res.conflicts.length === 0) { setEditSheet(false); return load(); }   // reload 1 (keep)
    for (const c of res.conflicts) fields.find((f) => f.key === c.field)?.set(c.current);  // input-state loop
    setData((d) => {
      if (!d) return d;
      const next = { ...d };
      for (const c of res.conflicts) {                       // hardcoded mapping, duplicates descriptors
        if (c.field === "activity") next.activityRaw = c.current;
        else if (c.field === "location") next.location = c.current;
        else if (c.field === "description") next.description = c.current;
      }
      return next;
    });
    setEditStatus("Updated by someone else - review and save again.");
    if (res.applied.length > 0) return load();               // reload 2 (keep)
  })
  .catch(() => { setEditStatus(...); return load(); })        // reload 3 (keep)

AFTER:

  const fields = [
    { key: "activity" as const,    loaded: data.activityRaw,      value: editActivity, set: setEditActivity, applyToData: (d, v) => { d.activityRaw = v; } },
    { key: "location" as const,    loaded: data.location,         value: editLocation, set: setEditLocation, applyToData: (d, v) => { d.location = v; } },
    { key: "description" as const, loaded: data.description ?? "", value: editNotes,    set: setEditNotes,    applyToData: (d, v) => { d.description = v; } },
  ];
  ...
  .then((res) => {
    if (res.conflicts.length === 0) { setEditSheet(false); return load(); }   // reload 1 (unchanged)
    setData((d) => {
      if (!d) return d;
      const next = { ...d };
      for (const c of res.conflicts) {
        const f = fields.find((f) => f.key === c.field);       // one source of truth
        if (!f) continue;
        f.set(c.current);                                      // input state
        f.applyToData(next, c.current);                        // local baseline
      }
      return next;
    });
    setEditStatus("Updated by someone else - review and save again.");
    if (res.applied.length > 0) return load();                 // reload 2 (unchanged)
  })
  .catch(() => { setEditStatus(...); return load(); })          // reload 3 (unchanged)

(Note: `f.set` is a React setState call; running it inside the setData updater is fine since updaters run synchronously during dispatch, but if the team prefers to keep setState calls out of the updater, the input-state loop can stay separate and only the if/else-if switch is replaced by `f.applyToData(next, c.current)`. Either way the hardcoded field mapping is gone. The simplest behavior-identical option that drops one loop is the combined pass shown; the conservative option keeps two passes both driven by the descriptor.)
```

</details>

**Files.** `apps/mobile/src/screens/EventDetail.tsx`

---

### 24. Single-source the wizard step list in lib/redo.ts

`single-source-wizard-steps` - **effort** S | **risk** low | **impact** low | **apply #18** (`mobile`)

**Problem.** wizardSteps (apps/mobile/src/lib/redo.ts:59-63) writes the full ordered wizard sequence twice - once with the 'source' step and once without - just to conditionally insert that one step. Any future step change (add/remove/reorder) must be made identically to both literals or the two branches silently diverge. Replace the two hardcoded arrays with one canonical ordered list and filter out 'source' when there is no past history. Output order and values are byte-identical for both branches (verified against redo.test.ts:11-28), so this is fully behavior-preserving with no API/DB/UI impact. The companion idea (reusing DEADLINE_VOTING at CreateWizard.tsx:232) is intentionally excluded - see Why-not below.

**Why it matters.** The step sequence is currently maintained in two places, so a single conceptual change ("add/move a wizard step") requires two synchronized edits and silently breaks if they drift. Folding it to one canonical list removes that footgun for any future create-flow change. Effort is trivial (one function body), risk is minimal (pure helper already pinned by tests), and it leaves the module clearer.

**Change steps.**
1. Edit /Users/gong/Programming/drp_02/apps/mobile/src/lib/redo.ts: replace the two-literal body of wizardSteps (lines 59-63) with one canonical const STEPS: StepKey[] = ["group", "source", "activities", "times", "details", "deadlines", "confirm"] and return STEPS.filter((s) => s !== "source" || hasPast).
2. Keep the existing explanatory comment above wizardSteps (redo.ts:47-49) verbatim - it documents why 'source' is conditional and stays accurate.
3. Preserve the StepKey[] return type on wizardSteps; the canonical array is typed StepKey[] so the filtered result remains StepKey[].
4. Run pnpm --filter @bethere/mobile test (redo.test.ts:11-28 already asserts both branches), then pnpm lint and pnpm typecheck to confirm no behavior or type change.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (redo.ts:59-63):
  export function wizardSteps(hasPast: boolean): StepKey[] {
    return hasPast
      ? ["group", "source", "activities", "times", "details", "deadlines", "confirm"]
      : ["group", "activities", "times", "details", "deadlines", "confirm"];
  }

AFTER:
  export function wizardSteps(hasPast: boolean): StepKey[] {
    const STEPS: StepKey[] = ["group", "source", "activities", "times", "details", "deadlines", "confirm"];
    return STEPS.filter((s) => s !== "source" || hasPast);
  }

filter(false) -> source dropped -> ["group","activities","times","details","deadlines","confirm"]
filter(true)  -> source kept    -> ["group","source","activities","times","details","deadlines","confirm"]
Both match redo.test.ts:11-28 exactly.
```

</details>

**Files.** `apps/mobile/src/lib/redo.ts`

---

### 25. Single-source the weekday/day/month label in lib/format (dayUpper kept as-is)

`format-day-label-single-source` - **effort** S | **risk** low | **impact** low | **apply #15** (`mobile`)

**Problem.** In apps/mobile/src/lib/format.ts, formatSlot (lines 97-100) and dayUpper (lines 102-106) independently build the same "WEEKDAYS[getDay] getDate MONTHS_SHORT[getMonth]" day-label assembly - dayUpper is just the uppercased day-half of formatSlot. The day-label shape therefore lives in two places. Extract a single private helper `dayLabel(d)` and have both call it. This is a behavior-preserving dedup: uppercasing the whole composed "Wed 3 Jun" string yields the identical "WED 3 JUN" as uppercasing each word piece, because the only non-letter tokens (the spaces and the numeric day) are untouched by toUpperCase. Existing format.test.ts already pins all four outputs and guards the change. Do NOT rename dayUpper: per the verifier note it is not a true naming outlier (clock12/colorFor/initials are verb-less display peers in the same file) and a rename only adds ~3-file churn for no behavior benefit; that piece is captured below as an explicitly-deferred sub-idea, not part of this epic's work.

**Why it matters.** The day-label shape (WEEKDAYS[getDay] + getDate + MONTHS_SHORT[getMonth]) is duplicated across two functions, so any future change to the day format must be made in two spots and kept in sync. A single private dayLabel builder makes formatSlot and dayUpper a thin time-suffix / uppercase wrapper over one source of truth, with zero behavior change and full test coverage already in place.

**Change steps.**
1. 1. In apps/mobile/src/lib/format.ts, just below the MONTHS_SHORT array (after line 94, before formatSlot at line 97), add a private (non-exported) helper: const dayLabel = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
2. 2. Rewrite formatSlot's body (lines 98-99) to reuse it: `const d = new Date(iso); return `${dayLabel(d)}, ${timeStringFrom(d)}`;` - output stays 'Wed 3 Jun, 19:05'.
3. 3. Rewrite dayUpper's body (lines 104-105) to reuse it: `const d = new Date(iso); return dayLabel(d).toUpperCase();` - output stays 'WED 3 JUN' (toUpperCase on the composed string is identical to uppercasing each word token since digits and spaces are unaffected).
4. 4. Keep the existing doc comments on both exported functions; optionally add a one-line comment on dayLabel noting it is the shared 'Wed 3 Jun' day-label builder.
5. 5. Run the pinned tests: pnpm --filter @bethere/mobile test -- format.test.ts (the formatSlot/dayUpper cases at lines 233, 239, 243, 248 must stay green), plus pnpm lint and pnpm typecheck.
6. 6. DO NOT rename dayUpper. Leave the export name, its EventDetail.tsx import (line 19) and use (line 457), and the test references unchanged. The rename is deferred (see linearBody 'Deferred / out of scope').

<details><summary>Before / after sketch</summary>

```ts
Before (apps/mobile/src/lib/format.ts):
  export function formatSlot(iso: string): string {
    const d = new Date(iso);
    return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}, ${timeStringFrom(d)}`;
  }
  export function dayUpper(iso: string): string {
    const d = new Date(iso);
    return `${WEEKDAYS[d.getDay()].toUpperCase()} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()].toUpperCase()}`;
  }

After:
  // Shared "Wed 3 Jun" day label - the weekday/day/month half of every slot string.
  const dayLabel = (d: Date) => `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;

  export function formatSlot(iso: string): string {
    const d = new Date(iso);
    return `${dayLabel(d)}, ${timeStringFrom(d)}`;
  }
  export function dayUpper(iso: string): string {
    const d = new Date(iso);
    return dayLabel(d).toUpperCase();
  }
// Unchanged outputs: formatSlot -> 'Wed 3 Jun, 19:05'; dayUpper -> 'WED 3 JUN'. Public exports + name dayUpper untouched.
```

</details>

**Files.** `apps/mobile/src/lib/format.ts`

---

### 26. Dedupe the "Who's in?" moment-open notification content in syncReminders

`dedupe-whos-in-moment-open-notification` - **effort** S | **risk** low | **impact** low | **apply #19** (`mobile`)

**Problem.** In apps/mobile/src/lib/notifications.ts, syncReminders builds the exact same moment-open ping - title "Who's in?" plus the body `"${planLabel(e)}" just opened for the moment - say if you're in.` - in two places: the collecting branch (lines 98-102, scheduled for the decides-by instant) and the moment re-arm branch (lines 114-118, scheduled for now). The two paths are intentionally meant to fire identical content (the comment at lines 36-40 and 108-110 documents that the moment branch re-arms the ping the collecting->moment flip cancelled), but the wording is copied verbatim, so any edit must touch both sites and they can silently drift. Extract a single local helper scheduleMomentOpen(e, date) that owns the title and body, and call it from both sites. Purely behavior-preserving: same title, same body, same trigger date in each branch.

**Why it matters.** The two moment-open pings are documented as intentionally identical (the moment branch exists only to re-arm what the collecting->moment flip cancelled), yet the title and body are duplicated verbatim. Naming the content once guarantees the two re-arm paths can never drift, so a future wording change is a single edit instead of two that must be kept in sync.

**Change steps.**
1. In apps/mobile/src/lib/notifications.ts, add a local helper above scheduleAt (e.g. between syncReminders and scheduleLead): `async function scheduleMomentOpen(e: ReminderEvent, date: Date): Promise<void> { await scheduleAt(date, "Who's in?", `"${planLabel(e)}" just opened for the moment - say if you're in.`); }`
2. Replace the collecting-branch call at lines 98-102 (`await scheduleAt(new Date(decideMs), "Who's in?", ...)`) with `await scheduleMomentOpen(e, new Date(decideMs));`
3. Replace the moment-re-arm call at lines 114-118 (`await scheduleAt(new Date(now), "Who's in?", ...)`) with `await scheduleMomentOpen(e, new Date(now));`
4. Leave scheduleAt, scheduleLead, their signatures, the MOMENT_OPEN_WINDOW_MS window guard, the iReacted/iResponded/momentStartsAt guards, and the decides-soon / RSVP-closing branches untouched.
5. Run pnpm lint, pnpm typecheck, and pnpm test (mobile) to confirm the single-file change is clean.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (two verbatim copies in syncReminders):
  // collecting branch (lines 98-102)
  if (decideMs > now) {
    await scheduleAt(
      new Date(decideMs),
      "Who's in?",
      `"${planLabel(e)}" just opened for the moment - say if you're in.`,
    );
  }
  ...
  // moment re-arm branch (lines 114-118)
  await scheduleAt(
    new Date(now),
    "Who's in?",
    `"${planLabel(e)}" just opened for the moment - say if you're in.`,
  );

AFTER (content named once):
  // helper (new, near scheduleAt)
  async function scheduleMomentOpen(e: ReminderEvent, date: Date): Promise<void> {
    await scheduleAt(
      date,
      "Who's in?",
      `"${planLabel(e)}" just opened for the moment - say if you're in.`,
    );
  }

  // collecting branch
  if (decideMs > now) await scheduleMomentOpen(e, new Date(decideMs));
  ...
  // moment re-arm branch
  await scheduleMomentOpen(e, new Date(now));
```

</details>

**Files.** `apps/mobile/src/lib/notifications.ts`

---

### 27. Remove the dead VERB_VOTE / VERB_VOTED copy constants

`remove-dead-verb-vote-copy-constants` - **effort** S | **risk** low | **impact** low | **apply #20** (`mobile`)

**Problem.** copy.ts exports two constants, VERB_VOTE ("Vote") and VERB_VOTED ("Voted"), under a comment billing them as "the single verb for reacting to a candidate". A repo-wide search confirms nothing imports either constant - the screens inline their own "Vote" text (e.g. CreateWizard.tsx:837 builds `Vote on ...` as a raw template literal). The exports and their describing comment are dead code that also actively misleads future contributors into thinking a shared verb token is in use. Delete the two exports and the comment at copy.ts:9-11. This is purely behavior-preserving: no module reads them, so no rendered string changes. Optionally soften the now-slightly-stale clause in the file-top header (copy.ts:1-4) that asserts the verb is "always 'vote'", but that is non-essential. Explicitly out of scope (a separate follow-up idea): routing CreateWizard.tsx:837's literal "Vote on" through a shared constant - that touches a screen and is not part of this cleanup.

**Why it matters.** Dead exports with an authoritative-sounding comment ("the single verb for reacting to a candidate") imply a shared vocabulary token that does not actually exist - screens inline "Vote" themselves. Removing them shrinks copy.ts's public surface and stops the comment from misleading contributors into reusing a token nothing consumes.

**Change steps.**
1. Open apps/mobile/src/lib/copy.ts and delete lines 9-11: the comment `// The single verb for reacting to a candidate (banner already says "Voting closes").` plus `export const VERB_VOTE = "Vote";` and `export const VERB_VOTED = "Voted";`.
2. Leave the blank line so the file flows from the import block straight into the `// The single decline phrase` comment / LABEL_CANT_MAKE_IT export.
3. Do NOT touch CreateWizard.tsx:837's `Vote on ...` literal - it inlines its own string and is an intentional follow-up, not part of this behavior-preserving pass.
4. Optional (non-essential): in the file-top header comment (copy.ts:1-4) soften the clause claiming the verb is 'always "vote"', since the canonical token is being removed - e.g. drop that specific example while keeping the meetup/privacy/deadline wording.
5. Run `pnpm lint`, `pnpm typecheck`, and `pnpm test` to confirm no dangling references and the mobile package still compiles.

<details><summary>Before / after sketch</summary>

```ts
Before (apps/mobile/src/lib/copy.ts:9-11):
  // The single verb for reacting to a candidate (banner already says "Voting closes").
  export const VERB_VOTE = "Vote";
  export const VERB_VOTED = "Voted";

After:
  (lines removed; file goes from the import block directly to)
  // The single decline phrase (drop "I"/"You're").
  export const LABEL_CANT_MAKE_IT = "Can't make it";

Verification: `grep -rn "VERB_VOTE\|VERB_VOTED" apps/ packages/` returns no hits after the edit.
```

</details>

**Files.** `apps/mobile/src/lib/copy.ts`

---

### 28. Single-source the harness table list and derive its insert-override unions from the schema

`harness-single-source-tables-and-schema-derived-unions` - **effort** M | **risk** low | **impact** low | **apply #13** (`api/test`)

**Problem.** apps/api/src/test/harness.ts maintains the same 8-table set in three hand-kept-in-sync places (the schema import, the TRUNCATE SQL string, and the named re-export) and hand-writes the part_of_day and response kind/cond unions inline as string literals, even though the file already derives event-insert shapes from the schema via `$inferInsert` (the `EventOverrides` idiom at line 121). This is a behavior-preserving cleanup: define the table set once as a single array, derive the TRUNCATE list from each table's resolved name via `getTableName` (drizzle-orm), keep the named re-export (consumed by ~14 test files), and replace the three inline unions with `$inferInsert`-derived types. All three are within apps/api, so no cross-package shared-barrel runtime-import trap applies. No API shape, DB schema, or runtime behavior changes.

**Why it matters.** The harness already derives event-insert shapes from the schema (EventOverrides via $inferInsert, line 121), but inconsistently keeps three hand-synced copies of the 8-table set and three inline string-literal unions that duplicate schema enums (responseKindEnum, partOfDayEnum) and the cond jsonb type. Nothing enforces that the import, TRUNCATE string, and re-export agree, and nothing ties the inline unions to the enums - so adding/renaming a table or an enum value silently drifts. Single-sourcing makes the file self-consistent with its own idiom and removes a class of silent-drift bugs, at near-zero behavior risk.

**Change steps.**
1. 1. In apps/api/src/test/harness.ts, keep the existing named import of the 8 Drizzle tables (candidateReactions, eventCandidates, eventOptOuts, events, groupMembers, groups, responses, users) from ../db/schema.js, since the names are referenced individually elsewhere in the file (factory inserts).
2. 2. Add `getTableName` to the existing `import { sql } from "drizzle-orm"` line so it becomes `import { getTableName, sql } from "drizzle-orm"`.
3. 3. Below the imports, define the table set once: `const TRUNCATE_TABLES = [responses, candidateReactions, eventOptOuts, eventCandidates, events, groupMembers, groups, users] as const;` (order is irrelevant under CASCADE per the existing comment at line 66, but matching the current TRUNCATE order keeps the diff minimal).
4. 4. Rewrite resetTables (lines 67-73) to build the list from the array: `const list = TRUNCATE_TABLES.map((t) => `"${getTableName(t)}"`).join(",");` then `sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)`. Keep RESTART IDENTITY CASCADE verbatim.
5. 5. Replace the standalone named re-export block (lines 189-198) so its members come from the single array rather than a second hand-written list. Keep the named re-export form (it is consumed by ~14 test files / hundreds of references) - e.g. continue re-exporting each table by name, or derive the names from TRUNCATE_TABLES while preserving the named bindings. Do NOT collapse it into a star re-export that drops the per-name bindings, and do not merge import+re-export into one statement (the named re-export must remain).
6. 6. In insertTimeCandidate (line 147), change the `partOfDay` override type from the inline `"morning" | "afternoon" | "evening" | "late"` to `NonNullable<typeof eventCandidates.$inferInsert["partOfDay"]>`, keeping the `?? null` default (the column is nullable; NonNullable matches the over-value shape while the default supplies null).
7. 7. In insertResponse (lines 174-181), change the `kind` param type from the inline `"yes" | "no" | "conditional"` to `typeof responses.$inferInsert["kind"]`, and change the `cond` param type from the inline `{ mode: "all" | "any"; targetIds: string[] } | null` to `typeof responses.$inferInsert["cond"]`, keeping the `= null` default.
8. 8. Run `pnpm --filter @bethere/api typecheck` to confirm the derived types resolve identically (the schema enums are response_kind=[yes,no,conditional], part_of_day=[morning,afternoon,evening,late], cond jsonb typed {mode:'all'|'any';targetIds:string[]} - already verified to match the inline literals).
9. 9. Bring up the DB (`pnpm db:up`) and run the harness smoke test (apps/api/src/test/harness.smoke.test.ts via `pnpm --filter @bethere/api test`) to confirm setupTestDb/resetTables/dropTestDb and the re-exports still work end to end.

<details><summary>Before / after sketch</summary>

```ts
BEFORE (apps/api/src/test/harness.ts)
  import { sql } from "drizzle-orm";
  import { candidateReactions, eventCandidates, eventOptOuts, events,
           groupMembers, groups, responses, users } from "../db/schema.js";
  ...
  // (1) hand-written TRUNCATE string - 3rd parallel list:
  sql.raw(`TRUNCATE TABLE "responses","candidate_reactions","event_opt_outs",
    "event_candidates","events","group_members","groups","users"
    RESTART IDENTITY CASCADE`)
  ...
  over: { id?: string; partOfDay?: "morning" | "afternoon" | "evening" | "late" } = {}
  ...
  kind: "yes" | "no" | "conditional",
  cond: { mode: "all" | "any"; targetIds: string[] } | null = null,
  ...
  // (2) hand-written named re-export - 2nd parallel list:
  export { candidateReactions, eventCandidates, eventOptOuts, events,
           groupMembers, groups, responses, users } from "../db/schema.js";

AFTER
  import { getTableName, sql } from "drizzle-orm";
  import { candidateReactions, eventCandidates, eventOptOuts, events,
           groupMembers, groups, responses, users } from "../db/schema.js";

  // one source of truth for the wipe set:
  const TRUNCATE_TABLES = [responses, candidateReactions, eventOptOuts,
    eventCandidates, events, groupMembers, groups, users] as const;
  ...
  const list = TRUNCATE_TABLES.map((t) => `"${getTableName(t)}"`).join(",");
  sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
  ...
  over: { id?: string; partOfDay?: NonNullable<typeof eventCandidates.$inferInsert["partOfDay"]> } = {}
  ...
  kind: typeof responses.$inferInsert["kind"],
  cond: typeof responses.$inferInsert["cond"] = null,
  ...
  // keep the NAMED re-export (consumed by tests), now the only other use of the same set:
  export { candidateReactions, eventCandidates, eventOptOuts, events,
           groupMembers, groups, responses, users } from "../db/schema.js";
```

</details>

**Files.** `apps/api/src/test/harness.ts`

---

