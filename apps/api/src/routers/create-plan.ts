// The concrete shortcut: a plan with exactly ONE time candidate AND lockTimes set opens straight
// into the blind moment (it always happens, contingent false) - there is nothing left to converge.
// Any other shape (multiple times, no lock, or zero times) starts a collecting round.
export function planOpensMoment(timeCandidateCount: number, lockTimes: boolean): boolean {
  return timeCandidateCount === 1 && lockTimes;
}
