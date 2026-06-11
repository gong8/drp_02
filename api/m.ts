// Vercel Edge Function: per-meetup OpenGraph card for the share link `/m/<token>`.
//
// Our web app is a static Expo (Metro) single-page export, so every route returns the same generic
// <head> - a pasted /m/<token> link would unfurl as nothing. The vercel.json rewrite maps
// `/m/:id -> /api/m?id=:id` here; this fetches the meetup's PUBLIC preview and returns the SAME SPA
// HTML with a per-meetup large-image card spliced into <head>; the page still boots the SPA and
// client-routes to the meetup. Talks ONLY to the public previewByToken endpoint over HTTPS.
//
// NOTE: a STATIC function file reading the id from the QUERY - NOT a dynamic `api/m/[id].ts`. Under
// this project's `framework: null` + custom `outputDirectory` config Vercel does not register
// dynamic-segment API functions (only flat files like this one and api/og.ts), so the dynamic form
// silently fell through to the SPA catch-all. The rewrite turns the path param into ?id=.

import { cardImageUrl, fetchShell, fetchTrpc, headTags, htmlResponse, whenLabel } from "./_lib/og";

export const config = { runtime: "edge" };

type Preview = {
  eventId: string;
  activity: string;
  groupName: string;
  phase: string;
  startsAt: string;
  candidateCount: number;
};

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  // Deliberately via-free (DRP-63): og:url is the unfurl's canonical identity, so dropping the
  // ?via= sharer ref dedupes card caches across sharers. The hyperlink the recipient actually taps
  // is the original shared URL, which keeps via for brought-by attribution.
  const canonicalUrl = `${url.origin}/m/${id}`;

  const p = await fetchTrpc<Preview>("events.previewByToken", { eventId: id });
  const activity = p?.activity.trim();
  const title = activity ? `You're invited to ${activity}` : "You're invited on BeThere";
  const when = p ? (p.phase === "collecting" ? "Help pick a time" : whenLabel(p.startsAt)) : "";
  const subtitle = p
    ? [when, `with ${p.groupName}`].filter(Boolean).join(" - ")
    : "Tap to see the meetup and respond.";
  const description = `${subtitle}. Respond on BeThere - no app to download.`;
  const image = cardImageUrl(url.origin, title, subtitle);

  const shell = await fetchShell(url.origin);
  return htmlResponse(
    shell,
    headTags({ title, description, url: canonicalUrl, image }),
    canonicalUrl,
  );
}
