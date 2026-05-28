import { db } from "./client.js";
import { events, groupMembers, groups, responses, users } from "./schema.js";

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

function at(iso: string): Date {
  return new Date(iso);
}

// Demo events spread across the three dashboard statuses for the dev user ("You"):
// Bowling = Awaiting (You haven't answered, deadline ticking); Knitting/Climbing/Dinner =
// Going (You said yes); Baking/Football = Declined (You said no). Peer responses are baked
// in so the "Who's going" list is populated for a solo tester.
const EVENTS: {
  id: string;
  groupId: string;
  createdBy: string;
  title: string;
  location: string;
  startsAt: Date;
  respondByAt: Date;
  responses: { userId: string; kind: Kind }[];
}[] = [
  {
    id: "e_bowling",
    groupId: "g_boys",
    createdBy: "u_adi",
    title: "Bowling",
    location: "TenPin Bowling, Bexleyheath",
    startsAt: at("2026-05-28T16:00:00"),
    respondByAt: new Date(Date.now() + 8 * HOUR + 49 * 60 * 1000),
    responses: [
      { userId: "u_adi", kind: "yes" },
      { userId: "u_lily", kind: "yes" },
      { userId: "u_joe", kind: "yes" },
      { userId: "u_nathan", kind: "no" },
      { userId: "u_bethan", kind: "no" },
    ],
  },
  {
    id: "e_knitting",
    groupId: "g_knit",
    createdBy: "u_noah",
    title: "Knitting",
    location: "Noah's House",
    startsAt: at("2026-05-26T06:00:00"),
    respondByAt: new Date(Date.now() - 24 * HOUR),
    responses: [
      { userId: "u_dev", kind: "yes" },
      { userId: "u_lily", kind: "yes" },
      { userId: "u_bethan", kind: "yes" },
    ],
  },
  {
    id: "e_climbing",
    groupId: "g_climb",
    createdBy: "u_joe",
    title: "Climbing",
    location: "Ravenswall",
    startsAt: at("2026-06-06T20:00:00"),
    respondByAt: new Date(Date.now() + 36 * HOUR),
    responses: [
      { userId: "u_dev", kind: "yes" },
      { userId: "u_adi", kind: "yes" },
    ],
  },
  {
    id: "e_dinner",
    groupId: "g_hs",
    createdBy: "u_vasanth",
    title: "Dinner",
    location: "La Palombe",
    startsAt: at("2026-05-26T20:00:00"),
    respondByAt: new Date(Date.now() - 48 * HOUR),
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
    startsAt: at("2026-06-06T10:00:00"),
    respondByAt: new Date(Date.now() + 12 * HOUR),
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
    startsAt: at("2026-06-30T17:00:00"),
    respondByAt: new Date(Date.now() + 72 * HOUR),
    responses: [
      { userId: "u_dev", kind: "no" },
      { userId: "u_noah", kind: "yes" },
    ],
  },
];

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
  for (const e of EVENTS) {
    await db.insert(events).values({
      id: e.id,
      groupId: e.groupId,
      createdByUserId: e.createdBy,
      title: e.title,
      description: null,
      location: e.location,
      startsAt: e.startsAt,
      respondByAt: e.respondByAt,
      status: "open",
    });
    for (const r of e.responses) {
      await db.insert(responses).values({
        id: `r_${e.id}_${r.userId}`,
        eventId: e.id,
        userId: r.userId,
        kind: r.kind,
        cond: null,
      });
    }
  }
}

// Wipe + re-insert the clean demo (local dev: SEED_ON_BOOT defaults to "reset").
export async function reseedDemo(): Promise<void> {
  await db.delete(responses);
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
