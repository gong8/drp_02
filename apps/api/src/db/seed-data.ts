import type {
  CandidateKind,
  Conditional,
  PartOfDay,
  PlanPhase,
  ResponseKind,
} from "@bethere/shared";

// The demo seed is curated to mirror the final-presentation deck: the personas Vasanth (the
// organiser) and Milly (the hesitant participant) are the two accounts a real two-phone demo logs
// in as; "The Boys" is the hero group both share for the live send -> vote -> moment -> clear flow;
// the dashboard has every bucket populated (Going / Open / Done); a blind moment carries a pending
// "I'll go if" conditional to resolve on stage. Keep it coherent with the deck if either changes.

// The two BINDABLE identities. Each is a real Clerk user id so that signing into the live app with
// that Google account lands you in the seeded groups/plans AS that persona (the user row is
// re-created with the persona name on reseed, so a later sign-in is a no-op). Everyone else in
// DEMO_USERS is a pure prop that never logs in. The live (prod-web + Google) two-phone demo mapping:
//   Vasanth (organiser)            = noahseymour2006@gmail.com
//   Milly   (hesitant participant) = gonglx8@gmail.com
// Each can still be overridden via env (DEMO_VASANTH_ID / DEMO_MILLY_ID) without a code change.
// (These Clerk ids are opaque identifiers, not secrets; swap them here if the demo accounts change.)
export const VASANTH_ID = process.env.DEMO_VASANTH_ID ?? "user_3Ea1MTBkIBa2lMSG10fjuqP8niv";
export const MILLY_ID = process.env.DEMO_MILLY_ID ?? "user_3EXYDJ0W6va8SHr72VYOVG8gyCq";

export const DEMO_USERS = [
  { id: VASANTH_ID, name: "Vasanth", avatarColor: "#557A6B" },
  { id: MILLY_ID, name: "Milly", avatarColor: "#B05F86" },
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
  // The hero group both demo accounts share: the live demo sends a plan here, and the no-download
  // join demo shares its invite. Vasanth + Milly are both members so the two phones can interact.
  {
    id: "g_boys",
    name: "The Boys",
    members: [VASANTH_ID, MILLY_ID, "u_adi", "u_joe", "u_nathan", "u_bethan"],
  },
  // Milly's netball society - her own corner, home of the "I'll go if my friends go" conditional.
  {
    id: "g_netball",
    name: "Netball Society",
    members: [MILLY_ID, "u_lily", "u_imogen", "u_zara"],
  },
  { id: "g_climb", name: "Climbing Group", members: ["u_adi", "u_joe"] },
  // Vasanth's reunion - his own corner, a Done-bucket history item.
  {
    id: "g_hs",
    name: "High School Reunion",
    members: [VASANTH_ID, "u_imogen", "u_graham", "u_zara"],
  },
  { id: "g_knit", name: "Glitter Natters", members: ["u_lily", "u_bethan", "u_noah"] },
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

// Demo plans cover every dashboard bucket for BOTH Vasanth and Milly, and
// the deck's demo beats. Every plan is anonymous (names never shown); collecting plans carry PUBLIC
// +1 counts on both time and activity candidates.
// IMPORTANT: build the plans inside a function, not a module-level const. The moment windows use
// fromNow()/dayAt(), which capture "now" when evaluated. A const freezes them at import (process
// boot), so a later /admin/reseed re-inserts stale past timestamps and every live moment lazily
// settles to cleared (see routers/events.ts). Recomputing here makes each reseed produce fresh,
// currently-live moments without needing a process restart.
export function buildPlans(): Plan[] {
  return [
    // GOING - the payoff card: a confirmed, still-upcoming meetup. Cleared (RSVP window already
    // closed) with a future start; four in, so each of the four sees "you and three others are in".
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
        { userId: VASANTH_ID, kind: "yes" },
        { userId: MILLY_ID, kind: "yes" },
        { userId: "u_adi", kind: "yes" },
        { userId: "u_joe", kind: "yes" },
        { userId: "u_nathan", kind: "no" },
        { userId: "u_bethan", kind: "no" },
      ],
    },
    // OPEN + action required - the live "I'll go if" beat: a blind moment Vasanth and Milly have
    // NOT answered yet, so either phone can answer it on stage. Nathan's conditional already waits.
    {
      id: "e_boys_bowling",
      groupId: "g_boys",
      createdBy: "u_adi",
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
      createdBy: VASANTH_ID,
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
          reactedBy: [VASANTH_ID, MILLY_ID, "u_adi"],
        },
        { suffix: "c2", kind: "time", startsAt: dayAt(2, 20), reactedBy: ["u_joe", "u_nathan"] },
        { suffix: "c3", kind: "time", startsAt: dayAt(3, 14), reactedBy: ["u_bethan"] },
      ],
    },
    // DONE - The Boys history: a past kickabout that happened, so both Vasanth and Milly have a Done
    // item in the hero group.
    {
      id: "e_boys_football",
      groupId: "g_boys",
      createdBy: "u_joe",
      activity: "Five-a-side football",
      location: "Goals Wembley",
      contingent: false,
      quorum: 1,
      phase: "cleared",
      candidates: [{ suffix: "c1", kind: "time", startsAt: dayAt(-1, 18) }],
      chosenSuffix: "c1",
      momentStartsAt: fromNow(-26),
      momentEndsAt: fromNow(-24),
      responses: [
        { userId: VASANTH_ID, kind: "yes" },
        { userId: MILLY_ID, kind: "yes" },
        { userId: "u_adi", kind: "yes" },
        { userId: "u_joe", kind: "no" },
      ],
    },
    // GOING (for Milly) - her story made concrete: a live blind moment she's already committed to,
    // where Zara's "I'll go if Lily goes" conditional has latched on (revealed once it clears).
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
        { userId: MILLY_ID, kind: "yes" },
        { userId: "u_lily", kind: "yes" },
        { userId: "u_zara", kind: "conditional", cond: { mode: "any", targetIds: ["u_lily"] } },
        { userId: "u_imogen", kind: "no" },
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
        { suffix: "a2", kind: "activity", label: "The pub", reactedBy: ["u_joe"] },
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
          reactedBy: ["u_joe"],
        },
      ],
    },
    // DONE (for Vasanth) - his reunion dinner, cleared and in the past.
    {
      id: "e_hs_dinner",
      groupId: "g_hs",
      createdBy: VASANTH_ID,
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
        { userId: VASANTH_ID, kind: "yes" },
        { userId: "u_imogen", kind: "yes" },
        { userId: "u_zara", kind: "yes" },
        { userId: "u_graham", kind: "no" },
      ],
    },
    // DONE - a small craft night in Glitter Natters that happened; a past Done-bucket history item.
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
        { userId: "u_lily", kind: "yes" },
        { userId: "u_bethan", kind: "yes" },
        { userId: "u_noah", kind: "no" },
      ],
    },
  ];
}

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
  plans: Plan[] = buildPlans(),
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
