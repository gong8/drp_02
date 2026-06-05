import { useCallback } from "react";

// Inputs for the busy-guarded action runner: the screen's own busy flag + its setters and reload.
// The hook reads the screen's existing state rather than owning it, so a screen can adopt it without
// changing where busy/error live (EventDetail and GroupDetail each already hold these).
type BusyActionDeps = {
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setError: (error: boolean) => void;
  load: () => Promise<unknown>;
};

// The repeated "guard while busy -> set busy -> mutate -> reload -> clear busy (surfacing errors)"
// skeleton, factored into one runner. EventDetail (lock/addTime/addActivity/answer/changeAnswer)
// open-codes this body per handler; GroupDetail already factored it
// locally as `run(fn)`. This is that body, byte-for-byte:
//
//   if (busy) return;
//   setBusy(true);
//   try { await fn(); await load(); }
//   catch { setError(true); }
//   finally { setBusy(false); }
//
// Returns a memoized `runAction(fn)`; each handler becomes `runAction(() => trpc.x.mutate(...))`.
// A handler that needs to run extra work in the same busy window (e.g. EventDetail's
// `setEditing(false)` before reload) passes an async `fn` that does it after the mutation, before
// `load()` runs - the original ordering is preserved.
export function useBusyAction(deps: BusyActionDeps): (fn: () => Promise<unknown>) => Promise<void> {
  const { busy, setBusy, setError, load } = deps;
  return useCallback(
    async (fn: () => Promise<unknown>) => {
      if (busy) return;
      setBusy(true);
      try {
        await fn();
        await load();
      } catch {
        setError(true);
      } finally {
        setBusy(false);
      }
    },
    [busy, setBusy, setError, load],
  );
}
