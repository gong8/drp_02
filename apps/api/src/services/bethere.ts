import { randomUUID } from "node:crypto";
import { defaultPlace, findClearingSlot, quorumFor, resolveIn, slotToDate } from "@bethere/shared";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { availability, moments, plans, responses, suggestions } from "../db/schema.js";

const WINDOW_MS = 30 * 60 * 1000; // 30-minute moment window

/**
 * Called after each availability drop. Fires a moment if a concrete slot meets
 * quorum. Pure backend logic - no demo seeding here.
 */
export async function tryFireMoment(suggestionId: string): Promise<string | null> {
  const [sug] = await db.select().from(suggestions).where(eq(suggestions.id, suggestionId));
  if (sug?.status !== "collecting") return null;

  const rows = await db
    .select()
    .from(availability)
    .where(eq(availability.suggestionId, suggestionId));
  const slot = findClearingSlot(
    rows.map((r) => ({ userId: r.userId, slots: r.slots })),
    quorumFor(sug.activity),
  );
  if (!slot) return null;

  const id = randomUUID();
  await db.insert(moments).values({
    id,
    suggestionId,
    activity: sug.activity,
    proposedTime: slotToDate(slot.day, slot.partOfDay),
    proposedPlace: defaultPlace(sug.activity),
    participantIds: slot.userIds,
    quorum: quorumFor(sug.activity),
    windowEndsAt: new Date(Date.now() + WINDOW_MS),
    status: "open",
  });
  await db.update(suggestions).set({ status: "fired" }).where(eq(suggestions.id, suggestionId));
  // TODO push: notify slot.userIds "it's coming together - respond"
  return id;
}

export type ResolveResult = { status: "cleared"; inCount: number } | { status: "fizzled" };

/**
 * Resolve conditionals and decide clear vs fizzle. Idempotent once resolved.
 * On clear we reveal only the IN count (those people opted in - safe). On fizzle we
 * reveal nothing - no push, no trace, nobody learns how close it got (privacy §8.5).
 */
export async function resolveMoment(momentId: string): Promise<ResolveResult> {
  const [moment] = await db.select().from(moments).where(eq(moments.id, momentId));
  if (!moment) return { status: "fizzled" };

  const resp = await db.select().from(responses).where(eq(responses.momentId, momentId));
  const inSet = resolveIn(
    resp.map((r) => ({ userId: r.userId, kind: r.kind, cond: r.cond ?? undefined })),
  );

  if (moment.status === "cleared") return { status: "cleared", inCount: inSet.size };
  if (moment.status === "fizzled") return { status: "fizzled" };

  if (inSet.size >= moment.quorum) {
    await db.insert(plans).values({
      id: randomUUID(),
      momentId,
      activity: moment.activity,
      finalTime: moment.proposedTime,
      place: moment.proposedPlace,
      confirmedParticipantIds: [...inSet],
    });
    await db.update(moments).set({ status: "cleared" }).where(eq(moments.id, momentId));
    // TODO push: notify IN "it clicked - you're on"
    return { status: "cleared", inCount: inSet.size };
  }

  await db.update(moments).set({ status: "fizzled" }).where(eq(moments.id, momentId));
  // SILENT fizzle: no notification, no trace surfaced (privacy §8.5).
  return { status: "fizzled" };
}
