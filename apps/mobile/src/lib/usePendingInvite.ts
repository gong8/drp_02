import { useEffect } from "react";
import { Linking } from "react-native";
import {
  clearPendingInvite,
  extractInviteCode,
  getPendingInvite,
  setPendingInvite,
} from "./invite";

// Capture-then-resume of a deep-link invite code across the sign-in boundary, colocated with the
// invite primitives. While signed out it stashes an invite code from the launch URL / any incoming
// link so it survives sign-in; once authed it resumes the stash by routing to JoinGroup, then clears
// it. `navigate(code)` is supplied by the caller and performs the actual (App-coupled) navigation,
// returning true once it has navigated and false while the navigator is not yet ready - so this hook
// stays free of any App/navigation imports and avoids a lib -> App import cycle.
export function usePendingInviteRouting(
  authed: boolean,
  navigate: (code: string) => boolean,
): void {
  // While signed out, stash an invite code from the launch URL / any incoming link, so it survives
  // sign-in. This runs during every signed-out window - including the brief one before an async Clerk
  // session resolves - so the code is captured even when the navigator was not yet mounted to route
  // it. When already authed the linking config routes invite URLs directly, so we skip stashing (and
  // a stale code never lingers). The web stash lives in localStorage (see lib/invite), so it survives
  // the OAuth redirect's page reload; native keeps it in memory, which the app's lifetime preserves.
  useEffect(() => {
    if (authed) return;
    let active = true;
    Linking.getInitialURL().then((url) => {
      const code = url ? extractInviteCode(url) : null;
      if (active && code) setPendingInvite(code);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      const code = extractInviteCode(url);
      if (code) setPendingInvite(code);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [authed]);

  // Once authed, resume a STASHED invite (the signed-out capture above): route to JoinGroup, then
  // clear it. We rely only on the stash - an already-authed user opening /join/code is routed by the
  // linking config (the navigator is mounted), so the two never both fire. Clearing only after the
  // navigate lands means a torn-down poll cannot drop the code, and go() bails if the effect is gone.
  useEffect(() => {
    if (!authed) return;
    const code = getPendingInvite();
    if (!code) return;
    let active = true;
    const go = () => {
      if (!active) return;
      if (navigate(code)) {
        clearPendingInvite();
      } else {
        setTimeout(go, 50);
      }
    };
    go();
    return () => {
      active = false;
    };
  }, [authed, navigate]);
}
