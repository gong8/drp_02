// Client-side plumbing for the meetup share link (`/m/<token>`, the event id doubles as the token).
// The link is the conversion primitive: dropped in a chat, it previews the meetup before sign-in and
// then joins the group + opens the plan. Mirrors the invite-code plumbing in invite.ts (the same
// type-only-shared constraint applies: these stay mobile-local pure helpers), and reuses invite.ts's
// webOrigin/webStore so the origin + storage fork live in one place.

import { webOrigin, webStore } from "./invite";

// Pull a meetup token out of a deep-link / launch URL, or null if it is not a meetup link. Anchored
// on the `/m/` path segment (not a bare "m/") so it never matches things like "/help/m..." mid-path;
// the token is opaque (a v4-UUID event id), so unlike an invite code there is no length/alphabet to
// validate - any non-empty segment after `/m/`, trimmed of a trailing slash / query / hash, is taken.
export function extractMeetupToken(url: string): string | null {
  const marker = "/m/";
  const at = url.indexOf(marker);
  if (at === -1) return null;
  const rest = url.slice(at + marker.length);
  const token = rest.split(/[/?#]/, 1)[0] ?? "";
  return token.length > 0 ? token : null;
}

// The shareable meetup URL for a token. The `/m/<token>` path mirrors the navigation linking config,
// so the same URL deep-links a native build later. The server-built link (PUBLIC_WEB_URL) is preferred
// when present (events.shareLink.url); this is the client fallback for when it is null (local/native).
export function meetupUrl(token: string): string {
  return `${webOrigin()}/m/${token}`;
}

// A pending meetup token, stashed when a meetup link is opened while signed out so it survives the
// sign-in round trip (on web the OAuth redirect reloads the page, wiping in-memory state - hence
// localStorage there; native keeps it in memory). A separate key from the invite stash so the two
// channels never collide; the routing layer decides precedence (a pending meetup wins).
const STORAGE_KEY = "bethere.pendingMeetup";
let nativePending: string | null = null;

export function setPendingMeetup(token: string): void {
  const store = webStore();
  if (store) store.setItem(STORAGE_KEY, token);
  else nativePending = token;
}

export function getPendingMeetup(): string | null {
  const store = webStore();
  return store ? store.getItem(STORAGE_KEY) : nativePending;
}

export function clearPendingMeetup(): void {
  const store = webStore();
  if (store) store.removeItem(STORAGE_KEY);
  else nativePending = null;
}
