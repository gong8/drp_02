import type { PartOfDay, PlanPhase, WhenMode } from "@bethere/shared";
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

type Kind = "yes" | "no" | "conditional";

const DEMO_USERS = [
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

const GROUPS = [
  {
    id: "g_boys",
    name: "The Boys",
    members: ["u_dev", "u_adi", "u_lily", "u_joe", "u_nathan", "u_bethan"],
  },
  { id: "g_climb", name: "Climbing Group", members: ["u_dev", "u_adi", "u_joe"] },
  { id: "g_knit", name: "Glitter Natters", members: ["u_dev", "u_lily", "u_bethan", "u_noah"] },
  { id: "g_church", name: "Church Group", members: ["u_dev", "u_joe", "u_noah"] },
  {
    id: "g_hs",
    name: "High School Reunion",
    members: ["u_dev", "u_vasanth", "u_imogen", "u_graham", "u_zara"],
  },
];

const HOUR = 60 * 60 * 1000;

// A day relative to "now" at a fixed local hour, for legible demo candidate slots.
function dayAt(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

interface Cand {
  suffix: string;
  startsAt: Date;
  partOfDay?: PartOfDay;
  label?: string;
  reactedBy?: string[];
}
interface Resp {
  userId: string;
  kind: Kind;
  cond?: { mode: "all" | "any"; targetIds: string[] };
}
interface Plan {
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

// Demo plans cover every (whenMode x phase) the dashboard renders:
// - movie  : options / collecting (You created it, so You see the tally + "Lock it"; c1 clears).
// - pub    : fuzzy   / collecting (You have NOT reacted yet, so the dashboard nudges You).
// - bowling: exact   / moment     (countdown running, blind - You are awaiting).
// - climbing/dinner : cleared (You are Going); football: cleared (You declined).
// - baking : fuzzy   / fizzled    (under quorum - must stay silent / hidden).
const PLANS: Plan[] = [
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
    whenMode: "fuzzy",
    contingent: true,
    quorum: 2,
    phase: "collecting",
    candidates: [
      { suffix: "d1", startsAt: dayAt(1, 19), partOfDay: "evening", reactedBy: ["u_adi", "u_joe"] },
      { suffix: "d2", startsAt: dayAt(2, 19), partOfDay: "evening", reactedBy: ["u_adi"] },
      { suffix: "d3", startsAt: dayAt(3, 19), partOfDay: "evening", reactedBy: ["u_joe"] },
      { suffix: "d4", startsAt: dayAt(4, 19), partOfDay: "evening", reactedBy: [] },
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
    id: "e_climbing",
    groupId: "g_climb",
    createdBy: "u_joe",
    title: "Climbing",
    location: "Ravenswall",
    whenMode: "fuzzy",
    contingent: true,
    quorum: 2,
    phase: "cleared",
    candidates: [{ suffix: "d1", startsAt: dayAt(-2, 19), partOfDay: "evening" }],
    chosenSuffix: "d1",
    momentStartsAt: new Date(Date.now() - 3 * HOUR),
    momentEndsAt: new Date(Date.now() - 2 * HOUR),
    responses: [
      { userId: "u_dev", kind: "yes" },
      { userId: "u_adi", kind: "yes" },
      { userId: "u_joe", kind: "yes" },
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
  {
    id: "e_baking",
    groupId: "g_church",
    createdBy: "u_noah",
    title: "Baking",
    location: "Joe's Place",
    whenMode: "fuzzy",
    contingent: true,
    quorum: 2,
    phase: "fizzled",
    candidates: [{ suffix: "d1", startsAt: dayAt(-1, 17), partOfDay: "afternoon" }],
    chosenSuffix: "d1",
    momentStartsAt: new Date(Date.now() - 4 * HOUR),
    momentEndsAt: new Date(Date.now() - 3 * HOUR),
    responses: [{ userId: "u_noah", kind: "yes" }],
  },
];

function candId(planId: string, suffix: string): string {
  return `${planId}_${suffix}`;
}

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
