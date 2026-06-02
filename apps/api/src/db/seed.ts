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
      lockAt: p.lockAt ?? null,
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
