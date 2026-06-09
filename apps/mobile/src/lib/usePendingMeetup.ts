import { useEffect, useState } from "react";
import { Linking, Platform } from "react-native";
import {
  clearPendingMeetup,
  extractMeetupToken,
  getPendingMeetup,
  setPendingMeetup,
} from "./meetup";
import { trpc } from "./trpc";

// The meetup token of the link the app was opened with, read synchronously on web (from the current
// location) so the auth Gate can render the public preview on the FIRST paint of a logged-out
// /m/<token> visit - before any effect runs. On native the launch URL is async, so it resolves via an
// effect; native logged-out meetup opens are rare (native users are typically already authed).
export function useMeetupLaunchToken(): string | null {
  const [token, setToken] = useState<string | null>(() =>
    Platform.OS === "web" && typeof window !== "undefined"
      ? extractMeetupToken(window.location.href)
      : null,
  );
  useEffect(() => {
    let active = true;
    if (Platform.OS !== "web") {
      Linking.getInitialURL().then((url) => {
        const t = url ? extractMeetupToken(url) : null;
        if (active && t) setToken(t);
      });
    }
    const sub = Linking.addEventListener("url", ({ url }) => {
      const t = extractMeetupToken(url);
      if (t) setToken(t);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return token;
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
    Linking.getInitialURL().then((url) => {
      const t = url ? extractMeetupToken(url) : null;
      if (active && t) setPendingMeetup(t);
    });
    const sub = Linking.addEventListener("url", ({ url }) => {
      const t = extractMeetupToken(url);
      if (t) setPendingMeetup(t);
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, [authed]);

  useEffect(() => {
    if (!authed) return;
    const token = getPendingMeetup();
    if (!token) return;
    let active = true;
    (async () => {
      let eventId: string;
      try {
        const res = await trpc.events.joinByToken.mutate({ eventId: token });
        eventId = res.eventId;
      } catch {
        // A stale/invalid token (e.g. a deleted meetup, or a leftover stash) must not trap the user
        // on a dead funnel: drop it and let them land in the app normally.
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
