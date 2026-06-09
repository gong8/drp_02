// Vercel Function: per-meetup OpenGraph card for the share link `/m/<token>`.
//
// Our web app is a static Expo (Metro) single-page export, so every route returns the same generic
// <head> - a pasted /m/<token> link would unfurl as nothing. This function intercepts /m/:id (via a
// vercel.json rewrite), fetches the meetup's PUBLIC preview from the API, and returns the SAME SPA
// HTML with per-meetup og:/twitter: meta spliced into <head>. Chat apps then render a rich card
// ("You're invited to bowling - tonight, with The Boys") while the page still boots the SPA and
// client-routes to the meetup. It talks ONLY to the public previewByToken endpoint over HTTPS (no DB
// creds); an unknown id or any failure falls back to a generic but valid card.
//
// Requires the runtime env var OG_API_URL (the API base, per Vercel environment) - e.g.
// https://96mgvmgcbj.us-east-1.awsapprunner.com (prod) / the dev App Runner URL (preview). Falls back
// to EXPO_PUBLIC_API_URL if OG_API_URL is unset. Validate after deploy with an unfurl debugger.

type Preview = {
  eventId: string;
  activity: string;
  groupName: string;
  phase: string;
  startsAt: string;
  candidateCount: number;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "2026-06-12T19:00:00.000Z" -> "Fri 12 Jun, 19:00" (UTC; the card is a teaser, not the source of
// truth - the app renders the viewer's local time). Returns "" on an unparseable instant.
function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[d.getUTCDay()]} ${d.getUTCDate()} ${months[d.getUTCMonth()]}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function metaFor(preview: Preview | null): { title: string; description: string } {
  if (!preview) {
    return {
      title: "You're invited on BeThere",
      description: "Tap to see the meetup and respond. No app to download.",
    };
  }
  const activity = preview.activity.trim();
  const title = activity ? `You're invited to ${activity}` : "You're invited on BeThere";
  const when = preview.phase === "collecting" ? "Help pick a time" : whenLabel(preview.startsAt);
  const parts = [when, `with ${preview.groupName}`].filter(Boolean);
  return { title, description: `${parts.join(" - ")}. Respond on BeThere - no app to download.` };
}

function headTags(title: string, description: string, canonicalUrl: string): string {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const u = escapeHtml(canonicalUrl);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:title" content="${t}"/>`,
    `<meta property="og:description" content="${d}"/>`,
    `<meta property="og:url" content="${u}"/>`,
    `<meta name="twitter:card" content="summary"/>`,
    `<meta name="twitter:title" content="${t}"/>`,
    `<meta name="twitter:description" content="${d}"/>`,
  ].join("");
}

async function fetchPreview(apiBase: string, id: string): Promise<Preview | null> {
  try {
    const input = encodeURIComponent(JSON.stringify({ eventId: id }));
    const res = await fetch(
      `${apiBase.replace(/\/+$/, "")}/trpc/events.previewByToken?input=${input}`,
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { data?: Preview } };
    return json.result?.data ?? null;
  } catch {
    return null;
  }
}

// Fetch the built SPA HTML from this same deployment (robust against monorepo build ordering - no
// reliance on bundling the file with the function), then splice the meta into <head>.
async function fetchShell(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/index.html`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const apiBase = process.env.OG_API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? "";
  const canonicalUrl = `${url.origin}/m/${id}`;

  const preview = apiBase ? await fetchPreview(apiBase, id) : null;
  const { title, description } = metaFor(preview);
  const tags = headTags(title, description, canonicalUrl);

  const shell = await fetchShell(url.origin);
  const headers = {
    "content-type": "text/html; charset=utf-8",
    // Edge-cache the rendered card briefly; serve stale while revalidating so unfurls stay fast and
    // the API sees ~one request per meetup per TTL (well under the IP rate limit).
    "cache-control": "public, s-maxage=300, stale-while-revalidate=86400",
  };

  if (shell) {
    // Inject just before </head>; the SPA's existing <title> is harmless (the og:* tags drive the
    // card). Body, scripts and root div are untouched, so the app still boots and client-routes.
    const html = shell.includes("</head>")
      ? shell.replace("</head>", `${tags}</head>`)
      : `${tags}${shell}`;
    return new Response(html, { headers });
  }

  // The shell fetch failed: still serve a valid, unfurl-able page with a link in for a human.
  const fallback = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>${tags}</head><body><a href="${escapeHtml(canonicalUrl)}">Open this meetup on BeThere</a></body></html>`;
  return new Response(fallback, { headers });
}
