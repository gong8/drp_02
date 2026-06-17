import { isTerminalPhase } from "@bethere/shared";
import { db } from "./client.js";
import { freshInviteCode } from "./groups.js";
import {
  candidateReactions,
  eventCandidates,
  eventGroups,
  eventOptOuts,
  eventParticipants,
  events,
  groupMembers,
  groups,
  responses,
  users,
} from "./schema.js";
import { buildPlans, candId, DEMO_USERS, dayAt, GROUPS, timeStarts } from "./seed-data.js";

async function insertDemoData(): Promise<void> {
  for (const u of DEMO_USERS) {
    await db
      .insert(users)
      .values(u)
      .onConflictDoUpdate({ target: users.id, set: { name: u.name, avatarColor: u.avatarColor } });
  }
  for (const g of GROUPS) {
    await db
      .insert(groups)
      .values({ id: g.id, name: g.name, inviteCode: await freshInviteCode() })
      .onConflictDoNothing();
    for (const userId of g.members) {
      await db.insert(groupMembers).values({ groupId: g.id, userId }).onConflictDoNothing();
    }
  }
  // Recompute the demo plans now (call-time), so moment windows are fresh on every reseed.
  const plans = buildPlans();
  for (const p of plans) {
    const sorted = timeStarts(p.candidates); // Date[], ascending
    const chosen = p.chosenSuffix
      ? p.candidates.find((c) => c.suffix === p.chosenSuffix)
      : undefined;
    // A still-collecting untitled plan has no chosen slot yet; anchor on its earliest time candidate
    // and fall back to decidesBy for the respond-by horizon.
    const startsAt = chosen?.startsAt ?? sorted[0] ?? p.decidesBy ?? dayAt(2, 19);
    const respondByAt = p.momentEndsAt ?? sorted[sorted.length - 1] ?? p.decidesBy ?? startsAt;

    await db.insert(events).values({
      id: p.id,
      groupId: p.groupId,
      createdByUserId: p.createdBy,
      activity: p.activity,
      description: null,
      location: p.location ?? "",
      startsAt,
      respondByAt,
      status: isTerminalPhase(p.phase) ? "resolved" : "open",
      contingent: p.contingent,
      quorum: p.quorum,
      // Creator anonymity is ALWAYS on in the unified model.
      isAnonymous: true,
      lockTimes: p.lockTimes ?? false,
      lockActivity: p.lockActivity ?? false,
      phase: p.phase,
      decidesBy: p.decidesBy ?? null,
      chosenCandidateId: chosen ? candId(p.id, chosen.suffix) : null,
      momentStartsAt: p.momentStartsAt ?? null,
      momentEndsAt: p.momentEndsAt ?? null,
    });

    for (const c of p.candidates) {
      const candidateId = candId(p.id, c.suffix);
      await db.insert(eventCandidates).values({
        id: candidateId,
        eventId: p.id,
        kind: c.kind,
        startsAt: c.startsAt ?? null,
        partOfDay: c.partOfDay ?? null,
        label: c.label ?? null,
      });
      for (const userId of c.reactedBy ?? []) {
        await db.insert(candidateReactions).values({ eventId: p.id, candidateId, userId });
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
  // Delete children before parents. event_participants and event_groups also FK to events (ad-hoc
  // participants / multi-group attach); they are empty on a fresh local DB but populated on the live
  // backends from real use, so omitting them makes `delete(events)` fail a foreign key there.
  await db.delete(responses);
  await db.delete(candidateReactions);
  await db.delete(eventOptOuts);
  await db.delete(eventParticipants);
  await db.delete(eventGroups);
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
