import { PART_HOUR } from "@bethere/shared";
import { db } from "./client.js";
import {
  candidateReactions,
  eventCandidates,
  eventOptOuts,
  events,
  floatSuggestions,
  floatVotes,
  groupMembers,
  groups,
  responses,
  users,
} from "./schema.js";
import { candId, DEMO_USERS, dayAt, GROUPS, PLANS } from "./seed-data.js";

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
    // Floats carry no candidates; their startsAt is a window-default placeholder and respondByAt
    // falls back to the tip deadline.
    const startsAt = chosen?.startsAt ?? sorted[0]?.startsAt ?? p.lockAt ?? dayAt(2, 19);
    const respondByAt =
      p.momentEndsAt ?? sorted[sorted.length - 1]?.startsAt ?? p.lockAt ?? startsAt;

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
      isAnonymous: p.isAnonymous ?? false,
      minHeat: p.minHeat ?? 2,
      phase: p.phase,
      decidesBy: p.lockAt ?? null,
      chosenCandidateId: chosen ? candId(p.id, chosen.suffix) : null,
      momentStartsAt: p.momentStartsAt ?? null,
      momentEndsAt: p.momentEndsAt ?? null,
    });

    for (const c of p.candidates) {
      const candidateId = candId(p.id, c.suffix);
      await db.insert(eventCandidates).values({
        id: candidateId,
        eventId: p.id,
        startsAt: c.startsAt,
        partOfDay: c.partOfDay ?? null,
        label: c.label ?? null,
      });
      for (const userId of c.reactedBy ?? []) {
        await db.insert(candidateReactions).values({ eventId: p.id, candidateId, userId });
      }
    }

    for (const s of p.floatSuggestions ?? []) {
      const suggestionId = candId(p.id, s.suffix);
      const startsAt =
        s.axis === "time" && s.day != null
          ? dayAt(s.day, PART_HOUR[s.partOfDay ?? "evening"])
          : null;
      await db.insert(floatSuggestions).values({
        id: suggestionId,
        eventId: p.id,
        axis: s.axis,
        text: s.text ?? null,
        partOfDay: s.axis === "time" ? (s.partOfDay ?? null) : null,
        startsAt,
        createdByUserId: p.createdBy,
      });
      for (const userId of s.votedBy ?? []) {
        await db.insert(floatVotes).values({ eventId: p.id, suggestionId, userId });
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
  await db.delete(floatVotes);
  await db.delete(floatSuggestions);
  await db.delete(responses);
  await db.delete(candidateReactions);
  await db.delete(eventOptOuts);
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
