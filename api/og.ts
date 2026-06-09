// Vercel Edge Function: renders a branded 1200x630 OpenGraph card image from ?title= & ?subtitle=,
// referenced as og:image by the /m/<id> and /join/<code> Functions (and the static baseline). Uses
// @vercel/og (Satori) with plain element-tree objects - no JSX/React - and the bundled default font.
// On-brand per docs/m4/DESIGN_LANGUAGE.md: lavender->blush gradient, ink title, brand-pink wordmark.

import { ImageResponse } from "@vercel/og";

export const config = { runtime: "edge" };

const WIDTH = 1200;
const HEIGHT = 630;

type Style = Record<string, string | number>;
const node = (style: Style, children: unknown) => ({ type: "div", props: { style, children } });

export default function handler(request: Request): Response {
  const { searchParams } = new URL(request.url);
  const title = (searchParams.get("title") ?? "BeThere").slice(0, 120);
  const subtitle = (searchParams.get("subtitle") ?? "").slice(0, 160);

  const tree = node(
    {
      width: "100%",
      height: "100%",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
      padding: 90,
      backgroundImage: "linear-gradient(135deg, #E9E3FF, #FCE7F0)",
      fontFamily: "sans-serif",
    },
    [
      node({ fontSize: 34, fontWeight: 700, color: "#C0457E", letterSpacing: 1 }, "BeThere"),
      node({ display: "flex", flexDirection: "column" }, [
        node({ fontSize: 72, fontWeight: 800, color: "#1A1626", lineHeight: 1.05 }, title),
        ...(subtitle ? [node({ fontSize: 38, color: "#5B5470", marginTop: 20 }, subtitle)] : []),
      ]),
      node({ fontSize: 26, color: "#6B6480" }, "No app to download - respond from your browser"),
    ],
  );

  // Satori accepts a plain element tree at runtime; the typed signature wants a ReactElement, so cast
  // (we deliberately avoid JSX/React to keep this a dependency-light, bundler-config-free Function).
  const element = tree as unknown as ConstructorParameters<typeof ImageResponse>[0];
  return new ImageResponse(element, { width: WIDTH, height: HEIGHT });
}
