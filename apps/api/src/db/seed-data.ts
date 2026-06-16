import type {
  CandidateKind,
  Conditional,
  PartOfDay,
  PlanPhase,
  ResponseKind,
} from "@bethere/shared";

// The demo seed is curated to mirror the final-presentation deck: the personas Vasanth (the
// organiser) and Milly (the hesitant participant), "The Boys" as the hero group the live demo
// sends into, a dashboard with every bucket populated (Going / Open / Done), a blind moment with a
// pending "I'll go if" conditional to resolve on stage, and a clean invite-link group for the
// no-download join demo. Keep it coherent with the deck if either changes.

// The demo protagonist ("You"). Defaults to the spoofable dev-bypass user u_dev, which is who the
// phone APK and dev web log in as. For a prod-web + Google demo the presenter is a real Clerk user,
// so set DEMO_ME_ID to their Clerk user id (and DEMO_ME_NAME to the label) on the App Runner service
// before reseeding - the seed then makes that account the protagonist across every group and plan.
export const ME_ID = process.env.DEMO_ME_ID ?? "u_dev";
export const ME_NAME = process.env.DEMO_ME_NAME ?? "You";

export const DEMO_USERS = [
  { id: ME_ID, name: ME_NAME, avatarColor: "#5F9472" },
  { id: "u_vasanth", name: "Vasanth", avatarColor: "#557A6B" },
  { id: "u_milly", name: "Milly", avatarColor: "#B05F86" },
  { id: "u_adi", name: "Adi", avatarColor: "#C77D54" },
  { id: "u_lily", name: "Lily", avatarColor: "#5B7DB1" },
  { id: "u_joe", name: "Joe", avatarColor: "#7E6BB0" },
  { id: "u_nathan", name: "Nathan", avatarColor: "#B0654F" },
  { id: "u_bethan", name: "Bethan", avatarColor: "#3F7BA8" },
  { id: "u_noah", name: "Noah", avatarColor: "#A8743F" },
  { id: "u_imogen", name: "Imogen", avatarColor: "#3F7BA8" },
  { id: "u_graham", name: "Graham", avatarColor: "#6B8E5A" },
  { id: "u_zara", name: "Zara", avatarColor: "#C28A3D" },
];

export const GROUPS = [
  // The hero group: the live demo sends a plan here, and the no-download join demo shares its invite.
  {
    id: "g_boys",
    name: "The Boys",
    members: [ME_ID, "u_vasanth", "u_adi", "u_joe", "u_nathan", "u_bethan"],
  },
  // Milly's netball society - the home of the "I'll go if my friends go" conditional.
  {
    id: "g_netball",
    name: "Netball Society",
    members: [ME_ID, "u_milly", "u_lily", "u_imogen", "u_zara"],
  },
  { id: "g_climb", name: "Climbing Group", members: [ME_ID, "u_adi", "u_joe"] },
  {
    id: "g_hs",
    name: "High School Reunion",
    members: [ME_ID, "u_vasanth", "u_imogen", "u_graham", "u_zara"],
  },
  { id: "g_knit", name: "Glitter Natters", members: [ME_ID, "u_lily", "u_bethan", "u_noah"] },
];

export const HOUR = 60 * 60 * 1000;

// A day relative to "now" at a fixed local hour, for legible demo candidate slots.
export function dayAt(daysFromNow: number, hour: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  return d;
}

// An instant a whole number of hours from "now" (negative = in the past). Used for moment
// windows (momentStartsAt / momentEndsAt) so a live blind moment ends in the near future while a
// settled one ended in the recent past.
export function fromNow(hours: number): Date {
  return new Date(Date.now() + hours * HOUR);
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

// Demo plans cover every dashboard bucket and the deck's demo beats. Every plan is anonymous (names
// never shown); collecting plans carry PUBLIC +1 counts on both time and activity candidates.
export const PLANS: Plan[] = [
  // GOING - the payoff card: a confirmed, still-upcoming meetup you're in. Cleared (RSVP window
  // already closed) with a future start, five yeses => the deck's "you and four others are in".
  {
    id: "e_boys_pub",
    groupId: "g_boys",
    createdBy: "u_adi",
    activity: "Pub night",
    location: "The Lighthouse",
    contingent: true,
    quorum: 3,
    phase: "cleared",
    candidates: [
      { suffix: "c1", kind: "time", startsAt: dayAt(2, 19) },
      { suffix: "c2", kind: "time", startsAt: dayAt(3, 19) },
    ],
    chosenSuffix: "c1",
    momentStartsAt: fromNow(-26),
    momentEndsAt: fromNow(-24),
    responses: [
      { userId: ME_ID, kind: "yes" },
      { userId: "u_adi", kind: "yes" },
      { userId: "u_joe", kind: "yes" },
      { userId: "u_nathan", kind: "yes" },
      { userId: "u_bethan", kind: "yes" },
      { userId: "u_vasanth", kind: "no" },
    ],
  },
  // GOING - Milly's story made concrete: a live blind moment you've already committed to, where
  // Milly's "I'll go if You go" conditional has latched onto your yes (revealed once it clears).
  {
    id: "e_netball_social",
    groupId: "g_netball",
    createdBy: "u_lily",
    activity: "Netball social",
    location: "The SU Bar",
    contingent: true,
    quorum: 2,
    phase: "moment",
    candidates: [{ suffix: "c1", kind: "time", startsAt: dayAt(1, 20) }],
    chosenSuffix: "c1",
    momentStartsAt: fromNow(-2),
    momentEndsAt: fromNow(5),
    responses: [
      { userId: ME_ID, kind: "yes" },
      { userId: "u_lily", kind: "yes" },
      { userId: "u_milly", kind: "conditional", cond: { mode: "any", targetIds: [ME_ID] } },
      { userId: "u_zara", kind: "conditional", cond: { mode: "any", targetIds: ["u_lily"] } },
      { userId: "u_imogen", kind: "no" },
    ],
  },
  // OPEN + action required - the live "I'll go if" beat: a blind moment you have NOT answered yet,
  // so you can answer it on stage. Nathan's conditional is already waiting in the background.
  {
    id: "e_boys_bowling",
    groupId: "g_boys",
    createdBy: "u_joe",
    activity: "Bowling",
    location: "TenPin Bexleyheath",
    contingent: true,
    quorum: 3,
    phase: "moment",
    candidates: [{ suffix: "c1", kind: "time", startsAt: dayAt(0, 19) }],
    chosenSuffix: "c1",
    momentStartsAt: fromNow(-1),
    momentEndsAt: fromNow(6),
    responses: [
      { userId: "u_adi", kind: "yes" },
      { userId: "u_joe", kind: "yes" },
      { userId: "u_nathan", kind: "conditional", cond: { mode: "any", targetIds: ["u_adi"] } },
      { userId: "u_bethan", kind: "no" },
    ],
  },
  // OPEN - the "vote" beat: a collecting plan with a fixed activity (lockActivity) and public +1
  // counts on the times, showing momentum without ever naming a voter.
  {
    id: "e_boys_cinema",
    groupId: "g_boys",
    createdBy: "u_vasanth",
    activity: "Dune: Part Two",
    location: "Cineworld Bexleyheath",
    contingent: true,
    quorum: 3,
    phase: "collecting",
    lockActivity: true,
    decidesBy: dayAt(1, 18),
    candidates: [
      {
        suffix: "c1",
        kind: "time",
        startsAt: dayAt(2, 18),
        reactedBy: [ME_ID, "u_adi", "u_joe", "u_nathan"],
      },
      { suffix: "c2", kind: "time", startsAt: dayAt(2, 20), reactedBy: ["u_bethan", "u_vasanth"] },
      { suffix: "c3", kind: "time", startsAt: dayAt(3, 14), reactedBy: ["u_adi"] },
    ],
  },
  // OPEN - both axes open: a collecting plan with no name yet, so the winning ACTIVITY resolves into
  // the plan's name at lock. Public +1 counts on activities AND times.
  {
    id: "e_climb_meet",
    groupId: "g_climb",
    createdBy: "u_adi",
    activity: "",
    contingent: true,
    quorum: 2,
    phase: "collecting",
    decidesBy: dayAt(1, 12),
    candidates: [
      {
        suffix: "a1",
        kind: "activity",
        label: "Bouldering at The Castle",
        reactedBy: ["u_adi", "u_joe"],
      },
      { suffix: "a2", kind: "activity", label: "The pub", reactedBy: [ME_ID] },
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
        reactedBy: [ME_ID],
      },
    ],
  },
  // DONE - history: Vasanth's reunion dinner, cleared and in the past.
  {
    id: "e_hs_dinner",
    groupId: "g_hs",
    createdBy: "u_vasanth",
    activity: "Reunion dinner",
    location: "La Palombe",
    contingent: true,
    quorum: 2,
    phase: "cleared",
    candidates: [
      { suffix: "c1", kind: "time", startsAt: dayAt(-3, 20) },
      { suffix: "c2", kind: "time", startsAt: dayAt(-2, 20) },
    ],
    chosenSuffix: "c2",
    momentStartsAt: fromNow(-50),
    momentEndsAt: fromNow(-48),
    responses: [
      { userId: ME_ID, kind: "yes" },
      { userId: "u_vasanth", kind: "yes" },
      { userId: "u_imogen", kind: "yes" },
      { userId: "u_zara", kind: "yes" },
      { userId: "u_graham", kind: "no" },
    ],
  },
  // DONE - history: a small craft night that happened, cleared in the past.
  {
    id: "e_knit_craft",
    groupId: "g_knit",
    createdBy: "u_lily",
    activity: "Craft night",
    location: "Bethan's place",
    contingent: false,
    quorum: 1,
    phase: "cleared",
    candidates: [{ suffix: "c1", kind: "time", startsAt: dayAt(-5, 19) }],
    chosenSuffix: "c1",
    momentStartsAt: fromNow(-122),
    momentEndsAt: fromNow(-120),
    responses: [
      { userId: ME_ID, kind: "yes" },
      { userId: "u_lily", kind: "yes" },
      { userId: "u_bethan", kind: "yes" },
      { userId: "u_noah", kind: "no" },
    ],
  },
];

export function candId(planId: string, suffix: string): string {
  return `${planId}_${suffix}`;
}

// The start times of a plan's TIME candidates, ascending. The single justified `as Date` cast
// lives here: TS does not narrow startsAt?: Date through the `kind === "time" && c.startsAt` filter.
export function timeStarts(candidates: Cand[]): Date[] {
  return candidates
    .filter((c) => c.kind === "time" && c.startsAt)
    .map((c) => c.startsAt as Date)
    .sort((a, b) => a.getTime() - b.getTime());
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
    const starts = timeStarts(p.candidates);
    if (p.decidesBy && starts.length > 0) {
      const earliest = starts[0].getTime(); // sorted ascending => earliest
      if (p.decidesBy.getTime() > earliest)
        errors.push(`plan ${p.id}: decidesBy is after the earliest time candidate`);
    }

    for (const r of p.responses ?? []) {
      if (!members.has(r.userId))
        errors.push(`plan ${p.id}: response by ${r.userId} who is not in group ${p.groupId}`);
      // A conditional must name at least one target, and every target must be a fellow member
      // (else the "I'll go if" can never resolve and the seed is silently broken).
      if (r.kind === "conditional") {
        const targets = r.cond?.targetIds ?? [];
        if (targets.length === 0)
          errors.push(`plan ${p.id}: conditional response by ${r.userId} names no targets`);
        for (const t of targets) {
          if (!members.has(t))
            errors.push(
              `plan ${p.id}: conditional by ${r.userId} targets ${t} who is not in group ${p.groupId}`,
            );
        }
      }
    }
  }
  return errors;
}
