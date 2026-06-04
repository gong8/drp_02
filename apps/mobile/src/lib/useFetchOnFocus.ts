import { useFocusEffect } from "@react-navigation/native";
import { useCallback } from "react";

// Run `load` every time the screen gains focus (and re-run if `load`'s identity changes). This is
// the plain fetch-once-on-focus lifecycle GroupDetail hand-rolls:
//
//   useFocusEffect(useCallback(() => { load(); }, [load]))
//
// behaviour-identical, just named. Intentionally narrow: it does NOT add an active-flag guard,
// polling, or teardown. Screens that also poll on an interval or need to drop a stale response on
// blur (Dashboard, EventDetail) keep their own richer useFocusEffect plus useLiveClock -
// those five lifecycles genuinely diverge and a generic hook could not stay behaviour-identical (see
// docs/refactor/2026-06-03-refactor-report.md, cluster 15).
export function useFetchOnFocus(load: () => void): void {
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );
}
