import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useState } from "react";

// The one place the live-clock cadence lives, so the magic 1000 is not re-typed per screen.
export const TICK_MS = 1000;

// The one place the data-poll cadence lives (Dashboard + EventDetail refetch while a plan is live),
// so the magic 5000 is not re-typed per screen.
export const POLL_MS = 5000;

// A focus-scoped live clock: returns a `now` timestamp that re-renders the screen once per
// `intervalMs` while the screen is focused, and stops on blur. Two screens (Dashboard and
// EventDetail) each hand-rolled this exact `useState(Date.now())` + `setInterval` + active-flag
// teardown inside a useFocusEffect; this is that piece, verbatim.
//
// Pass `predicate` to gate the tick (e.g. EventDetail only advances during a live moment/collecting
// phase): when supplied, `now` only updates on a tick where the predicate is true.
export function useLiveClock(intervalMs: number = TICK_MS, predicate?: () => boolean): number {
  const [now, setNow] = useState(Date.now());
  useFocusEffect(
    useCallback(() => {
      let active = true;
      const id = setInterval(() => {
        if (active && (!predicate || predicate())) setNow(Date.now());
      }, intervalMs);
      return () => {
        active = false;
        clearInterval(id);
      };
    }, [intervalMs, predicate]),
  );
  return now;
}
