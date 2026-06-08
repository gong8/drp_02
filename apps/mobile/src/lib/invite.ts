// Client-side invite plumbing for M4 onboarding. The CODE is the surface-agnostic primitive; the
// LINK is a thin presentation layer over it.
//
// The code length + format/normalize rules MIRROR `@bethere/shared`'s invite helpers but are
// re-implemented here rather than imported: `@bethere/shared`'s barrel re-exports with explicit `.js`
// extensions, so a *value* import of it from the mobile app fails to bundle (Metro) and to resolve
// (jest) - mobile consumes shared as TYPES only. Same rationale as lib/lock.ts. These few pure lines
// must stay in lockstep with the shared definitions so a code round-trips through groups.joinByCode.

import { Platform } from "react-native";

// The number of characters in a complete code - gates the "submit" affordance on the join inputs.
// Mirrors INVITE_CODE_LENGTH in @bethere/shared.
export const CODE_LENGTH = 8;

// Display a code grouped for legibility (ABCD-EF12). Mirrors formatInviteCode in @bethere/shared.
export function formatCode(code: string): string {
  const c = code.toUpperCase();
  return c.length <= 4 ? c : `${c.slice(0, 4)}-${c.slice(4)}`;
}

// Turn raw entry into the canonical code. Accepts a bare code, a grouped/spaced/lowercased code, or a
// pasted full invite URL (".../join/CODE") - so pasting either the code or the whole link works. Caps
// at the code length, so trailing query/junk after a URL code is dropped. Mirrors normalizeInviteCode
// in @bethere/shared (plus the URL extraction + length cap the server does not need).
export function normalizeCode(input: string): string {
  const fromUrl = input.includes("/join/") ? (input.split("/join/").pop() ?? "") : input;
  return fromUrl
    .replace(/[^0-9a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, CODE_LENGTH);
}

// Pull a complete invite code out of a deep-link / launch URL, or null if it is not an invite link.
export function extractInviteCode(url: string): string | null {
  if (!url.includes("/join/")) return null;
  const code = normalizeCode(url);
  return code.length === CODE_LENGTH ? code : null;
}

const isWeb = Platform.OS === "web";

// The web origin the share link points at. Prefers an explicit build-time origin (the Vercel domain),
// then the browser's own origin on web, then a placeholder. The server-built link (from PUBLIC_WEB_URL)
// is preferred when present; this is the client fallback for when it is not (local dev / native).
function webOrigin(): string {
  const env = process.env.EXPO_PUBLIC_WEB_URL?.trim();
  if (env) return env.replace(/\/+$/, "");
  if (isWeb && typeof window !== "undefined") return window.location.origin;
  return "https://bethere.app";
}

// The shareable join URL for a code. The `/join/<code>` path mirrors the navigation linking config,
// so this same URL deep-links into a native build later with no change here.
export function joinUrl(code: string): string {
  return `${webOrigin()}/join/${code.toUpperCase()}`;
}

// A pending invite code, stashed when an invite link is opened while signed out so it survives the
// sign-in round trip (on web the OAuth redirect reloads the page, wiping in-memory state - hence
// localStorage there; native keeps it in memory, which is enough as native does not reload).
const STORAGE_KEY = "bethere.pendingInvite";
let nativePending: string | null = null;

function webStore(): Storage | null {
  return isWeb && typeof localStorage !== "undefined" ? localStorage : null;
}

export function setPendingInvite(code: string): void {
  const store = webStore();
  if (store) store.setItem(STORAGE_KEY, code);
  else nativePending = code;
}

export function getPendingInvite(): string | null {
  const store = webStore();
  return store ? store.getItem(STORAGE_KEY) : nativePending;
}

export function clearPendingInvite(): void {
  const store = webStore();
  if (store) store.removeItem(STORAGE_KEY);
  else nativePending = null;
}
