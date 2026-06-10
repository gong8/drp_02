// Vercel Edge Function: renders a branded 1200x630 OpenGraph card image from ?title= & ?subtitle=,
// referenced as og:image by the /m and /join Functions (and the static baseline). Uses @vercel/og
// (Satori) with plain element-tree objects - no JSX/React. Loads the app's brand faces (Archivo for
// the display title + wordmark, Inter for body) from the deployment's own /fonts so the card matches
// the app's typography; if the fonts can't be fetched it falls back to the bundled default (the image
// still renders). On-brand per docs/m4/DESIGN_LANGUAGE.md: lavender->blush gradient, brand-pink mark.

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const WIDTH = 1200;
const HEIGHT = 630;

type Style = Record<string, string | number>;
const node = (style: Style, children: unknown) => ({ type: "div", props: { style, children } });

type BrandFont = { name: string; data: ArrayBuffer; weight: 500 | 800; style: "normal" };

// Fetch the brand TTFs the build copied into /fonts (see apps/mobile/scripts/inject-og.mjs). All-or-
// nothing: any failure returns [] and the card renders in @vercel/og's default font rather than 500ing.
async function loadBrandFonts(origin: string): Promise<BrandFont[]> {
  try {
    const [a, i] = await Promise.all([
      fetch(`${origin}/fonts/Archivo_800ExtraBold.ttf`),
      fetch(`${origin}/fonts/Inter_500Medium.ttf`),
    ]);
    if (!a.ok || !i.ok) return [];
    const [archivo, inter] = await Promise.all([a.arrayBuffer(), i.arrayBuffer()]);
    return [
      { name: "Archivo", data: archivo, weight: 800, style: "normal" },
      { name: "Inter", data: inter, weight: 500, style: "normal" },
    ];
  } catch {
    return [];
  }
}

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const title = (url.searchParams.get("title") ?? "BeThere").slice(0, 120);
  const subtitle = (url.searchParams.get("subtitle") ?? "").slice(0, 160);

  const tree = node(
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 90,
      backgroundImage: "linear-gradient(135deg, #E9E3FF, #FCE7F0)",
    },
    [
      node(
        {
          fontFamily: "Archivo",
          fontWeight: 800,
          fontSize: 34,
          color: "#C0457E",
          letterSpacing: 1,
        },
        "BeThere",
      ),
      node({ display: "flex", flexDirection: "column" }, [
        node(
          {
            fontFamily: "Archivo",
            fontWeight: 800,
            fontSize: 72,
            color: "#1A1626",
            lineHeight: 1.05,
          },
          title,
        ),
        ...(subtitle
          ? [
              node(
                {
                  fontFamily: "Inter",
                  fontWeight: 500,
                  fontSize: 38,
                  color: "#5B5470",
                  marginTop: 20,
                },
                subtitle,
              ),
            ]
          : []),
      ]),
      node(
        { fontFamily: "Inter", fontWeight: 500, fontSize: 26, color: "#6B6480" },
        "No app to download - respond from your browser",
      ),
    ],
  );

  const fonts = await loadBrandFonts(url.origin);
  // Satori accepts a plain element tree at runtime; the typed signature wants a ReactElement, so cast
  // (we deliberately avoid JSX/React to keep this a dependency-light, bundler-config-free Function).
  const element = tree as unknown as ConstructorParameters<typeof ImageResponse>[0];
  return new ImageResponse(element, {
    width: WIDTH,
    height: HEIGHT,
    // Pass brand fonts when available; omit (use the bundled default) on any fetch failure.
    ...(fonts.length ? { fonts } : {}),
    headers: { "cache-control": "public, s-maxage=86400, stale-while-revalidate=604800" },
  });
}
