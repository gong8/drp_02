import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import {
  clearPendingMeetup,
  extractMeetupToken,
  extractMeetupVia,
  getPendingMeetup,
  setPendingMeetup,
} from "./meetup";
import { trpc } from "./trpc";

// The meetup link the app was opened with - its token plus the sharer ref (?via=, DRP-63) - read
// synchronously on web (from the current location) so the auth Gate can render the public preview
// on the FIRST paint of a logged-out /m/<token> visit - before any effect runs. On native the
// launch URL is async, so it resolves via an effect; native logged-out meetup opens are rare
// (native users are typically already authed).
export type MeetupLaunch = { token: string; via: string | null };

function launchFrom(url: string): MeetupLaunch | null {
  const token = extractMeetupToken(url);
  return token ? { token, via: extractMeetupVia(url) } : null;
}

export function useMeetupLaunch(): MeetupLaunch | null {
  const [launch, setLaunch] = useState<MeetupLaunch | null>(() =>
    Platform.OS === "web" && typeof window !== "undefined"
      ? launchFrom(window.location.href)
      : null,
  );
  useEffect(() => {
    let active = true;
    if (Platform.OS !== "web") {
      Linking.getInitialURL().then((url) => {
        const l = url ? launchFrom(url) : null;
        if (active && l) setLaunch(l);
      });
    }
    const sub = Linking.addEventListener("url", ({ url }) => {
      const l = launchFrom(url);
      if (l) setLaunch(l);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return launch;
}

// Capture-then-resume of a deep-link meetup token across the sign-in boundary, the meetup-link sibling
// of usePendingInviteRouting. While signed out it stashes the token from the launch URL / any incoming
// link so it survives the OAuth page reload; once authed it JOINS the meetup's group (server-side, to
// learn the eventId) then routes to that plan, clearing the stash only after the navigate lands.
// `navigate(eventId)` is supplied by the caller (App-coupled) and returns false until the navigator is
// ready. A meetup token takes precedence over a pending invite code (see usePendingInviteRouting).
export function usePendingMeetupRouting(
  authed: boolean,
  navigate: (eventId: string) => boolean,
): void {
  useEffect(() => {
    if (authed) return;
    let active = true;
    // Stash the sharer (?via=) alongside the token so brought-by attribution survives the OAuth
    // reload too (DRP-63).
    const stashFrom = (url: string) => {
      const t = extractMeetupToken(url);
      if (t) setPendingMeetup(t, extractMeetupVia(url));
    };
    Linking.getInitialURL().then((url) => {
      if (active && url) stashFrom(url);
    });
    const sub = Linking.addEventListener("url", ({ url }) => stashFrom(url));
    return () => {
      active = false;
      sub.remove();
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const pending = getPendingMeetup();
    if (!pending) return;
    let active = true;
    (async () => {
      let eventId: string;
      try {
        const res = await trpc.events.joinByToken.mutate({
          eventId: pending.token,
          via: pending.via ?? undefined,
        });
        eventId = res.eventId;
      } catch {
        // A stale/invalid token (a deleted meetup, a leftover stash) or a door that closed mid-OAuth
        // (FORBIDDEN, DRP-63) must not trap the user on a dead funnel: drop it and let them land in
        // the app normally. Existing roster members are never refused (the join no-ops them in).
        clearPendingMeetup();
        return;
      }
      const go = () => {
        if (!active) return;
        if (navigate(eventId)) clearPendingMeetup();
        else setTimeout(go, 50);
      };
      go();
    })();
    return () => {
      active = false;
    };
  }, [authed, navigate]);
}
