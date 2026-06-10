// Vercel Edge Function: per-group OpenGraph card for a group invite link `/join/<code>`. Same pattern
// as api/m.ts (rewrite maps `/join/:code -> /api/join?code=:code`; returns the SPA shell with a
// per-group large-image card spliced into <head>; the SPA then client-routes /join/<code> to
// JoinGroup). Fetches the PUBLIC groups.previewByCode over HTTPS. STATIC file + query param - see
// api/m.ts for why a dynamic api/join/[code].ts does not register under this Vercel config.

import { cardImageUrl, fetchShell, fetchTrpc, headTags, htmlResponse } from "./_lib/og";

export const config = { runtime: "edge" };

type GroupPreview = { groupId: string; name: string; memberCount: number };

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const canonicalUrl = `${url.origin}/join/${code}`;

  const g = await fetchTrpc<GroupPreview>("groups.previewByCode", { code });
  const title = g ? `Join ${g.name} on BeThere` : "Join your group on BeThere";
  const members = g ? `${g.memberCount} member${g.memberCount === 1 ? "" : "s"}` : "";
  const subtitle = members
    ? `${members} - plan real meetups together`
    : "Plan real meetups together";
  const description = `${subtitle}. No app to download.`;
  const image = cardImageUrl(url.origin, title, subtitle);

  const shell = await fetchShell(url.origin);
  return htmlResponse(
    shell,
    headTags({ title, description, url: canonicalUrl, image }),
    canonicalUrl,
  );
}
