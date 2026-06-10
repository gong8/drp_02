// Vercel Function: per-meetup OpenGraph card for the share link `/m/<token>`.
//
// Our web app is a static Expo (Metro) single-page export, so every route returns the same generic
// <head> - a pasted /m/<token> link would unfurl as nothing. This Function (wired by a vercel.json
// rewrite) fetches the meetup's PUBLIC preview and returns the SAME SPA HTML with a per-meetup
// large-image card spliced into <head>; the page still boots the SPA and client-routes to the meetup.
// It talks ONLY to the public previewByToken endpoint over HTTPS (no DB creds). Needs the runtime env
// OG_API_URL (the API base, per Vercel environment); see docs/runbook-deploy.md. Validate post-deploy
// with an unfurl debugger.

import { cardImageUrl, fetchShell, fetchTrpc, headTags, htmlResponse, whenLabel } from "../_lib/og";

// Edge runtime + a DEFAULT export: Vercel's `/api` builder only recognises a default-export handler
// (a named `export function GET` is a Next.js route-handler convention, not a plain Vercel Function -
// it silently fails to register and the path falls through to the SPA catch-all). Matches api/og.ts.
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
  const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
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
