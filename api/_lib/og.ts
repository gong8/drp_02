// Shared helpers for the OG-unfurl Functions (api/m/[id].ts, api/join/[code].ts). Lives under `_lib`
// (a leading underscore means Vercel does NOT treat it as a routable Function); the Functions import
// it and Vercel bundles it in. All of these only ever talk to PUBLIC endpoints over HTTPS - no creds.

export const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// "2026-06-12T19:00:00.000Z" -> "Fri 12 Jun, 19:00" (UTC; the card is a teaser, not the source of
// truth - the app renders the viewer's local time). Returns "" on an unparseable instant.
export function whenLabel(iso: string): string {
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

// The API base for the public-preview fetches, from a RUNTIME env var (EXPO_PUBLIC_* are inlined into
// the SPA bundle and invisible to a Function). Empty -> the caller serves a generic card.
export function apiBase(): string {
  return process.env.OG_API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? "";
}

// Fetch a PUBLIC tRPC query's data over HTTPS (GET ?input=). Returns null on any failure so the card
// degrades to generic rather than erroring.
export async function fetchTrpc<T>(proc: string, input: unknown): Promise<T | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const enc = encodeURIComponent(JSON.stringify(input));
    const res = await fetch(`${base.replace(/\/+$/, "")}/trpc/${proc}?input=${enc}`);
    if (!res.ok) return null;
    const json = (await res.json()) as { result?: { data?: T } };
    return json.result?.data ?? null;
  } catch {
    return null;
  }
}

// The dynamic OG image URL (rendered by api/og.ts into a branded 1200x630 card). Absolute, so every
// scraper can fetch it.
export function cardImageUrl(origin: string, title: string, subtitle: string): string {
  const q = new URLSearchParams({ title, subtitle });
  return `${origin}/api/og?${q.toString()}`;
}

// The large-image card <head> block for a meetup/group.
export function headTags(opts: {
  title: string;
  description: string;
  url: string;
  image: string;
}): string {
  const t = escapeHtml(opts.title);
  const d = escapeHtml(opts.description);
  const u = escapeHtml(opts.url);
  const img = escapeHtml(opts.image);
  return [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}"/>`,
    `<meta property="og:type" content="website"/>`,
    `<meta property="og:title" content="${t}"/>`,
    `<meta property="og:description" content="${d}"/>`,
    `<meta property="og:url" content="${u}"/>`,
    `<meta property="og:image" content="${img}"/>`,
    `<meta property="og:image:width" content="1200"/>`,
    `<meta property="og:image:height" content="630"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="twitter:title" content="${t}"/>`,
    `<meta name="twitter:description" content="${d}"/>`,
    `<meta name="twitter:image" content="${img}"/>`,
  ].join("");
}

// Remove any existing <title> / og: / twitter: / description meta so the per-entity tags we inject are
// the single, authoritative set (the SPA shell carries a generic baseline set - see the build-time
// inject-og step - which we override here per meetup/group).
function stripMeta(html: string): string {
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, "")
    .replace(
      /<meta[^>]*?(property="og:[^"]*"|name="twitter:[^"]*"|name="description")[^>]*?>/gi,
      "",
    );
}

// Build the HTML response: the SPA shell (its baseline meta stripped) with our per-entity meta spliced
// into <head>, so chat apps read the card while the page still boots the SPA and client-routes. Falls
// back to a minimal but valid + unfurl-able page if the shell fetch failed. Edge-cached.
export function htmlResponse(shell: string | null, tags: string, canonicalUrl: string): Response {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "public, s-maxage=300, stale-while-revalidate=86400",
  };
  if (shell) {
    const cleaned = stripMeta(shell);
    const html = cleaned.includes("</head>")
      ? cleaned.replace("</head>", `${tags}</head>`)
      : `${tags}${cleaned}`;
    return new Response(html, { headers });
  }
  const fallback = `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>${tags}</head><body><a href="${escapeHtml(canonicalUrl)}">Open on BeThere</a></body></html>`;
  return new Response(fallback, { headers });
}

// Fetch the built SPA HTML from this same deployment (robust against monorepo build ordering - no
// reliance on bundling the file with the Function).
export async function fetchShell(origin: string): Promise<string | null> {
  try {
    const res = await fetch(`${origin}/index.html`);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
