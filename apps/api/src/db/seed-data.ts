import type {
  CandidateKind,
  Conditional,
  PartOfDay,
  PlanPhase,
  ResponseKind,
} from "@bethere/shared";

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

export const HOUR = 60 * 60 * 1000;

// A day relative to "now" at a fixed local hour, for legible demo candidate slots.
export function dayAt(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// A candidate on a plan: a TIME (startsAt set, optional partOfDay hint) or an ACTIVITY (label set,
// startsAt null). `reactedBy` are the (now PUBLIC) +1 backers.
export interface Cand {
  suffix: string;
  kind: CandidateKind;
  startsAt?: Date;
  partOfDay?: PartOfDay;
  label?: string;
  reactedBy?: string[];
}
export interface Resp {
  userId: string;
  kind: ResponseKind;
  cond?: Conditional;
}
export interface Plan {
  id: string;
  groupId: string;
  createdBy: string;
  activity: string;
  location?: string;
  contingent: boolean;
  quorum: number;
  phase: PlanPhase;
  // Unified candidate list: any mix of kind "time" and kind "activity". Reactions are PUBLIC.
  candidates: Cand[];
  // Creator flags, default false=open. When true, members cannot add that kind of candidate.
  lockTimes?: boolean;
  lockActivity?: boolean;
  // When a collecting plan auto-decides the winning slot and opens the moment. Must sit before the
  // earliest TIME candidate. Null/absent for the concrete shortcut (straight to moment).
  decidesBy?: Date;
  chosenSuffix?: string;
  momentStartsAt?: Date;
  momentEndsAt?: Date;
  responses?: Resp[];
}

// Demo plans cover the phases the dashboard renders. Every plan is anonymous (names never shown);
// collecting plans carry PUBLIC +1 counts on both time and activity candidates.
export const PLANS: Plan[] = [
  {
    id: "e_movie",
    groupId: "g_boys",
    createdBy: "u_dev",
    activity: "Dune: Part Two",
    location: "Cineworld Bexleyheath",
    contingent: true,
    quorum: 3,
    phase: "collecting",
    decidesBy: dayAt(1, 18),
    candidates: [
      {
        suffix: "c1",
        kind: "time",
        startsAt: dayAt(2, 18),
        reactedBy: ["u_dev", "u_adi", "u_lily", "u_joe"],
      },
      {
        suffix: "c2",
        kind: "time",
        startsAt: dayAt(2, 20),
        reactedBy: ["u_dev", "u_nathan", "u_bethan"],
      },
      { suffix: "c3", kind: "time", startsAt: dayAt(3, 14), reactedBy: ["u_lily"] },
    ],
  },
  {
    id: "e_pub",
    groupId: "g_climb",
    createdBy: "u_adi",
    activity: "Pub night",
    location: "The Lighthouse",
    contingent: true,
    quorum: 2,
    phase: "collecting",
    decidesBy: dayAt(1, 12),
    candidates: [
      { suffix: "c1", kind: "time", startsAt: dayAt(1, 19), reactedBy: ["u_adi", "u_joe"] },
      { suffix: "c2", kind: "time", startsAt: dayAt(2, 19), reactedBy: ["u_adi"] },
      { suffix: "c3", kind: "time", startsAt: dayAt(3, 20), reactedBy: ["u_joe"] },
    ],
  },
  {
    id: "e_bowling",
    groupId: "g_boys",
    createdBy: "u_adi",
    activity: "Bowling",
    location: "TenPin Bowling, Bexleyheath",
    contingent: false,
    quorum: 1,
    phase: "moment",
    candidates: [{ suffix: "c1", kind: "time", startsAt: dayAt(0, 19) }],
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
    activity: "Dinner",
    location: "La Palombe",
    contingent: true,
    quorum: 2,
    phase: "cleared",
    candidates: [
      { suffix: "c1", kind: "time", startsAt: dayAt(-3, 20) },
      { suffix: "c2", kind: "time", startsAt: dayAt(-2, 20) },
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
    activity: "Football",
    location: "Goals Wembley",
    contingent: false,
    quorum: 1,
    phase: "cleared",
    candidates: [{ suffix: "c1", kind: "time", startsAt: dayAt(-1, 10) }],
    chosenSuffix: "c1",
    momentStartsAt: new Date(Date.now() - 26 * HOUR),
    momentEndsAt: new Date(Date.now() - 24 * HOUR),
    responses: [
      { userId: "u_dev", kind: "no" },
      { userId: "u_joe", kind: "yes" },
    ],
  },
  {
    // A still-collecting plan in the climbing group, left unnamed so its winning ACTIVITY resolves
    // into the plan's name at lock. Anonymous (no names), with PUBLIC +1 counts on both lists: among
    // activities "bowling" leads (2 backers), and among times the day-2 evening slot leads (2).
    id: "e_float_climb",
    groupId: "g_climb",
    createdBy: "u_adi",
    activity: "",
    contingent: true,
    quorum: 2,
    phase: "collecting",
    decidesBy: dayAt(1, 12),
    candidates: [
      { suffix: "a1", kind: "activity", label: "bowling", reactedBy: ["u_adi", "u_joe"] },
      { suffix: "a2", kind: "activity", label: "the pub", reactedBy: ["u_dev"] },
      {
        suffix: "t1",
        kind: "time",
        startsAt: dayAt(2, 19),
        partOfDay: "evening",
        reactedBy: ["u_adi", "u_joe"],
      },
      {
        suffix: "t2",
        kind: "time",
        startsAt: dayAt(3, 14),
        partOfDay: "afternoon",
        reactedBy: ["u_dev"],
      },
    ],
  },
];

export function candId(planId: string, suffix: string): string {
  return `${planId}_${suffix}`;
}

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
    if (!userIds.has(p.createdBy))
      errors.push(`plan ${p.id}: creator ${p.createdBy} is not a known user`);
    if (!members.has(p.createdBy))
      errors.push(`plan ${p.id}: creator ${p.createdBy} is not in group ${p.groupId}`);

    if (p.candidates.length === 0) errors.push(`plan ${p.id}: has no candidates`);
    const timeCands = p.candidates.filter((c) => c.kind === "time");
    if (p.phase === "collecting" && timeCands.length === 0)
      errors.push(`plan ${p.id}: collecting plan needs at least one time candidate`);
    for (const c of p.candidates) {
      if (c.kind === "time" && !c.startsAt)
        errors.push(`plan ${p.id}: time candidate ${c.suffix} has no startsAt`);
      if (c.kind === "activity" && !c.label)
        errors.push(`plan ${p.id}: activity candidate ${c.suffix} has no label`);
    }

    const suffixes = new Set<string>();
    for (const c of p.candidates) {
      if (suffixes.has(c.suffix))
        errors.push(`plan ${p.id}: duplicate candidate suffix ${c.suffix}`);
      suffixes.add(c.suffix);
      for (const u of c.reactedBy ?? []) {
        if (!members.has(u))
          errors.push(`plan ${p.id}: reaction by ${u} who is not in group ${p.groupId}`);
      }
    }

    if (p.chosenSuffix && !suffixes.has(p.chosenSuffix)) {
      errors.push(`plan ${p.id}: chosenSuffix ${p.chosenSuffix} matches no candidate`);
    }
    const needsChosen = p.phase === "moment" || p.phase === "cleared" || p.phase === "fizzled";
    if (needsChosen && !p.chosenSuffix)
      errors.push(`plan ${p.id}: phase ${p.phase} requires a chosenSuffix`);
    if (p.phase === "collecting" && p.chosenSuffix) {
      errors.push(`plan ${p.id}: collecting plan should not have a chosenSuffix`);
    }
    const startTimes = p.candidates
      .filter((c) => c.kind === "time" && c.startsAt)
      .map((c) => (c.startsAt as Date).getTime());
    if (p.decidesBy && startTimes.length > 0) {
      const earliest = Math.min(...startTimes);
      if (p.decidesBy.getTime() > earliest)
        errors.push(`plan ${p.id}: decidesBy is after the earliest time candidate`);
    }

    for (const r of p.responses ?? []) {
      if (!members.has(r.userId))
        errors.push(`plan ${p.id}: response by ${r.userId} who is not in group ${p.groupId}`);
    }
  }
  return errors;
}
