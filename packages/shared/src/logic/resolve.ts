import type { ResponseKind } from "../schemas.js";

export interface ResponseInput {
  userId: string;
  kind: ResponseKind;
  cond?: { mode: "all" | "any"; targetIds: string[] };
}

/**
 * Resolve "I'm in if…" conditionals to a fixpoint and return the set of userIds who are IN.
 *
 * Plain yeses anchor the set; conditionals latch on once their targets are IN, and each new
 * member can satisfy further conditionals, so we loop until nothing changes. A pure conditional
 * cycle has no yes to anchor it and therefore never enters IN — no phantom plans nobody wanted.
 */
export function resolveIn(responses: ResponseInput[]): Set<string> {
  const IN = new Set<string>();
  for (const r of responses) {
    if (r.kind === "yes") IN.add(r.userId);
  }

  const conditionals = responses.filter((r) => r.kind === "conditional");
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of conditionals) {
      if (IN.has(r.userId)) continue;
      const cond = r.cond;
      if (!cond) continue;
      const satisfied =
        cond.mode === "all"
          ? cond.targetIds.every((id) => IN.has(id))
          : cond.targetIds.some((id) => IN.has(id));
      if (satisfied) {
        IN.add(r.userId);
        changed = true;
      }
    }
  }
  return IN;
}

export function clears(responses: ResponseInput[], quorum: number): boolean {
  return resolveIn(responses).size >= quorum;
}

/**
 * Linchpins: participants not yet IN whose hypothetical Yes would tip the plan to clearing.
 * Each is eligible for ONE anonymous, positive, ignorable nudge. Returns [] if already clearing.
 */
export function findLinchpins(
  participantIds: string[],
  responses: ResponseInput[],
  quorum: number,
): string[] {
  if (clears(responses, quorum)) return [];
  const current = resolveIn(responses);
  const out: string[] = [];
  for (const p of participantIds) {
    if (current.has(p)) continue;
    const answered = responses.some((r) => r.userId === p && r.kind !== "conditional");
    if (answered) continue; // already said yes/no — don't nudge
    const hypothetical: ResponseInput[] = [
      ...responses.filter((r) => r.userId !== p),
      { userId: p, kind: "yes" },
    ];
    if (clears(hypothetical, quorum)) out.push(p);
  }
  return out;
}
